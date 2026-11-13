// 应用外壳:导航 + 页面路由 + 工程管理(保存/版本历史/导入导出)
import { store } from './state/store';
import { Viewport } from './ui/viewport';
import { pageLibrary, pageDougong, pageFrame, pageRender, type PageCtx } from './ui/pages';
import {
  saveProject, listProjects, listVersions, getVersionData, loadLatest,
  exportProjectFile, importProjectFile,
} from './state/db';

const PAGES = [
  { hash: 'library', name: '构件库', render: pageLibrary },
  { hash: 'dougong', name: '斗拱编辑', render: pageDougong },
  { hash: 'frame', name: '梁架装配', render: pageFrame },
  { hash: 'render', name: '渲染设置', render: pageRender },
] as const;

const app = document.getElementById('app')!;

// 布局
const header = document.createElement('header');
const nav = document.createElement('nav');
const projectBar = document.createElement('div');
projectBar.className = 'project-bar';
header.appendChild(nav);
header.appendChild(projectBar);
const main = document.createElement('main');
const panel = document.createElement('aside');
panel.id = 'panel';
const viewportBox = document.createElement('div');
viewportBox.id = 'viewport-box';
main.appendChild(panel);
main.appendChild(viewportBox);
app.appendChild(header);
app.appendChild(main);

const viewport = new Viewport(viewportBox);
const fpsEl = document.createElement('span');
const ctx: PageCtx = { viewport, fpsEl };

// 导航
let cleanup: (() => void) | null = null;
function route() {
  const hash = location.hash.replace('#/', '') || 'library';
  const page = PAGES.find((p) => p.hash === hash) ?? PAGES[0];
  nav.querySelectorAll('a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === `#/${page.hash}`);
  });
  if (cleanup) cleanup();
  panel.innerHTML = '';
  cleanup = page.render(panel, ctx) ?? null;
}
for (const p of PAGES) {
  const a = document.createElement('a');
  a.href = `#/${p.hash}`;
  a.textContent = p.name;
  nav.appendChild(a);
}
window.addEventListener('hashchange', route);

// ---------- 工程管理 ----------
let currentProjectId: number | null = null;

const nameInput = document.createElement('input');
nameInput.value = store.project.name;
nameInput.className = 'proj-name';
nameInput.onchange = () => { store.project.name = nameInput.value; };
projectBar.appendChild(nameInput);

function barBtn(text: string, onclick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = onclick;
  projectBar.appendChild(b);
  return b;
}

barBtn('保存', async () => {
  currentProjectId = await saveProject(currentProjectId, store.project.name, store.serialize());
  flash('已保存');
});
barBtn('版本历史', async () => {
  if (currentProjectId == null) { flash('请先保存工程'); return; }
  showVersions();
});
barBtn('打开', async () => {
  const list = await listProjects();
  if (!list.length) { flash('暂无已存工程'); return; }
  // 简化:打开最近一个
  const latest = list.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const data = await loadLatest(latest.id!);
  if (data) {
    currentProjectId = latest.id!;
    store.load(data);
    nameInput.value = store.project.name;
    viewport.rebuild();
    viewport.frameAll();
    flash(`已打开「${latest.name}」`);
  }
});
barBtn('导出工程', () => exportProjectFile(store.project.name, store.serialize()));
barBtn('导入工程', async () => {
  const data = await importProjectFile();
  if (data) {
    store.load(data);
    nameInput.value = store.project.name;
    viewport.rebuild();
    viewport.frameAll();
    flash('已导入');
  }
});
projectBar.appendChild(fpsEl);

// 版本历史浮层
async function showVersions() {
  const old = document.getElementById('versions');
  old?.remove();
  const box = document.createElement('div');
  box.id = 'versions';
  box.innerHTML = '<h3>版本历史</h3>';
  const versions = await listVersions(currentProjectId!);
  for (const v of versions.reverse()) {
    const rowEl = document.createElement('div');
    rowEl.className = 'version-row';
    const time = new Date(v.createdAt).toLocaleString('zh-CN');
    rowEl.innerHTML = `<span>${time} · ${v.label}</span>`;
    const btn = document.createElement('button');
    btn.textContent = '回滚到此版';
    btn.onclick = async () => {
      const data = await getVersionData(v.id!);
      if (data) {
        store.load(data);
        viewport.rebuild();
        viewport.frameAll();
        flash(`已回滚到 ${time}`);
        box.remove();
      }
    };
    rowEl.appendChild(btn);
    box.appendChild(rowEl);
  }
  const close = document.createElement('button');
  close.textContent = '关闭';
  close.onclick = () => box.remove();
  box.appendChild(close);
  document.body.appendChild(box);
}

// 提示条
let flashTimer = 0;
function flash(msg: string) {
  let el = document.getElementById('flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el!.classList.remove('show'), 1800);
}

// 快捷键:撤销/重做
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); store.redo(); }
});

route();
viewport.frameAll();
