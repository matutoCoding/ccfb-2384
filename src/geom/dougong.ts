// 斗拱(铺作)参数化生成器
// 输入:材等模数 + 出跳数 + 昂形 + 计心/偷心 → 输出:构件清单(类型+位置+朝向)
// 所有坐标单位:分°。改材等时几何体重算,装配关系(分°坐标)不变 → 全联动。
import type { GeometryData } from '../engine/gl';
import type { Module } from './caifen';
import { FEN } from './caifen';
import { loft, beamGeo, mergeGeos, translateGeo, type Station } from './loft';
import { juansha } from './section';
import type { Vec3 } from '../engine/math';

export type AngType = 'none' | 'xiaang' | 'shangang';

export interface DougongParams {
  tiao: number;            // 出跳数 1..5(四铺作=1跳 … 八铺作=5跳)
  ang: AngType;            // 昂形:无 / 下昂 / 上昂
  angReal: boolean;        // 真昂(杠杆到位) / 假昂(装饰)
  jixin: boolean[];        // 每跳是否计心(加横拱),长度 = tiao
  shuangchao: boolean;     // 是否双杪(前两跳出华拱)再下昂
}

export const defaultDougongParams = (): DougongParams => ({
  tiao: 2,
  ang: 'xiaang',
  angReal: true,
  jixin: [true, true, true, true, true],
  shuangchao: false,
});

/** 铺作总名(几铺作) */
export const puzuoName = (tiao: number): string =>
  ['四', '五', '六', '七', '八'][tiao - 1] + '铺作';

// ---------- 构件类型 ----------

export type PartType =
  | 'ludou'       // 栌斗
  | 'sandou'      // 散斗
  | 'jiaohudou'   // 交互斗
  | 'qixindou'    // 齐心斗
  | 'huagong'     // 华拱(出跳拱)
  | 'nidaogong'   // 泥道拱
  | 'guazigong'   // 瓜子拱
  | 'linggong'    // 令拱
  | 'mangong'     // 慢拱
  | 'ang'         // 昂
  | 'shuaitou'    // 耍头
  | 'chenfangtou' // 衬枋头
  | 'luohanfang'  // 罗汉枋
  | 'zhutoufang'; // 柱头枋

export const PART_NAMES: Record<PartType, string> = {
  ludou: '栌斗', sandou: '散斗', jiaohudou: '交互斗', qixindou: '齐心斗',
  huagong: '华拱', nidaogong: '泥道拱', guazigong: '瓜子拱', linggong: '令拱',
  mangong: '慢拱', ang: '昂', shuaitou: '耍头', chenfangtou: '衬枋头',
  luohanfang: '罗汉枋', zhutoufang: '柱头枋',
};

export interface Part {
  type: PartType;
  /** 分°坐标(铺作局部,栌斗底中心为原点,+Z 出檐方向) */
  pos: Vec3;
  /** 绕 Y 旋转(90° 的倍数):0 = 沿 X(横拱),1 = 沿 Z(华拱/昂,出跳方向) */
  rotQ: number;
  /** 昂的斜置角(仅 ang 类型使用,其余 0) */
  tilt?: number;
  mirror?: boolean;
}

// ---------- 尺寸规则(分°) ----------

const RULES = {
  douBottom: 30,        // 栌斗底宽
  sanDouBottom: 14,     // 散斗底宽
  jiaohuDouBottom: 18,  // 交互斗底宽
  guaziLen: 62,         // 瓜子拱长
  lingLen: 72,          // 令拱长
  manLen: 92,           // 慢拱长
  nidaoLen: 62,         // 泥道拱长
  fangLen: 130,         // 枋默认长(装配时按开间重算)
  angSlope: 0.5,        // 下昂斜率(升:出 ≈ 1:2)
};

/** 斗高 = 耳+平+欹,按底宽比例 */
const douHeight = (bottomW: number) => bottomW * 0.68;

// ---------- 构件几何体(分°坐标,缓存键含材等) ----------

const geoCache = new Map<string, GeometryData>();

export function clearGeometryCache() { geoCache.clear(); }

/** 斗:耳(方板)+ 平(薄板)+ 欹(内凹曲面),沿 Y 放样 */
function douGeo(bottomW: number): GeometryData {
  const h = douHeight(bottomW);
  const earH = h * 0.4, pingH = h * 0.2, qiH = h * 0.4;
  const topW = bottomW * 1.13;
  const half = (w: number) => w / 2;
  // 欹:底窄口宽的内凹曲线(平方插值 → 曲面平滑)
  const qiStations: Station[] = [];
  const segs = 8;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = bottomW + (topW - bottomW) * t * t;
    qiStations.push({ x: t * qiH, su: 1, sv: 1, dy: 0 });
    qiStations[i].su = half(w) / half(topW); // 以口部截面为基准缩放
  }
  const sec = [
    [-half(topW), -half(topW)], [half(topW), -half(topW)],
    [half(topW), half(topW)], [-half(topW), half(topW)],
  ] as [number, number][];
  const qi = loft(sec, qiStations, { axis: 'y', capStart: true, capEnd: false });
  const slab = (w: number, hh: number, y0: number) =>
    translateGeo(
      loft(sec.map(() => [0, 0] as [number, number]).map((_, i) => sec[i]),
        [{ x: 0, su: w / topW, sv: w / topW }, { x: hh, su: w / topW, sv: w / topW }],
        { axis: 'y', capStart: true, capEnd: true }),
      0, y0, 0);
  const ping = slab(topW, pingH, qiH);
  const ear = slab(topW * 1.06, earH, qiH + pingH);
  return mergeGeos([qi, ping, ear]);
}

/** 拱:矩形截面,两端四瓣卷杀,端部底面做斗耳槽(简化为卷杀收分) */
function gongGeo(len: number, h: number, w: number): GeometryData {
  return beamGeo(w, h, len, (t) => juansha(t, 'sima', 0.25), () => 0, 20);
}

/** 昂:斜置长材,昂嘴卷杀(月梁式平滑曲线),沿斜线放样 */
function angGeo(len: number, slope: number): GeometryData {
  const w = FEN.CAI_W, h = FEN.CAI_H;
  const segs = 24;
  const stations: Station[] = [];
  const horizLen = len * Math.cos(Math.atan(slope));
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // 昂嘴端(外端,t→1)卷杀成尖嘴;内端平齐
    const k = t > 0.6 ? juansha((t - 0.6) / 0.4, 'yueliang', 0.55) : 1;
    stations.push({
      x: t * horizLen,
      su: 1,
      sv: k,
      dy: t * horizLen * slope,
    });
  }
  return loft(
    [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]],
    stations,
    { axis: 'x', smoothAround: false },
  );
}

/** 枋:直材,端部微卷杀 */
function fangGeo(len: number): GeometryData {
  return beamGeo(FEN.CAI_W, FEN.CAI_H, len, (t) => juansha(t, 'sima', 0.1), () => 0, 8);
}

export function partGeometry(type: PartType, mod: Module): GeometryData {
  const key = `${type}@${mod.grade.id}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  let g: GeometryData;
  switch (type) {
    case 'ludou': g = douGeo(RULES.douBottom); break;
    case 'sandou': g = douGeo(RULES.sanDouBottom); break;
    case 'jiaohudou': g = douGeo(RULES.jiaohuDouBottom); break;
    case 'qixindou': g = douGeo(RULES.sanDouBottom * 1.1); break;
    case 'huagong': g = gongGeo(FEN.TIAO * 2 + 20, FEN.ZUCAI_H, FEN.CAI_W); break;
    case 'nidaogong': g = gongGeo(RULES.nidaoLen, FEN.CAI_H, FEN.CAI_W); break;
    case 'guazigong': g = gongGeo(RULES.guaziLen, FEN.CAI_H, FEN.CAI_W); break;
    case 'linggong': g = gongGeo(RULES.lingLen, FEN.CAI_H, FEN.CAI_W); break;
    case 'mangong': g = gongGeo(RULES.manLen, FEN.CAI_H, FEN.CAI_W); break;
    case 'ang': g = angGeo(FEN.TIAO * 2.4, RULES.angSlope); break;
    case 'shuaitou': g = gongGeo(FEN.TIAO * 2 + 30, FEN.CAI_H, FEN.CAI_W); break;
    case 'chenfangtou': g = fangGeo(FEN.TIAO * 2 + 40); break;
    case 'luohanfang': g = fangGeo(RULES.fangLen); break;
    case 'zhutoufang': g = fangGeo(RULES.fangLen); break;
  }
  geoCache.set(key, g);
  return g;
}

// ---------- 铺作装配(核心联动逻辑) ----------

/**
 * 生成一朵柱头铺作的构件清单。
 * 坐标系:栌斗底中心为原点;+Z 为出檐(外)方向;内外跳对称。
 * 竖向:每跳升高一材一栔(足材 21 分°);横向:每跳出跳 30 分°。
 * 斗与拱的交接(榫卯)位置由同一套模数推出 → 自动对齐。
 */
export function dougongParts(p: DougongParams): Part[] {
  const parts: Part[] = [];
  const T = FEN.TIAO;          // 30
  const ZH = FEN.ZUCAI_H;      // 21
  const luH = douHeight(RULES.douBottom);

  // 栌斗
  parts.push({ type: 'ludou', pos: [0, 0, 0], rotQ: 0 });

  // 泥道拱 + 柱头枋(沿面阔方向,压在栌斗上)
  const nidaoY = luH;
  parts.push({ type: 'nidaogong', pos: [-RULES.nidaoLen / 2, nidaoY, 0], rotQ: 0 });
  // 柱头枋层(逐跳叠一层)
  for (let i = 0; i < p.tiao; i++) {
    parts.push({
      type: 'zhutoufang',
      pos: [-RULES.fangLen / 2, nidaoY + FEN.CAI_H + i * ZH, 0],
      rotQ: 0,
    });
  }

  // 逐跳:华拱/昂 + 跳头横拱(计心)
  // 注意:出跳构件几何沿 +X 生成,rotQ=1 渲染时 +X 映射到 -Z,
  // 故 pos.z 取 +(out+10) 使构件关于面阔中线对称分布。
  for (let i = 1; i <= p.tiao; i++) {
    const isAngLevel = p.ang !== 'none' && (!p.shuangchao || i > 2) && i >= (p.shuangchao ? 3 : 1);
    const baseY = luH + (i - 1) * ZH;              // 本跳出跳构件底(足材拱,顶接跳头斗)
    const out = i * T;                             // 本跳跳头位置

    if (isAngLevel && p.ang === 'xiaang') {
      // 下昂:斜材,外端(昂嘴)低、昂尾上挑入屋内
      parts.push({
        type: 'ang',
        pos: [0, baseY, out + 10],
        rotQ: 1,
        tilt: Math.atan(RULES.angSlope),
      });
    } else {
      // 华拱(足材:材+栔 21 分°,顶面恰好承跳头交互斗)
      parts.push({
        type: 'huagong',
        pos: [0, baseY, out + 10],
        rotQ: 1,
      });
    }

    // 跳头交互斗 + 横拱(计心造)
    for (const side of [1, -1] as const) {
      const z = side * out;
      const jdY = luH + i * ZH;
      parts.push({ type: 'jiaohudou', pos: [0, jdY, z], rotQ: 0 });
      if (p.jixin[i - 1]) {
        const isOuter = i === p.tiao;
        const gongY = jdY + douHeight(RULES.jiaohuDouBottom);
        if (isOuter) {
          // 最外跳:令拱 + 齐心斗 + 散斗,上承罗汉枋
          parts.push({ type: 'linggong', pos: [-RULES.lingLen / 2, gongY, z], rotQ: 0 });
          parts.push({ type: 'qixindou', pos: [0, gongY + FEN.CAI_H, z], rotQ: 0 });
          for (const sx of [1, -1] as const) {
            parts.push({
              type: 'sandou',
              pos: [sx * (RULES.lingLen / 2 - 8), gongY + FEN.CAI_H, z],
              rotQ: 0,
            });
          }
          parts.push({
            type: 'luohanfang',
            pos: [-RULES.fangLen / 2, gongY + FEN.CAI_H + douHeight(RULES.sanDouBottom), z],
            rotQ: 0,
          });
        } else {
          // 内跳:瓜子拱 + 散斗,上承慢拱
          parts.push({ type: 'guazigong', pos: [-RULES.guaziLen / 2, gongY, z], rotQ: 0 });
          for (const sx of [1, -1] as const) {
            parts.push({
              type: 'sandou',
              pos: [sx * (RULES.guaziLen / 2 - 8), gongY + FEN.CAI_H, z],
              rotQ: 0,
            });
          }
          parts.push({
            type: 'mangong',
            pos: [-RULES.manLen / 2, gongY + FEN.CAI_H + douHeight(RULES.sanDouBottom), z],
            rotQ: 0,
          });
        }
      }
    }
  }

  // 耍头(最上一跳之上,出跳方向,前后对称)
  const topY = luH + p.tiao * ZH + FEN.CAI_H;
  parts.push({ type: 'shuaitou', pos: [0, topY, p.tiao * T + 15], rotQ: 1 });
  // 衬枋头(最内)
  parts.push({ type: 'chenfangtou', pos: [0, topY + FEN.CAI_H, p.tiao * T + 20], rotQ: 1 });

  return parts;
}

/** 铺作总高(分°),供梁架装配对齐用 */
export function dougongHeight(p: DougongParams): number {
  return douHeight(RULES.douBottom) + p.tiao * FEN.ZUCAI_H + 2 * FEN.CAI_H;
}

/** 铺作出檐总长(分°) */
export function dougongDepth(p: DougongParams): number {
  return p.tiao * FEN.TIAO * 2 + 40;
}

/** 斗底宽(分°),供柱头开槽 */
export const ludouBottom = () => RULES.douBottom;
