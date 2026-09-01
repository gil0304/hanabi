import * as THREE from "three";

/** 全マテリアルで共有する点サイズスケール (リサイズ時に renderer が更新) */
export interface PixelScaleUniform {
  value: number;
}

const PARTICLE_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
uniform float uPixelScale;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float ps = aSize * uPixelScale / max(0.1, -mv.z);
  // 下限: 遠景でもサブピクセルに消えない / 上限: フラッシュ用に余裕を持たせる
  gl_PointSize = clamp(ps, 1.5, 320.0);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uGlobalAlpha;
uniform vec3 uTint;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float t = texture2D(uMap, gl_PointCoord).a;
  float a = t * vAlpha * uGlobalAlpha;
  gl_FragColor = vec4(vColor * uTint * a, a);
}
`;

export function createParticleMaterial(
  map: THREE.Texture,
  pixelScale: PixelScaleUniform,
  globalAlpha: number,
  tint: THREE.Color,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      // 参照共有: renderer がリサイズで value を書き換えると全マテリアルに反映される
      uPixelScale: pixelScale,
      uGlobalAlpha: { value: globalAlpha },
      uTint: { value: tint },
    },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    // フラグメントは α 乗算済み (premultiplied) の色を出すため、
    // AdditiveBlending (SRC_ALPHA, ONE) だと α が二重に掛かり暗く潰れる。ONE/ONE で加算する。
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    transparent: true,
    depthWrite: false,
  });
}
