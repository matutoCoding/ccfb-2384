// WebGL2 渲染器:预_pass(法线/ID/深度)→ 阴影 → SSAO → 主 PBR → 描边合成
import { Program, Mesh, createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl';
import { m4, v3, type Vec3 } from './math';
import type { OrbitCamera } from './camera';
import * as SH from './shaders';
import type { RenderSettings } from '../state/store';

export class Renderer {
  gl: WebGL2RenderingContext;
  private prepassProg: Program;
  private shadowProg: Program;
  private ssaoProg: Program;
  private mainProg: Program;
  private outlineProg: Program;

  private prepass!: RenderTarget;      // [0]=法线+深度 [1]=拾取ID
  private prepassDepthTex!: WebGLTexture;
  private mainRT!: RenderTarget;
  private ssaoRT!: RenderTarget;
  private shadowRT!: RenderTarget;
  private quadVao: WebGLVertexArrayObject;
  private ssaoKernel: Float32Array;
  width = 1;
  height = 1;

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false })!;
    if (!gl) throw new Error('需要 WebGL2 支持');
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    this.prepassProg = new Program(gl, SH.PREPASS_VS, SH.PREPASS_FS);
    this.shadowProg = new Program(gl, SH.SHADOW_VS, SH.SHADOW_FS);
    this.ssaoProg = new Program(gl, SH.QUAD_VS, SH.SSAO_FS);
    this.mainProg = new Program(gl, SH.MAIN_VS, SH.MAIN_FS);
    this.outlineProg = new Program(gl, SH.QUAD_VS, SH.OUTLINE_FS);
    this.quadVao = gl.createVertexArray()!;

    // SSAO 半球核心(16 样本,越靠原点越密)
    const k: number[] = [];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 16; i++) {
      const s = 0.1 + 0.9 * (i / 16) ** 2;
      k.push((rand() * 2 - 1) * s, (rand() * 2 - 1) * s, rand() * s);
    }
    this.ssaoKernel = new Float32Array(k);

    this.shadowRT = createRenderTarget(gl, 2048, 2048, [], false);
    // 阴影用深度纹理
    const dt = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, dt);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 2048, 2048, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowRT.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dt, 0);
    gl.drawBuffers([gl.NONE]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    (this.shadowRT as any).depthTex = dt;
  }

  resize(w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.floor(w * dpr));
    const H = Math.max(1, Math.floor(h * dpr));
    if (W === this.width && H === this.height) return;
    this.width = W; this.height = H;
    this.canvas.width = W; this.canvas.height = H;
    const gl = this.gl;
    if (this.prepass) {
      deleteRenderTarget(gl, this.prepass);
      gl.deleteTexture(this.prepassDepthTex);
      deleteRenderTarget(gl, this.mainRT);
      deleteRenderTarget(gl, this.ssaoRT);
    }
    // 预_pass:法线+深度、拾取ID,深度用纹理(SSAO 需要)
    this.prepass = createRenderTarget(gl, W, H, [
      { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
      { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
    ], false);
    this.prepassDepthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.prepassDepthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, W, H, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepass.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.prepassDepthTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.mainRT = createRenderTarget(gl, W, H, [
      { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR },
    ], true);
    this.ssaoRT = createRenderTarget(gl, W >> 1, H >> 1, [
      { internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR },
    ], false);
  }

  private drawScene(prog: Program, meshes: Mesh[]) {
    for (const m of meshes) {
      if (m.instanceCount > 0) m.drawInstanced();
    }
  }

  private shadowDirty = true;

  /** 场景或灯光变化后调用,下一帧重烘阴影贴图(否则复用缓存) */
  invalidateShadow() { this.shadowDirty = true; }

  render(meshes: Mesh[], cam: OrbitCamera, settings: RenderSettings, selectedId: number | null, bounds: { min: Vec3; max: Vec3 }) {
    const gl = this.gl;
    const aspect = this.width / this.height;
    const view = cam.view();
    const proj = cam.proj(aspect);

    // 光源 VP(正交,包住场景包围盒)
    const ld = v3.norm(settings.lightDir);
    const center = v3.scale(v3.add(bounds.min, bounds.max), 0.5);
    const radius = Math.max(v3.len(v3.sub(bounds.max, bounds.min)) / 2, 100);
    const lightEye = v3.sub(center, v3.scale(ld, radius * 2.5));
    const lightView = m4.lookAt(lightEye, center, [0, 1, 0]);
    const lightProj = m4.ortho(-radius * 1.3, radius * 1.3, -radius * 1.3, radius * 1.3, radius * 0.1, radius * 5);
    const lightVP = m4.mul(lightProj, lightView);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    // 1. 阴影(仅场景/灯光变化时重烘,静态场景零开销)
    if (settings.shadows && this.shadowDirty) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowRT.fbo);
      gl.viewport(0, 0, 2048, 2048);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.shadowProg.use();
      this.shadowProg.setMat4('uLightVP', lightVP);
      this.drawScene(this.shadowProg, meshes);
      this.shadowDirty = false;
    }

    // 2. 预_pass(法线/深度/ID)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepass.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.prepassProg.use();
    this.prepassProg.setMat4('uView', view);
    this.prepassProg.setMat4('uProj', proj);
    this.drawScene(this.prepassProg, meshes);

    // 3. SSAO(半分辨率)
    if (settings.ssao) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoRT.fbo);
      gl.viewport(0, 0, this.ssaoRT.width, this.ssaoRT.height);
      gl.disable(gl.DEPTH_TEST);
      this.ssaoProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.prepass.textures[0]);
      this.ssaoProg.setInt('uNormalDepth', 0);
      this.ssaoProg.setMat4('uProj', proj);
      this.ssaoProg.setFloat('uRadius', 18);
      this.ssaoProg.setFloat('uAspect', aspect);
      this.ssaoProg.setFloat('uTanHalfFov', Math.tan(cam.fov / 2));
      const loc = this.ssaoProg.u('uKernel');
      if (loc) gl.uniform3fv(loc, this.ssaoKernel);
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
    }

    // 4. 主 PBR
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mainRT.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.93, 0.92, 0.90, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.mainProg.use();
    this.mainProg.setMat4('uView', view);
    this.mainProg.setMat4('uProj', proj);
    this.mainProg.setMat4('uLightVP', lightVP);
    const eye = cam.eye;
    this.mainProg.setVec3('uCamPos', eye[0], eye[1], eye[2]);
    this.mainProg.setVec3('uLightDir', ld[0], ld[1], ld[2]);
    this.mainProg.setVec3('uLightColor', 3.2, 3.0, 2.8);
    this.mainProg.setInt('uShadowOn', settings.shadows ? 1 : 0);
    this.mainProg.setInt('uAOOn', settings.ssao ? 1 : 0);
    this.mainProg.setInt('uGrainOn', settings.woodGrain ? 1 : 0);
    this.mainProg.setFloat('uExposure', settings.exposure);
    gl.uniform2f(this.mainProg.u('uResolution'), this.width, this.height);
    // 剖切平面
    const cp = settings.clipPlane;
    this.mainProg.setInt('uClipOn', cp.enabled ? 1 : 0);
    if (cp.enabled) {
      const n: Vec3 = cp.axis === 'x' ? [cp.flip ? 1 : -1, 0, 0]
        : cp.axis === 'y' ? [0, cp.flip ? 1 : -1, 0]
        : [0, 0, cp.flip ? 1 : -1];
      const d = cp.flip ? cp.pos : -cp.pos;
      gl.uniform4f(this.mainProg.u('uClipPlane'), n[0], n[1], n[2], d);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (this.shadowRT as any).depthTex);
    this.mainProg.setInt('uShadowMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, settings.ssao ? this.ssaoRT.textures[0] : this.ssaoRT.textures[0]);
    this.mainProg.setInt('uAO', 1);
    this.drawScene(this.mainProg, meshes);

    // 5. 描边合成 → 屏幕
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    this.outlineProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.prepass.textures[1]);
    this.outlineProg.setInt('uIdTex', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mainRT.textures[0]);
    this.outlineProg.setInt('uMainTex', 1);
    gl.uniform2f(this.outlineProg.u('uTexel'), 1 / this.width, 1 / this.height);
    this.outlineProg.setVec3('uOutlineColor', 1.0, 0.55, 0.1);
    this.outlineProg.setFloat('uSelectedId', selectedId ?? -1);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  }

  /** 拾取:读预_pass ID 图 */
  pick(x: number, y: number): number | null {
    const gl = this.gl;
    const dpr = this.width / this.canvas.clientWidth;
    const px = Math.floor(x * dpr);
    const py = this.height - Math.floor(y * dpr) - 1;
    const buf = new Uint8Array(4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.prepass.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    const id = buf[0] + buf[1] * 256 + buf[2] * 65536;
    return id > 0 ? id : null;
  }
}
