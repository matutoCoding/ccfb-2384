// WebGL2 底层封装:着色器编译、程序、VAO、帧缓冲
export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error:\n${log}\n--- source ---\n${src}`);
  }
  return sh;
}

export class Program {
  prog: WebGLProgram;
  private uniformCache = new Map<string, WebGLUniformLocation | null>();
  constructor(
    public gl: WebGL2RenderingContext,
    vsSrc: string,
    fsSrc: string,
  ) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, vs);
    gl.attachShader(this.prog, fs);
    gl.linkProgram(this.prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(this.prog)}`);
    }
  }
  use() { this.gl.useProgram(this.prog); }
  u(name: string): WebGLUniformLocation | null {
    if (!this.uniformCache.has(name)) {
      this.uniformCache.set(name, this.gl.getUniformLocation(this.prog, name));
    }
    return this.uniformCache.get(name)!;
  }
  setMat4(name: string, m: Float32Array) { const l = this.u(name); if (l) this.gl.uniformMatrix4fv(l, false, m); }
  setMat3(name: string, m: Float32Array) { const l = this.u(name); if (l) this.gl.uniformMatrix3fv(l, false, m); }
  setVec3(name: string, x: number, y: number, z: number) { const l = this.u(name); if (l) this.gl.uniform3f(l, x, y, z); }
  setVec4(name: string, x: number, y: number, z: number, w: number) { const l = this.u(name); if (l) this.gl.uniform4f(l, x, y, z, w); }
  setFloat(name: string, v: number) { const l = this.u(name); if (l) this.gl.uniform1f(l, v); }
  setInt(name: string, v: number) { const l = this.u(name); if (l) this.gl.uniform1i(l, v); }
  dispose() { this.gl.deleteProgram(this.prog); }
}

export interface GeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** 一个可实例化绘制的网格(VAO + 实例矩阵槽) */
export class Mesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  instanceVbo: WebGLBuffer;
  instanceCount = 0;
  constructor(public gl: WebGL2RenderingContext, geo: GeometryData) {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const mk = (data: Float32Array, loc: number, size: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    mk(geo.positions, 0, 3);
    mk(geo.normals, 1, 3);
    mk(geo.uvs, 2, 2);
    // 实例属性:mat4(4 槽)+ 颜色(1 槽)+ 拾取 id(1 槽),loc 3..8
    this.instanceVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    const stride = (16 + 4) * 4;
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(3 + i);
      gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(3 + i, 1);
    }
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 3, gl.FLOAT, false, stride, 64);
    gl.vertexAttribDivisor(7, 1);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 1, gl.FLOAT, false, stride, 76);
    gl.vertexAttribDivisor(8, 1);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.vao = vao;
    this.indexCount = geo.indices.length;
  }
  /** instances: 每个 {model: Mat4, color: [r,g,b], pickId: number} */
  setInstances(instances: { model: Float32Array; color: [number, number, number]; pickId: number }[]) {
    const n = instances.length;
    const buf = new Float32Array(n * 20);
    for (let i = 0; i < n; i++) {
      buf.set(instances[i].model, i * 20);
      buf[i * 20 + 16] = instances[i].color[0];
      buf[i * 20 + 17] = instances[i].color[1];
      buf[i * 20 + 18] = instances[i].color[2];
      buf[i * 20 + 19] = instances[i].pickId;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
    this.instanceCount = n;
  }
  drawInstanced() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0, this.instanceCount);
    gl.bindVertexArray(null);
  }
  dispose() {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.instanceVbo);
  }
}

export interface RenderTarget {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  depth: WebGLRenderbuffer | null;
  width: number;
  height: number;
}

export function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  formats: { internal: number; format: number; type: number; filter?: number }[],
  withDepth = true,
): RenderTarget {
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const textures: WebGLTexture[] = [];
  formats.forEach((f, i) => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, width, height, 0, f.format, f.type, null);
    const filter = f.filter ?? gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    textures.push(tex);
  });
  let depth: WebGLRenderbuffer | null = null;
  if (withDepth) {
    depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  gl.drawBuffers(formats.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, textures, depth, width, height };
}

export function deleteRenderTarget(gl: WebGL2RenderingContext, rt: RenderTarget) {
  gl.deleteFramebuffer(rt.fbo);
  rt.textures.forEach((t) => gl.deleteTexture(t));
  if (rt.depth) gl.deleteRenderbuffer(rt.depth);
}
