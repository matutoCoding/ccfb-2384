// 视口组件:渲染循环 + 轨道相机 + 拾取 + 拖拽吸附 + FPS
import { Renderer } from '../engine/renderer';
import { OrbitCamera } from '../engine/camera';
import { m4, v3, type Vec3 } from '../engine/math';
import { buildScene, type BuiltScene } from '../scene';
import { store } from '../state/store';
import { snapToGrid } from '../geom/frame';

export type ViewMode = 'puzuo' | 'frame';

export class Viewport {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  camera = new OrbitCamera();
  scene: BuiltScene | null = null;
  mode: ViewMode = 'frame';
  fps = 0;
  onFps: ((fps: number) => void) | null = null;
  onSelect: ((id: number | null) => void) | null = null;
  /** 是否允许拖拽构件(梁架装配页开启) */
  dragEnabled = false;

  private frames = 0;
  private lastFpsT = 0;
  private dragging: { id: number; startPos: Vec3; planeY: number } | null = null;
  private orbiting = false;
  private panning = false;
  private lastX = 0; private lastY = 0;
  private moved = false;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport';
    container.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);
    this.bindInput();
    this.rebuild();
    store.subscribe(() => {
      if (!this.dragging) this.rebuild();
    });
    requestAnimationFrame((t) => this.loop(t));
  }

  rebuild() {
    const p = store.project;
    if (this.mode === 'puzuo') {
      // 斗拱编辑:只渲染一朵铺作(原点处)
      const proj = structuredClone(p);
      proj.entities = [{ id: 1, kind: 'puzuo', pos: [0, 0, 0], rotQ: 0 }];
      this.scene = buildScene(this.renderer.gl, proj, this.scene ?? undefined);
    } else {
      this.scene = buildScene(this.renderer.gl, p, this.scene ?? undefined);
    }
    this.renderer.invalidateShadow();
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.resize(r.width, r.height);
  }

  private loop(t: number) {
    this.resize();
    if (this.scene) {
      this.renderer.render(
        this.scene.meshes.map((m) => m.mesh),
        this.camera,
        store.project.render,
        store.selectedId,
        this.scene.bounds,
      );
    }
    this.frames++;
    if (t - this.lastFpsT > 500) {
      this.fps = Math.round((this.frames * 1000) / (t - this.lastFpsT));
      this.frames = 0;
      this.lastFpsT = t;
      this.onFps?.(this.fps);
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  /** 屏幕点 → 世界射线 */
  private ray(x: number, y: number): { o: Vec3; d: Vec3 } {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((x - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((y - r.top) / r.height) * 2;
    const aspect = r.width / r.height;
    const inv = m4.invert(m4.mul(this.camera.proj(aspect), this.camera.view()));
    const p0 = m4.transformPoint(inv, [nx, ny, -1]);
    const p1 = m4.transformPoint(inv, [nx, ny, 1]);
    return { o: p0, d: v3.norm(v3.sub(p1, p0)) };
  }

  /** 射线与水平面 y=h 求交 */
  private hitPlane(x: number, y: number, h: number): Vec3 | null {
    const { o, d } = this.ray(x, y);
    if (Math.abs(d[1]) < 1e-6) return null;
    const t = (h - o[1]) / d[1];
    if (t < 0) return null;
    return v3.add(o, v3.scale(d, t));
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.moved = false;
      if (e.button === 1 || e.button === 2) { this.panning = true; return; }
      if (e.button === 0) {
        const r = c.getBoundingClientRect();
        const id = this.renderer.pick(e.clientX - r.left, e.clientY - r.top);
        if (this.dragEnabled && id != null && this.scene?.byId.has(id)) {
          const ent = this.scene.byId.get(id)!;
          this.dragging = { id, startPos: [...ent.pos] as Vec3, planeY: ent.pos[1] };
          store.selectedId = id;
          this.onSelect?.(id);
        } else {
          this.orbiting = true;
        }
      }
    });
    c.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
      if (this.dragging) {
        const hit = this.hitPlane(e.clientX, e.clientY, this.dragging.planeY);
        if (hit) {
          const snapped = snapToGrid(store.project.frame, hit);
          const ent = store.project.entities.find((x) => x.id === this.dragging!.id);
          if (ent) { ent.pos = snapped; this.rebuild(); }
        }
      } else if (this.orbiting) {
        this.camera.rotate(dx, dy);
      } else if (this.panning) {
        this.camera.pan(dx, dy);
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (this.dragging) {
        const ent = store.project.entities.find((x) => x.id === this.dragging!.id);
        if (ent && (ent.pos[0] !== this.dragging.startPos[0] || ent.pos[2] !== this.dragging.startPos[2])) {
          const newPos = [...ent.pos] as Vec3;
          ent.pos = this.dragging.startPos; // 先还原,再走命令(可撤销)
          store.moveEntity(this.dragging.id, newPos as [number, number, number]);
        }
        this.dragging = null;
        this.rebuild();
      } else if (this.orbiting && !this.moved && e.button === 0) {
        // 单击拾取
        const r = c.getBoundingClientRect();
        const id = this.renderer.pick(e.clientX - r.left, e.clientY - r.top);
        store.selectedId = id;
        this.onSelect?.(id);
      }
      this.orbiting = false;
      this.panning = false;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.zoom(e.deltaY);
    }, { passive: false });
  }

  frameAll() {
    if (this.scene) this.camera.frameBounds(this.scene.bounds.min, this.scene.bounds.max);
  }
}
