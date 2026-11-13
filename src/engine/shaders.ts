// 全部 GLSL 着色器(ES 3.00)
const V = '#version 300 es\n';
const F = '#version 300 es\nprecision highp float;\n';

// ---------- 几何预_pass:法线 + 拾取ID + 深度(供 SSAO / 描边 / 拾取) ----------
export const PREPASS_VS = V + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=3) in mat4 aModel;   // loc 3..6
layout(location=8) in float aPickId;
uniform mat4 uView, uProj;
out vec3 vNormal;
out vec3 vViewPos;
flat out float vPickId;
void main(){
  vec4 wp = aModel * vec4(aPos,1.0);
  vec4 vp = uView * wp;
  vViewPos = vp.xyz;
  vNormal = mat3(uView) * mat3(aModel) * aNormal;
  vPickId = aPickId;
  gl_Position = uProj * vp;
}`;

export const PREPASS_FS = F + `
in vec3 vNormal;
in vec3 vViewPos;
flat in float vPickId;
layout(location=0) out vec4 outNormalDepth;
layout(location=1) out vec4 outId;
void main(){
  vec3 n = normalize(vNormal) * 0.5 + 0.5;
  outNormalDepth = vec4(n, -vViewPos.z);          // 视图空间深度
  float id = vPickId;
  outId = vec4(mod(id,256.0)/255.0, mod(floor(id/256.0),256.0)/255.0, mod(floor(id/65536.0),256.0)/255.0, 1.0);
}`;

// ---------- 阴影贴图(深度) ----------
export const SHADOW_VS = V + `
layout(location=0) in vec3 aPos;
layout(location=3) in mat4 aModel;
uniform mat4 uLightVP;
void main(){ gl_Position = uLightVP * aModel * vec4(aPos,1.0); }`;

export const SHADOW_FS = F + `void main(){}`;

// ---------- SSAO ----------
export const SSAO_FS = F + `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uNormalDepth;
uniform mat4 uProj;
uniform vec3 uKernel[16];
uniform vec2 uNoiseScale;
uniform float uRadius;
uniform mat4 uProjInv;
uniform float uAspect;
uniform float uTanHalfFov;

vec3 viewPosFromDepth(vec2 uv, float viewZ){
  // 由视图空间深度重建视图坐标(透视)
  vec2 ndc = uv * 2.0 - 1.0;
  float x = ndc.x * uTanHalfFov * uAspect * (-viewZ);
  float y = ndc.y * uTanHalfFov * (-viewZ);
  return vec3(x, y, viewZ);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

void main(){
  vec4 nd = texture(uNormalDepth, vUV);
  float depth = nd.w;
  if (depth <= 0.0) { outColor = vec4(1.0); return; }
  vec3 N = normalize(nd.xyz * 2.0 - 1.0);
  vec3 P = viewPosFromDepth(vUV, -depth);
  // 屏幕空间随机旋转
  float a = hash(gl_FragCoord.xy) * 6.2831;
  vec2 r = vec2(cos(a), sin(a));
  vec3 rv1 = normalize(vec3(r, 0.0));
  vec3 rv2 = normalize(cross(N, rv1));
  rv1 = cross(rv2, N);
  mat3 TBN = mat3(rv1, rv2, N);
  float occ = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 sp = P + TBN * uKernel[i] * uRadius;
    vec4 off = uProj * vec4(sp, 1.0);
    vec2 suv = off.xy / off.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sd = texture(uNormalDepth, suv).w;
    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(abs(depth - sd), 1e-4));
    occ += (sd >= -sp.z - 0.02*uRadius ? 1.0 : 0.0) * rangeCheck;
  }
  outColor = vec4(vec3(1.0 - occ / 16.0), 1.0);
}`;

// ---------- 主渲染:PBR(GGX)+ 方向光阴影 + 过程木纹 + SSAO + 剖切 ----------
export const MAIN_VS = V + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in mat4 aModel;
layout(location=7) in vec3 aColor;
uniform mat4 uView, uProj;
out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
void main(){
  vec4 wp = aModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(aModel) * aNormal;
  vUV = aUV;
  vColor = aColor;
  gl_Position = uProj * uView * wp;
}`;

export const MAIN_FS = F + `
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
out vec4 outColor;

uniform vec3 uCamPos;
uniform vec3 uLightDir;      // 指向光源
uniform vec3 uLightColor;
uniform sampler2D uShadowMap;
uniform mat4 uLightVP;
uniform bool uShadowOn;
uniform sampler2D uAO;
uniform bool uAOOn;
uniform bool uGrainOn;
uniform float uExposure;
uniform bool uClipOn;
uniform vec4 uClipPlane;     // xyz 法线, w = -d
uniform vec2 uResolution;

// --- 过程木纹:年轮 + 细纤维噪声 ---
float hash3(vec3 p){ return fract(sin(dot(p, vec3(17.1, 31.7, 11.3))) * 43758.5453); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a=hash3(i), b=hash3(i+vec3(1,0,0)), c=hash3(i+vec3(0,1,0)), d=hash3(i+vec3(1,1,0));
  float e=hash3(i+vec3(0,0,1)), g=hash3(i+vec3(1,0,1)), h=hash3(i+vec3(0,1,1)), k=hash3(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y), mix(mix(e,g,f.x),mix(h,k,f.x),f.y), f.z);
}
vec3 woodColor(vec3 wp, vec3 base){
  // 沿 Y(木纹方向)拉伸的环纹
  vec3 p = wp * 0.35;
  float rings = sin(length(p.xz * vec2(1.0, 1.4)) * 6.0 + vnoise(p*2.0)*3.0 + p.y*0.15);
  float fiber = vnoise(vec3(p.x*8.0, p.y*0.6, p.z*8.0));
  float t = 0.5 + 0.28*rings + 0.22*(fiber-0.5);
  vec3 dark = base * 0.62;
  vec3 light = base * 1.12;
  return mix(dark, light, clamp(t, 0.0, 1.0));
}

// --- PBR(GGX) ---
const float PI = 3.14159265;
float D_GGX(float NoH, float rough){
  float a = rough*rough; float a2 = a*a;
  float d = NoH*NoH*(a2-1.0)+1.0;
  return a2 / (PI*d*d);
}
float G_Smith(float NoV, float NoL, float rough){
  float k = (rough+1.0); k = k*k/8.0;
  float g1 = NoV/(NoV*(1.0-k)+k);
  float g2 = NoL/(NoL*(1.0-k)+k);
  return g1*g2;
}
vec3 F_Schlick(vec3 F0, float VoH){
  return F0 + (1.0-F0)*pow(1.0-VoH, 5.0);
}

float shadowPCF(vec3 wp){
  vec4 lp = uLightVP * vec4(wp, 1.0);
  vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
  if (c.x<0.0||c.x>1.0||c.y<0.0||c.y>1.0||c.z>1.0) return 1.0;
  float bias = 0.0015;
  float sum = 0.0;
  vec2 texel = vec2(1.0/2048.0);
  for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++)
    sum += texture(uShadowMap, c.xy + vec2(float(x),float(y))*texel).r > c.z - bias ? 1.0 : 0.0;
  return sum / 9.0;
}

vec3 aces(vec3 x){
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}

void main(){
  if (uClipOn && dot(vec4(vWorldPos,1.0), uClipPlane) < 0.0) discard;

  vec3 N = normalize(vNormal);
  vec3 Vv = normalize(uCamPos - vWorldPos);
  vec3 albedo = uGrainOn ? woodColor(vWorldPos, vColor) : vColor;
  float rough = 0.55 + 0.15*(uGrainOn ? vnoise(vWorldPos*0.5)-0.5 : 0.0);
  vec3 F0 = vec3(0.04);

  vec3 L = normalize(-uLightDir);
  vec3 H = normalize(Vv + L);
  float NoL = max(dot(N,L), 0.0);
  float NoV = max(dot(N,Vv), 1e-4);
  float NoH = max(dot(N,H), 0.0);
  float VoH = max(dot(Vv,H), 0.0);

  float D = D_GGX(NoH, rough);
  float G = G_Smith(NoV, NoL, rough);
  vec3 F = F_Schlick(F0, VoH);
  vec3 spec = D*G*F / max(4.0*NoV*NoL, 1e-4);
  vec3 diff = (1.0-F) * albedo / PI;

  float sh = uShadowOn ? shadowPCF(vWorldPos) : 1.0;
  vec3 direct = (diff + spec) * uLightColor * NoL * sh;

  float ao = uAOOn ? texture(uAO, gl_FragCoord.xy / uResolution).r : 1.0;
  vec3 ambient = albedo * 0.35 * ao;

  vec3 col = direct + ambient;
  col = aces(col * uExposure);
  col = pow(col, vec3(1.0/2.2));
  outColor = vec4(col, 1.0);
}`;

// ---------- 全屏三角形 ----------
export const QUAD_VS = V + `
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2));
  vUV = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

// ---------- 选中描边:对拾取 ID 图做边缘检测 ----------
export const OUTLINE_FS = F + `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uIdTex;
uniform sampler2D uMainTex;
uniform vec2 uTexel;
uniform vec3 uOutlineColor;
uniform float uSelectedId;

float idAt(vec2 uv){
  vec4 c = texture(uIdTex, uv);
  return c.r*255.0 + floor(c.g*255.0+0.5)*256.0 + floor(c.b*255.0+0.5)*65536.0;
}
void main(){
  vec4 base = texture(uMainTex, vUV);
  float c = idAt(vUV);
  bool isSel = abs(c - uSelectedId) < 0.5;
  bool nearSel = false;
  for (int x=-2;x<=2;x++) for (int y=-2;y<=2;y++){
    float n = idAt(vUV + vec2(float(x),float(y))*uTexel);
    if (abs(n - uSelectedId) < 0.5) nearSel = true;
  }
  if (!isSel && nearSel && uSelectedId > 0.5) {
    outColor = vec4(mix(base.rgb, uOutlineColor, 0.85), 1.0);
  } else {
    outColor = base;
  }
}`;

// ---------- 拷贝(主色 → 屏幕) ----------
export const COPY_FS = F + `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uTex;
void main(){ outColor = texture(uTex, vUV); }`;
