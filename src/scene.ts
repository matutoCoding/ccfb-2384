// 场景装配:Project → 可渲染网格组(同类构件合批实例化)
import { Mesh, type GeometryData } from './engine/gl';
import { m4, type Vec3 } from './engine/math';
import type { Project } from './state/store';
import type { Entity } from './geom/frame';
import { expandPuzuo } from './geom/frame';
import { partGeometry } from './geom/dougong';
import { loft, beamGeo } from './geom/loft';
import { circleSection, juansha, camber } from './geom/section';
import { fenToMm } from './geom/caifen';

export interface SceneMesh {
  mesh: Mesh;
  key: string;
}

const WOOD: Record<string, [number, number, number]> = {
  column: [0.55, 0.38, 0.24],
  beam: [0.60, 0.42, 0.27],
  fang: [0.58, 0.40, 0.26],
  lin: [0.52, 0.36, 0.23],
  part: [0.62, 0.44, 0.29],
};

/** 柱:梭柱(上下收分),圆截面,平滑周边 */
function columnGeo(r: number, h: number): GeometryData {
  const stations = [];
  const segs = 12;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // 梭柱:中部略鼓,顶端收分 0.85
    const k = 1 - 0.15 * t * t + 0.03 * Math.sin(Math.PI * t);
    stations.push({ x: t * h, su: k, sv: k });
  }
  return loft(circleSection(r, 20), stations, { axis: 'y', smoothAround: true });
}

/** 月梁:矩形截面,底面起拱 + 两端月梁式卷杀 */
function beamYueGeo(w: number, h: number, len: number): GeometryData {
  return beamGeo(w, h, len,
    (t) => juansha(t, 'yueliang', 0.2),
    (t) => camber(t, len * 0.015),
    28);
}

/** 檩:圆截面直材 */
function linGeo(r: number, len: number): GeometryData {
  return loft(circleSection(r, 16),
    [{ x: 0, su: 1, sv: 1 }, { x: len, su: 0.9, sv: 0.9 }],
    { axis: 'x', smoothAround: true });
}

/** 把工程展开成扁平构件列表(铺作 → 单个斗拱件) */
export function flattenEntities(p: Project): Entity[] {
  const out: Entity[] = [];
  for (const e of p.entities) {
    if (e.kind === 'puzuo') out.push(...expandPuzuo(e, p.dougong));
    else out.push(e);
  }
  return out;
}

export interface BuiltScene {
  meshes: SceneMesh[];
  bounds: { min: Vec3; max: Vec3 };
  /** pickId → entity(供选中后查询) */
  byId: Map<number, Entity>;
}

/** 单个构件的几何(供场景构建与 glTF 导出共用) */
export function geometryForEntity(e: Entity, p: Project): { key: string; geo: GeometryData } {
  const fp = p.frame;
  switch (e.kind) {
    case 'column':
      return { key: `column@${fp.columnR}@${fp.columnH}`, geo: columnGeo(fp.columnR, e.len ?? fp.columnH) };
    case 'beam':
      return { key: `beam@${e.len}`, geo: beamYueGeo(15, 24, e.len ?? 100) };
    case 'fang':
      return { key: `fang@${e.len}`, geo: beamGeo(10, 15, e.len ?? 100, (t) => juansha(t, 'sima', 0.08), () => 0, 6) };
    case 'lin':
      return { key: `lin@${e.len}`, geo: linGeo(8, e.len ?? 100) };
    case 'part':
    default:
      return { key: `part@${e.partType}@${p.module.grade.id}`, geo: partGeometry(e.partType!, p.module) };
  }
}

export function buildScene(gl: WebGL2RenderingContext, p: Project, prev?: BuiltScene): BuiltScene {
  prev?.meshes.forEach((m) => m.mesh.dispose());
  const ents = flattenEntities(p);
  const groups = new Map<string, { geo: GeometryData; list: Entity[] }>();

  for (const e of ents) {
    const { key, geo } = geometryForEntity(e, p);
    let g = groups.get(key);
    if (!g) { g = { geo, list: [] }; groups.set(key, g); }
    g.list.push(e);
  }

  const meshes: SceneMesh[] = [];
  const byId = new Map<number, Entity>();
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const [key, g] of groups) {
    const mesh = new Mesh(gl, g.geo);
    const kind = key.startsWith('part') ? 'part' : key.split('@')[0];
    const color = WOOD[kind] ?? WOOD.part;
    mesh.setInstances(g.list.map((e) => {
      byId.set(e.id, e);
      // 粗略包围盒累计(按构件特征尺寸外扩)
      const ext = e.kind === 'column' ? 30 : (e.len ?? 100);
      for (const [dx, dy, dz] of [[0, 0, 0], [ext, ext, ext], [0, 0, ext], [ext, ext, 0]] as const) {
        const px = e.pos[0] + dx, py = e.pos[1] + dy, pz = e.pos[2] + dz;
        min[0] = Math.min(min[0], px - ext); min[1] = Math.min(min[1], py - 10); min[2] = Math.min(min[2], pz - ext);
        max[0] = Math.max(max[0], px + ext); max[1] = Math.max(max[1], py + ext); max[2] = Math.max(max[2], pz + ext);
      }
      return {
        model: m4.compose(e.pos[0], e.pos[1], e.pos[2], (e.rotQ * Math.PI) / 2),
        color,
        pickId: e.id,
      };
    }));
    meshes.push({ mesh, key });
  }
  if (!isFinite(min[0])) { min.splice(0, 3, -100, 0, -100); max.splice(0, 3, 100, 100, 100); }
  return { meshes, bounds: { min, max }, byId };
}

/** 分° → 毫米 的整体缩放(glTF 导出用) */
export const fenScaleMm = (p: Project) => fenToMm(p.module, 1);
