// 截面放样:沿轴线扫掠截面生成网格
// 关键:相邻环共享顶点(焊接),法线按面法线加权平均 —— 卷杀曲面平滑、无接缝
import type { GeometryData } from '../engine/gl';
import type { Point2 } from './section';

export interface Station {
  x: number;      // 沿轴线位置(分°)
  su: number;     // 截面 U(宽)缩放
  sv: number;     // 截面 V(高)缩放
  dy?: number;    // 竖向偏移(起拱/卷杀位移)
  dz?: number;    // 侧向偏移
}

export interface LoftOptions {
  axis?: 'x' | 'y';          // 扫掠轴(默认 x,斗类用 y)
  smoothAround?: boolean;    // 截面周边是否平滑(圆截面 true,矩形 false)
  capStart?: boolean;
  capEnd?: boolean;
  uvScale?: number;          // 纹理密度
}

export function loft(section: Point2[], stations: Station[], opts: LoftOptions = {}): GeometryData {
  const {
    axis = 'x',
    smoothAround = false,
    capStart = true,
    capEnd = true,
    uvScale = 0.05,
  } = opts;
  const n = section.length;
  const ringVerts = smoothAround ? n : n * 2; // 非平滑周边:每条边独立顶点(硬边)
  const nr = stations.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const place = (s: Station, u: number, v: number): [number, number, number] =>
    axis === 'x'
      ? [s.x, v * s.sv + (s.dy ?? 0), u * s.su + (s.dz ?? 0)]
      : [u * s.su, s.x, v * s.sv + (s.dy ?? 0)];

  // 顶点布局:ring r, edge e → 两个端点顶点
  for (let r = 0; r < nr; r++) {
    const s = stations[r];
    if (smoothAround) {
      for (let i = 0; i < n; i++) {
        positions.push(...place(s, section[i][0], section[i][1]));
        normals.push(0, 0, 0);
        uvs.push(s.x * uvScale, (i / n) * 2 * Math.PI);
      }
    } else {
      for (let e = 0; e < n; e++) {
        const a = section[e], b = section[(e + 1) % n];
        positions.push(...place(s, a[0], a[1]));
        positions.push(...place(s, b[0], b[1]));
        normals.push(0, 0, 0, 0, 0, 0);
        uvs.push(s.x * uvScale, 0, s.x * uvScale, 1);
      }
    }
  }

  const rv = (r: number, i: number) => r * ringVerts + i;
  // 侧面三角形(环间焊接,顶点共享 → 法线连续)
  for (let r = 0; r < nr - 1; r++) {
    for (let e = 0; e < n; e++) {
      if (smoothAround) {
        const a = rv(r, e), b = rv(r, (e + 1) % n);
        const c = rv(r + 1, (e + 1) % n), d = rv(r + 1, e);
        indices.push(a, b, c, a, c, d);
      } else {
        const a = rv(r, e * 2), b = rv(r, e * 2 + 1);
        const c = rv(r + 1, e * 2 + 1), d = rv(r + 1, e * 2);
        indices.push(a, b, c, a, c, d);
      }
    }
  }

  // 端盖(扇形,法线沿轴)
  const addCap = (r: number, dir: 1 | -1) => {
    const s = stations[r];
    const cx = axis === 'x' ? s.x : 0;
    const cy = axis === 'x' ? (s.dy ?? 0) : s.x;
    const centerIdx = positions.length / 3;
    positions.push(...(axis === 'x' ? [cx, cy, s.dz ?? 0] : [0, cy, 0]));
    normals.push(...(axis === 'x' ? [dir, 0, 0] : [0, dir, 0]));
    uvs.push(0.5, 0.5);
    const ringStart = positions.length / 3;
    for (let i = 0; i < n; i++) {
      positions.push(...place(s, section[i][0], section[i][1]));
      normals.push(...(axis === 'x' ? [dir, 0, 0] : [0, dir, 0]));
      uvs.push(section[i][0] * uvScale, section[i][1] * uvScale);
    }
    for (let i = 0; i < n; i++) {
      const a = ringStart + i, b = ringStart + ((i + 1) % n);
      if (dir > 0) indices.push(centerIdx, a, b);
      else indices.push(centerIdx, b, a);
    }
  };
  if (capStart) addCap(0, -1);
  if (capEnd) addCap(nr - 1, 1);

  // 面积加权法线累积(焊接顶点 → 跨环平滑)
  const pos = new Float32Array(positions);
  const nrm = new Float32Array(normals);
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;
    const ax = pos[i1] - pos[i0], ay = pos[i1 + 1] - pos[i0 + 1], az = pos[i1 + 2] - pos[i0 + 2];
    const bx = pos[i2] - pos[i0], by = pos[i2 + 1] - pos[i0 + 1], bz = pos[i2 + 2] - pos[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (const idx of [i0, i1, i2]) {
      nrm[idx] += nx; nrm[idx + 1] += ny; nrm[idx + 2] += nz;
    }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }

  return {
    positions: pos,
    normals: nrm,
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

/** 便捷:直梁/枋 —— 矩形截面沿 X,两端卷杀 */
export function beamGeo(
  w: number, h: number, len: number,
  taper: (t: number) => number,
  camberFn: (t: number) => number = () => 0,
  segments = 24,
): GeometryData {
  const stations: Station[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // 两端对称卷杀
    const k = Math.min(taper(t), taper(1 - t));
    stations.push({ x: t * len, su: 1, sv: k, dy: camberFn(t) });
  }
  return loft(
    [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]],
    stations,
    { axis: 'x', smoothAround: false },
  );
}

/** 合并多个网格为一个(构件级合批,减少 draw call) */
export function mergeGeos(geos: GeometryData[]): GeometryData {
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.positions.length / 3; iCount += g.indices.length; }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const indices = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    positions.set(g.positions, vo * 3);
    normals.set(g.normals, vo * 3);
    uvs.set(g.uvs, vo * 2);
    for (let i = 0; i < g.indices.length; i++) indices[io + i] = g.indices[i] + vo;
    vo += g.positions.length / 3;
    io += g.indices.length;
  }
  return { positions, normals, uvs, indices };
}

/** 平移网格(局部空间) */
export function translateGeo(g: GeometryData, x: number, y: number, z: number): GeometryData {
  const p = new Float32Array(g.positions);
  for (let i = 0; i < p.length; i += 3) { p[i] += x; p[i + 1] += y; p[i + 2] += z; }
  return { ...g, positions: p };
}

/** 绕 Y 轴旋转网格(90° 倍数,用于横拱/华拱互换方向) */
export function rotateGeoY(g: GeometryData, quarterTurns: number): GeometryData {
  const p = new Float32Array(g.positions);
  const n = new Float32Array(g.normals);
  const q = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], z = p[i + 2];
    const nx = n[i], nz = n[i + 2];
    switch (q) {
      case 1: p[i] = z; p[i + 2] = -x; n[i] = nz; n[i + 2] = -nx; break;
      case 2: p[i] = -x; p[i + 2] = -z; n[i] = -nx; n[i + 2] = -nz; break;
      case 3: p[i] = -z; p[i + 2] = x; n[i] = -nz; n[i + 2] = nx; break;
    }
  }
  return { ...g, positions: p, normals: n };
}
