// 梁架装配:开间 × 进深 网格,柱/梁/枋/檩/铺作整体联动
// 改开间或进深 → 所有构件位置由参数重算(整体跟着变)
import type { Vec3 } from '../engine/math';
import type { DougongParams } from './dougong';
import { dougongParts, dougongHeight } from './dougong';
import type { PartType } from './dougong';

export interface FrameParams {
  bays: number;        // 开间数(面阔方向 X)
  bayWidth: number;    // 每间宽(分°)
  depthBays: number;   // 进深间数(Z)
  depthWidth: number;  // 每进深(分°)
  columnH: number;     // 柱高(分°)
  columnR: number;     // 柱径(分°)
  withDougong: boolean;
  dougong: DougongParams;
}

export const defaultFrameParams = (): FrameParams => ({
  bays: 3,
  bayWidth: 170,
  depthBays: 2,
  depthWidth: 150,
  columnH: 250,
  columnR: 21,
  withDougong: true,
  dougong: { tiao: 2, ang: 'xiaang', angReal: true, jixin: [true, true, true, true, true], shuangchao: false },
});

/** 场景中的一个可放置构件实例 */
export interface Entity {
  id: number;
  kind: 'column' | 'beam' | 'fang' | 'lin' | 'puzuo' | 'part';
  partType?: PartType;         // kind==='part' 时的斗拱构件类型
  pos: Vec3;                   // 分°
  rotQ: number;                // 绕 Y 90° 倍数
  len?: number;                // 梁/枋/檩长度(分°)
  userOffset?: Vec3;           // 拖拽产生的人工偏移(吸附后)
}

let nextId = 1;
export const resetIds = () => { nextId = 1; };

/**
 * 由梁架参数生成全部构件实体。
 * 纯函数:参数变 → 整体重算,这是「开间进深改了整体跟着变」的实现。
 */
export function buildFrame(fp: FrameParams): Entity[] {
  resetIds();
  const ents: Entity[] = [];
  const W = fp.bays * fp.bayWidth;
  const D = fp.depthBays * fp.depthWidth;
  const x0 = -W / 2, z0 = -D / 2;

  // 柱网
  const colAt: Vec3[] = [];
  for (let i = 0; i <= fp.bays; i++) {
    for (let j = 0; j <= fp.depthBays; j++) {
      const p: Vec3 = [x0 + i * fp.bayWidth, 0, z0 + j * fp.depthWidth];
      colAt.push(p);
      ents.push({ id: nextId++, kind: 'column', pos: p, rotQ: 0, len: fp.columnH });
    }
  }

  // 柱头铺作(每柱一朵)
  if (fp.withDougong) {
    for (const p of colAt) {
      ents.push({
        id: nextId++, kind: 'puzuo',
        pos: [p[0], fp.columnH, p[2]], rotQ: 0,
      });
    }
  }
  const capY = fp.columnH + (fp.withDougong ? dougongHeight(fp.dougong) : 0);

  // 梁(进深方向,每列柱一线,月梁:起拱+卷杀)
  for (let i = 0; i <= fp.bays; i++) {
    ents.push({
      id: nextId++, kind: 'beam',
      pos: [x0 + i * fp.bayWidth, capY, z0],
      rotQ: 1, len: D,
    });
  }
  // 额枋(面阔方向,柱头之间)
  for (let j = 0; j <= fp.depthBays; j++) {
    for (let i = 0; i < fp.bays; i++) {
      ents.push({
        id: nextId++, kind: 'fang',
        pos: [x0 + i * fp.bayWidth, fp.columnH - 20, z0 + j * fp.depthWidth],
        rotQ: 0, len: fp.bayWidth,
      });
    }
  }
  // 檩(面阔方向,架在梁上)
  const linLevels = fp.depthBays + 1;
  for (let j = 0; j < linLevels; j++) {
    ents.push({
      id: nextId++, kind: 'lin',
      pos: [x0, capY + 15 + (j % 2) * 12, z0 + j * fp.depthWidth],
      rotQ: 0, len: W,
    });
  }
  return ents;
}

/** 展开铺作为单个斗拱构件(渲染/拾取用) */
export function expandPuzuo(e: Entity, dp: DougongParams): Entity[] {
  return dougongParts(dp).map((p, i) => ({
    id: e.id * 1000 + i,
    kind: 'part' as const,
    partType: p.type,
    pos: [e.pos[0] + p.pos[0], e.pos[1] + p.pos[1], e.pos[2] + p.pos[2]] as Vec3,
    rotQ: p.rotQ,
  }));
}

/** 吸附:把分°坐标吸到最近的柱网交点 */
export function snapToGrid(fp: FrameParams, p: Vec3): Vec3 {
  const W = fp.bays * fp.bayWidth, D = fp.depthBays * fp.depthWidth;
  const x0 = -W / 2, z0 = -D / 2;
  const gx = Math.round((p[0] - x0) / fp.bayWidth);
  const gz = Math.round((p[2] - z0) / fp.depthWidth);
  const cx = Math.max(0, Math.min(fp.bays, gx));
  const cz = Math.max(0, Math.min(fp.depthBays, gz));
  return [x0 + cx * fp.bayWidth, p[1], z0 + cz * fp.depthWidth];
}
