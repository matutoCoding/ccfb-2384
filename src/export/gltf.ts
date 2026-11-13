// glTF 2.0 (GLB) 导出
// 单位:米。分°坐标通过节点 scale 换算(1 分° = fenMm/1000 m),查看器中尺寸即实物尺寸。
import type { Project } from '../state/store';
import { flattenEntities, fenScaleMm, geometryForEntity } from '../scene';

export function exportGLB(p: Project): Blob {
  const s = fenScaleMm(p) / 1000; // 分° → 米
  const ents = flattenEntities(p);

  const binParts: ArrayBuffer[] = [];
  let binLen = 0;
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const gltfMeshes: any[] = [];
  const materials: any[] = [];
  const nodes: any[] = [];
  const align = (n: number) => (n + 3) & ~3;

  const pushView = (buf: ArrayBuffer, target: number): number => {
    const off = align(binLen);
    if (off > binLen) { binParts.push(new ArrayBuffer(off - binLen)); binLen = off; }
    binParts.push(buf);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.byteLength, target });
    binLen += buf.byteLength;
    return bufferViews.length - 1;
  };
  const addAccessor = (view: number, compType: number, count: number, type: string, minMax?: { min: number[]; max: number[] }) => {
    const a: any = { bufferView: view, componentType: compType, count, type };
    if (minMax) { a.min = minMax.min; a.max = minMax.max; }
    accessors.push(a);
    return accessors.length - 1;
  };

  const WOOD: [number, number, number] = [0.6, 0.42, 0.27];
  materials.push({
    pbrMetallicRoughness: { baseColorFactor: [...WOOD, 1], metallicFactor: 0, roughnessFactor: 0.6 },
  });

  const meshIndexOf = new Map<string, number>();
  const slice = (a: Float32Array | Uint32Array) =>
    a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) as ArrayBuffer;

  for (const e of ents) {
    const { key, geo } = geometryForEntity(e, p);
    let mi = meshIndexOf.get(key);
    if (mi === undefined) {
      const vCount = geo.positions.length / 3;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < geo.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], geo.positions[i + k]);
          mx[k] = Math.max(mx[k], geo.positions[i + k]);
        }
      }
      gltfMeshes.push({
        primitives: [{
          attributes: {
            POSITION: addAccessor(pushView(slice(geo.positions), 34962), 5126, vCount, 'VEC3', { min: mn, max: mx }),
            NORMAL: addAccessor(pushView(slice(geo.normals), 34962), 5126, vCount, 'VEC3'),
            TEXCOORD_0: addAccessor(pushView(slice(geo.uvs), 5126), 5126, geo.uvs.length / 2, 'VEC2'),
          },
          indices: addAccessor(pushView(slice(geo.indices), 34963), 5125, geo.indices.length, 'SCALAR'),
          material: 0,
        }],
      });
      mi = gltfMeshes.length - 1;
      meshIndexOf.set(key, mi);
    }
    const angle = (e.rotQ * Math.PI) / 2;
    nodes.push({
      mesh: mi,
      translation: [e.pos[0] * s, e.pos[1] * s, e.pos[2] * s],
      rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)],
      scale: [s, s, s],
      name: `${e.kind}#${e.id}`,
    });
  }

  const gltf = {
    asset: { version: '2.0', generator: 'mugou-parametric 0.1' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials,
    bufferViews,
    accessors,
    buffers: [{ byteLength: binLen }],
  };

  // 拼 GLB:12 字节头 + JSON chunk + BIN chunk
  const jsonBuf = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = align(jsonBuf.length);
  const totalBin = align(binLen);
  const total = 12 + 8 + jsonPad + 8 + totalBin;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  let o = 0;
  dv.setUint32(o, 0x46546c67, true); o += 4;   // 'glTF'
  dv.setUint32(o, 2, true); o += 4;
  dv.setUint32(o, total, true); o += 4;
  dv.setUint32(o, jsonPad, true); o += 4;
  dv.setUint32(o, 0x4e4f534a, true); o += 4;   // 'JSON'
  new Uint8Array(out, o, jsonBuf.length).set(jsonBuf);
  for (let i = jsonBuf.length; i < jsonPad; i++) new Uint8Array(out, o + i)[0] = 0x20;
  o += jsonPad;
  dv.setUint32(o, totalBin, true); o += 4;
  dv.setUint32(o, 0x004e4942, true); o += 4;   // 'BIN\0'
  const binOut = new Uint8Array(out, o);
  let bo = 0;
  for (const part of binParts) { binOut.set(new Uint8Array(part), bo); bo += part.byteLength; }
  return new Blob([out], { type: 'model/gltf-binary' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
