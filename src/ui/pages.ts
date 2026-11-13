// 四个功能页面:构件库 / 斗拱编辑 / 梁架装配 / 渲染设置
import { store } from '../state/store';
import { CAI_GRADES, fenToMm } from '../geom/caifen';
import { PART_NAMES, type PartType, puzuoName } from '../geom/dougong';
import { partGeometry } from '../geom/dougong';
import { exportGLB, downloadBlob } from '../export/gltf';
import { exportElevationSVG } from '../export/svg';
import type { Viewport } from './viewport';

export interface PageCtx {
  viewport: Viewport;
  fpsEl: HTMLElement;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const r = el('div', 'form-row');
  r.appendChild(el('label', '', label));
  r.appendChild(control);
  return r;
}

function numberInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.value = String(value);
  i.min = String(min); i.max = String(max); i.step = String(step);
  i.onchange = () => onChange(Number(i.value));
  return i;
}

function checkbox(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = value;
  i.onchange = () => onChange(i.checked);
  return i;
}

function select<T extends string | number>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const s = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    s.appendChild(opt);
  }
  s.value = String(value);
  s.onchange = () => {
    const v = options.find((o) => String(o.value) === s.value);
    if (v) onChange(v.value);
  };
  return s;
}

function slider(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
  const i = document.createElement('input');
  i.type = 'range';
  i.value = String(value);
  i.min = String(min); i.max = String(max); i.step = String(step);
  i.oninput = () => onChange(Number(i.value));
  return i;
}

// ---------- 1. 构件库 ----------

export function pageLibrary(panel: HTMLElement, ctx: PageCtx) {
  ctx.viewport.mode = 'puzuo';
  ctx.viewport.dragEnabled = false;
  ctx.viewport.rebuild();
  ctx.viewport.frameAll();

  const p = store.project;
  panel.appendChild(el('h2', '', '材分模数'));
  panel.appendChild(row('材等', select(
    CAI_GRADES.map((g) => ({ value: g.id, label: `${g.name}(1分°=${g.fenCun}寸)` })),
    p.module.grade.id,
    (id) => store.updateModule({ grade: CAI_GRADES.find((g) => g.id === id)! }),
  )));
  panel.appendChild(row('宋尺(1寸=mm)', numberInput(p.module.cunMm, 28, 34, 0.1, (v) => store.updateModule({ cunMm: v }))));
  panel.appendChild(el('p', 'hint', '改材等后,斗拱、梁架全部构件按新模数联动重算。'));

  panel.appendChild(el('h2', '', '构件库(尺寸随材等换算)'));
  const table = el('table', 'part-table');
  table.innerHTML = '<tr><th>构件</th><th>顶点数</th><th>参考尺寸(mm)</th></tr>';
  const dims: [PartType, string][] = [
    ['ludou', '底 30分°'], ['sandou', '底 14分°'], ['jiaohudou', '底 18分°'],
    ['huagong', '长 80分°'], ['guazigong', '长 62分°'], ['linggong', '长 72分°'],
    ['mangong', '长 92分°'], ['ang', '斜长 72分°'], ['luohanfang', '长 130分°'],
  ];
  const rebuild = () => {
    table.innerHTML = '<tr><th>构件</th><th>顶点数</th><th>参考尺寸(mm)</th></tr>';
    for (const [t, dimText] of dims) {
      const g = partGeometry(t, store.project.module);
      const fen = parseFloat(dimText.match(/[\d.]+/)![0]);
      const tr = el('tr');
      tr.appendChild(el('td', '', PART_NAMES[t]));
      tr.appendChild(el('td', '', String(g.positions.length / 3)));
      tr.appendChild(el('td', '', dimText.replace(/[\d.]+分°/, `${fen}分° ≈ ${Math.round(fenToMm(store.project.module, fen))}mm`)));
      table.appendChild(tr);
    }
  };
  rebuild();
  const unsub = store.subscribe(rebuild);
  panel.appendChild(table);
  return () => unsub();
}

// ---------- 2. 斗拱编辑 ----------

export function pageDougong(panel: HTMLElement, ctx: PageCtx) {
  ctx.viewport.mode = 'puzuo';
  ctx.viewport.dragEnabled = false;
  ctx.viewport.rebuild();
  ctx.viewport.frameAll();

  const d = store.project.dougong;
  panel.appendChild(el('h2', '', `铺作编辑 · ${puzuoName(d.tiao)}`));
  const title = panel.querySelector('h2')!;
  const refresh = () => { title.textContent = `铺作编辑 · ${puzuoName(store.project.dougong.tiao)}`; };
  const unsub = store.subscribe(refresh);

  panel.appendChild(row('出跳数', select(
    [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} 跳(${puzuoName(n)})` })),
    d.tiao,
    (v) => store.updateDougong({ tiao: v }),
  )));
  panel.appendChild(row('昂形', select(
    [{ value: 'none' as const, label: '无昂(杪)' }, { value: 'xiaang' as const, label: '下昂' }, { value: 'shangang' as const, label: '上昂' }],
    d.ang,
    (v) => store.updateDougong({ ang: v }),
  )));
  panel.appendChild(row('真昂', checkbox(d.angReal, (v) => store.updateDougong({ angReal: v }))));
  panel.appendChild(row('双杪后下昂', checkbox(d.shuangchao, (v) => store.updateDougong({ shuangchao: v }))));

  panel.appendChild(el('h3', '', '逐跳计心/偷心'));
  const jxBox = el('div', 'jixin-box');
  const buildJx = () => {
    jxBox.innerHTML = '';
    const dd = store.project.dougong;
    for (let i = 0; i < dd.tiao; i++) {
      jxBox.appendChild(row(`第${i + 1}跳计心`, checkbox(dd.jixin[i], (v) => {
        const jixin = [...store.project.dougong.jixin];
        jixin[i] = v;
        store.updateDougong({ jixin });
      })));
    }
  };
  buildJx();
  const unsub2 = store.subscribe(buildJx);
  panel.appendChild(jxBox);

  panel.appendChild(el('h3', '', '增删铺作'));
  const btns = el('div', 'btn-row');
  const addBtn = el('button', '', '增加一朵到梁架');
  addBtn.onclick = () => {
    const fp = store.project.frame;
    if (!fp.withDougong) store.updateFrame({ withDougong: true });
    store.touch();
  };
  const delBtn = el('button', '', '梁架去铺作');
  delBtn.onclick = () => store.updateFrame({ withDougong: false });
  btns.appendChild(addBtn); btns.appendChild(delBtn);
  panel.appendChild(btns);
  panel.appendChild(el('p', 'hint', '斗与拱的交接(榫卯)位置由材分模数自动对齐,无需手动定位。'));
  return () => { unsub(); unsub2(); };
}

// ---------- 3. 梁架装配 ----------

export function pageFrame(panel: HTMLElement, ctx: PageCtx) {
  ctx.viewport.mode = 'frame';
  ctx.viewport.dragEnabled = true;
  ctx.viewport.rebuild();
  ctx.viewport.frameAll();

  const f = store.project.frame;
  panel.appendChild(el('h2', '', '梁架装配'));
  panel.appendChild(row('开间数', numberInput(f.bays, 1, 9, 1, (v) => store.updateFrame({ bays: Math.round(v) }))));
  panel.appendChild(row('每间宽(分°)', numberInput(f.bayWidth, 60, 400, 5, (v) => store.updateFrame({ bayWidth: v }))));
  panel.appendChild(row('进深间数', numberInput(f.depthBays, 1, 6, 1, (v) => store.updateFrame({ depthBays: Math.round(v) }))));
  panel.appendChild(row('每进深(分°)', numberInput(f.depthWidth, 60, 400, 5, (v) => store.updateFrame({ depthWidth: v }))));
  panel.appendChild(row('柱高(分°)', numberInput(f.columnH, 100, 600, 5, (v) => store.updateFrame({ columnH: v }))));
  panel.appendChild(row('柱径(分°)', numberInput(f.columnR, 10, 40, 1, (v) => store.updateFrame({ columnR: v }))));
  panel.appendChild(row('柱头铺作', checkbox(f.withDougong, (v) => store.updateFrame({ withDougong: v }))));

  panel.appendChild(el('h3', '', '操作'));
  const btns = el('div', 'btn-row');
  const undo = el('button', '', '撤销 (Ctrl+Z)');
  undo.onclick = () => store.undo();
  const redo = el('button', '', '重做 (Ctrl+Y)');
  redo.onclick = () => store.redo();
  btns.appendChild(undo); btns.appendChild(redo);
  panel.appendChild(btns);
  panel.appendChild(el('p', 'hint', '左键拖拽构件可移动,自动吸附到柱网交点;空白处拖动旋转视角,右键平移,滚轮缩放。'));
  return () => { ctx.viewport.dragEnabled = false; };
}

// ---------- 4. 渲染设置 ----------

export function pageRender(panel: HTMLElement, ctx: PageCtx) {
  ctx.viewport.mode = 'frame';
  ctx.viewport.dragEnabled = false;
  ctx.viewport.rebuild();

  const r = store.project.render;
  panel.appendChild(el('h2', '', '渲染设置'));
  panel.appendChild(row('SSAO 环境光遮蔽', checkbox(r.ssao, (v) => store.updateRender({ ssao: v }))));
  panel.appendChild(row('方向光阴影', checkbox(r.shadows, (v) => store.updateRender({ shadows: v }))));
  panel.appendChild(row('过程木纹', checkbox(r.woodGrain, (v) => store.updateRender({ woodGrain: v }))));
  panel.appendChild(row('曝光', slider(r.exposure, 0.2, 3, 0.05, (v) => store.updateRender({ exposure: v }))));

  panel.appendChild(el('h3', '', '剖切平面'));
  const cp = r.clipPlane;
  const updCp = (patch: Partial<typeof cp>) =>
    store.updateRender({ clipPlane: { ...store.project.render.clipPlane, ...patch } });
  panel.appendChild(row('启用剖切', checkbox(cp.enabled, (v) => updCp({ enabled: v }))));
  panel.appendChild(row('轴向', select(
    [{ value: 'x' as const, label: 'X(横剖)' }, { value: 'y' as const, label: 'Y(平剖)' }, { value: 'z' as const, label: 'Z(纵剖)' }],
    cp.axis, (v) => updCp({ axis: v }),
  )));
  panel.appendChild(row('位置(分°)', slider(cp.pos, -500, 500, 5, (v) => updCp({ pos: v }))));
  panel.appendChild(row('反向', checkbox(cp.flip, (v) => updCp({ flip: v }))));

  panel.appendChild(el('h3', '', '导出'));
  const btns = el('div', 'btn-row');
  const gltfBtn = el('button', '', '导出 glTF (.glb)');
  gltfBtn.onclick = () => downloadBlob(exportGLB(store.project), `${store.project.name}.glb`);
  const svgBtn = el('button', '', '导出立面 SVG');
  svgBtn.onclick = () => {
    const svg = exportElevationSVG(store.project);
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${store.project.name}-立面.svg`);
  };
  btns.appendChild(gltfBtn); btns.appendChild(svgBtn);
  panel.appendChild(btns);
  panel.appendChild(el('p', 'hint', 'glTF 单位为米,尺寸按当前材等换算,导入其他查看器即为实物尺寸。'));

  const fpsBox = el('p', 'fps', 'FPS: --');
  panel.appendChild(fpsBox);
  ctx.viewport.onFps = (f) => { fpsBox.textContent = `FPS: ${f}`; };
  return () => { ctx.viewport.onFps = null; };
}
