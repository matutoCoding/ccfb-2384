// 截面轮廓与卷杀曲线 —— 全部在「分°」坐标系内定义
import type { Vec3 } from '../engine/math';

export type Point2 = [number, number];

/** 矩形截面(宽 w × 高 h,中心在原点) */
export function rectSection(w: number, h: number): Point2[] {
  const hw = w / 2, hh = h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
}

/** 斗的欹(内凹)截面:底部窄、口部宽,侧壁内凹曲线 */
export function douSection(bottomW: number, topW: number, _h: number, segs = 6): Point2[] {
  // 返回 XY 平面轮廓(局部:X 宽、Y 高),供放样/旋转使用
  const pts: Point2[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // 内凹:宽度按 t² 插值
    const w = bottomW + (topW - bottomW) * t * t;
    pts.push([w / 2, t]);
  }
  return pts;
}

/**
 * 卷杀曲线:梁/柱端部的收分。
 * 返回长度参数 t∈[0,1] 处的高度缩放系数。
 * mode:
 *  - 'none'   不卷杀
 *  - 'sima'   四瓣卷杀(折线逼近,用于拱头)
 *  - 'yueliang' 月梁式连续曲线(圆弧拟合,平滑)
 */
export function juansha(t: number, mode: 'none' | 'sima' | 'yueliang', amount = 0.3): number {
  switch (mode) {
    case 'none':
      return 1;
    case 'sima': {
      // 四瓣:每瓣 1/4 长度,逐瓣递减(法式折线卷杀)
      const petals = 4;
      const k = Math.min(Math.floor(t * petals), petals - 1);
      const local = t * petals - k;
      const step = amount / petals;
      return 1 - step * k - step * local * 0.5;
    }
    case 'yueliang': {
      // 月梁:端部按圆弧(1 - cos)平滑收分,导数连续 → 法线无折痕
      const x = Math.min(Math.max(t, 0), 1);
      return 1 - amount * (1 - Math.cos((x * Math.PI) / 2));
    }
  }
}

/** 月梁底面起拱曲线:梁中部上拱,返回竖向偏移(分°) */
export function camber(t: number, rise: number): number {
  return rise * Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
}

/** 生成平滑圆弧多边形(用于圆柱/檩截面),n 边 */
export function circleSection(r: number, n = 24): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/** 截面法线(2D,外法线),要求轮廓逆时针 */
export function sectionNormals(pts: Point2[]): Point2[] {
  const n = pts.length;
  const out: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    // 外法线(逆时针轮廓 → 右侧)
    out.push([dy / l, -dx / l]);
  }
  return out;
}

export const toVec3 = (p: Point2, y = 0): Vec3 => [p[0], y, p[1]];
