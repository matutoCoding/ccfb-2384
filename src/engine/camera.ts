// 轨道相机:旋转 / 平移 / 缩放
import { m4, v3, type Mat4, type Vec3 } from './math';

export class OrbitCamera {
  target: Vec3 = [0, 100, 0];
  distance = 1200;
  theta = Math.PI / 4;   // 方位角
  phi = Math.PI / 3.2;   // 极角(自 +Y)
  fov = (45 * Math.PI) / 180;
  near = 1;
  far = 20000;

  get eye(): Vec3 {
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    return [
      this.target[0] + this.distance * sp * Math.cos(this.theta),
      this.target[1] + this.distance * cp,
      this.target[2] + this.distance * sp * Math.sin(this.theta),
    ];
  }
  view(): Mat4 { return m4.lookAt(this.eye, this.target, [0, 1, 0]); }
  proj(aspect: number): Mat4 { return m4.perspective(this.fov, aspect, this.near, this.far); }

  rotate(dx: number, dy: number) {
    this.theta -= dx * 0.008;
    this.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.phi - dy * 0.008));
  }
  pan(dx: number, dy: number) {
    const eye = this.eye;
    const fwd = v3.norm(v3.sub(this.target, eye));
    const right = v3.norm(v3.cross(fwd, [0, 1, 0]));
    const up = v3.cross(right, fwd);
    const s = this.distance * 0.0012;
    this.target = v3.add(this.target, v3.add(v3.scale(right, -dx * s), v3.scale(up, dy * s)));
  }
  zoom(delta: number) {
    this.distance = Math.min(this.far * 0.5, Math.max(10, this.distance * (1 + delta * 0.001)));
  }
  /** 聚焦到包围盒 */
  frameBounds(min: Vec3, max: Vec3) {
    this.target = v3.scale(v3.add(min, max), 0.5);
    const r = v3.len(v3.sub(max, min)) / 2;
    this.distance = Math.max(50, r / Math.sin(this.fov / 2)) * 1.1;
  }
}
