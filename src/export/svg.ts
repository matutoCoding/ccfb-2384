// 立面图 SVG 导出:正立面投影(沿 -Z 看)+ 尺寸标注
import type { Project } from '../state/store';
import { flattenEntities, fenScaleMm, geometryForEntity } from '../scene';
import { fenToMm } from '../geom/caifen';

type P2 = [number, number];

/** 单调链凸包 */
function hull(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [], upper: P2[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

export function exportElevationSVG(p: Project): string {
  const s = fenScaleMm(p); // 分° → mm
  const ents = flattenEntities(p);

  // 每个构件:变换后顶点投影到 XY(正立面),取凸包
  const polys: P2[][] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of ents) {
    const { geo } = geometryForEntity(e, p);
    const pts: P2[] = [];
    const q = ((e.rotQ % 4) + 4) % 4;
    for (let i = 0; i < geo.positions.length; i += 3) {
      let x = geo.positions[i], z = geo.positions[i + 2];
      const y = geo.positions[i + 1];
      // 绕 Y 旋转(与渲染一致:rotQ=1 → (x,z)→(z,-x))
      let rx = x;
      if (q === 1) { rx = z; }
      else if (q === 2) { rx = -x; }
      else if (q === 3) { rx = -z; }
      const wx = rx + e.pos[0], wy = y + e.pos[1];
      pts.push([wx, wy]);
      minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
      minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
    }
    polys.push(hull(pts));
  }
  if (!isFinite(minX)) { minX = 0; maxX = 100; minY = 0; maxY = 100; }

  // 图纸坐标:mm,留标注边距
  const margin = 1200;
  const W = (maxX - minX) * s + margin * 2;
  const H = (maxY - minY) * s + margin * 2;
  const X = (fen: number) => (fen - minX) * s + margin;
  const Y = (fen: number) => H - ((fen - minY) * s + margin); // Y 翻转

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#fdfcf9"/>`);
  parts.push(`<g stroke="#3a2f28" stroke-width="1.2" fill="none">`);
  for (const poly of polys) {
    const d = poly.map((pt, i) => `${i ? 'L' : 'M'}${X(pt[0]).toFixed(1)},${Y(pt[1]).toFixed(1)}`).join('') + 'Z';
    parts.push(`<path d="${d}"/>`);
  }
  parts.push('</g>');

  // ---- 尺寸标注 ----
  const dim = (x1: number, y1: number, x2: number, y2: number, text: string, off = 160) => {
    // 水平或竖直尺寸线 + 界线 + 箭头 + 文字
    const horiz = Math.abs(y2 - y1) < 0.01;
    const dy = horiz ? off : 0, dx = horiz ? 0 : -off;
    const lx1 = x1 + dx, ly1 = y1 + dy, lx2 = x2 + dx, ly2 = y2 + dy;
    parts.push(`<g stroke="#8a4b2a" stroke-width="0.8" fill="none">`);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${lx1}" y2="${ly1}"/>`);
    parts.push(`<line x1="${x2}" y1="${y2}" x2="${lx2}" y2="${ly2}"/>`);
    parts.push(`<line x1="${lx1}" y1="${ly1}" x2="${lx2}" y2="${ly2}"/>`);
    const ax = (lx1 + lx2) / 2, ay = (ly1 + ly2) / 2;
    parts.push(`</g>`);
    parts.push(`<text x="${ax}" y="${ay - 20}" font-size="110" text-anchor="middle" fill="#8a4b2a" font-family="sans-serif">${text}</text>`);
  };

  const mm = (fen: number) => `${Math.round(fenToMm(p.module, fen))}`;
  const fp = p.frame;
  const totalW = fp.bays * fp.bayWidth;
  const x0 = -totalW / 2;

  // 开间尺寸链(底部)
  for (let i = 0; i < fp.bays; i++) {
    dim(X(x0 + i * fp.bayWidth), Y(0), X(x0 + (i + 1) * fp.bayWidth), Y(0),
      `${mm(fp.bayWidth)}`, 300);
  }
  // 总宽
  dim(X(x0), Y(0), X(x0 + totalW), Y(0), `通面阔 ${mm(totalW)}`, 700);
  // 柱高(左侧)
  dim(X(x0), Y(0), X(x0), Y(fp.columnH), `柱高 ${mm(fp.columnH)}`, 300);
  // 总高
  dim(X(x0), Y(0), X(x0), Y(maxY), `通高 ${mm(maxY)}`, 800);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}mm" height="${H.toFixed(0)}mm">
<!-- 正立面 · ${p.name} · ${p.module.grade.name} · 单位:mm -->
${parts.join('\n')}
</svg>`;
}
