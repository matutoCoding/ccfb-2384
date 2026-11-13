// 材分模数制度(《营造法式》八等材)
// 所有构件尺寸以「分°」为基本模数;材等决定 1 分° 的实物尺寸。
// 材:高 15 分°、宽 10 分°;栔:高 6 分°;足材 21 分°。

export interface CaiGrade {
  id: number;        // 1..8
  name: string;
  fenCun: number;    // 1 分° = 多少 宋寸
}

/** 八等材:每等 1 分° 对应的宋寸 */
export const CAI_GRADES: CaiGrade[] = [
  { id: 1, name: '一等材', fenCun: 0.60 },
  { id: 2, name: '二等材', fenCun: 0.55 },
  { id: 3, name: '三等材', fenCun: 0.50 },
  { id: 4, name: '四等材', fenCun: 0.48 },
  { id: 5, name: '五等材', fenCun: 0.44 },
  { id: 6, name: '六等材', fenCun: 0.40 },
  { id: 7, name: '七等材', fenCun: 0.35 },
  { id: 8, name: '八等材', fenCun: 0.30 },
];

export interface Module {
  grade: CaiGrade;
  /** 1 宋寸 = 多少毫米(宋尺换算,可配) */
  cunMm: number;
}

export const defaultModule = (): Module => ({ grade: CAI_GRADES[2], cunMm: 32 });

/** 分° → 毫米 */
export const fenToMm = (m: Module, fen: number): number => fen * m.grade.fenCun * m.cunMm;
/** 毫米 → 分° */
export const mmToFen = (m: Module, mm: number): number => mm / (m.grade.fenCun * m.cunMm);

// 常用模数(分°)
export const FEN = {
  CAI_H: 15,      // 材高
  CAI_W: 10,      // 材宽
  QI_H: 6,        // 栔高
  ZUCAI_H: 21,    // 足材高(材+栔)
  TIAO: 30,       // 每跳出跳
  GONG_END: 4,    // 拱头卷杀每瓣长(约)
} as const;

/** 斗的构成比例(以斗底宽为基准的经验比例,分°) */
export interface DouProportions {
  bottomW: number; // 斗底宽
  earH: number;    // 耳
  pingH: number;   // 平
  qiH: number;     // 欹
}
export const douProp = (bottomW: number): DouProportions => ({
  bottomW,
  earH: bottomW * 0.4 * 0.4,   // 耳占高 2/5 中的比例,按法式:耳:平:欹 = 4:2:4(高十份)
  pingH: bottomW * 0.4 * 0.2,
  qiH: bottomW * 0.4 * 0.4,
});
