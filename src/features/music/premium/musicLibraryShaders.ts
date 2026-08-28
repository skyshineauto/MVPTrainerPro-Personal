export type MusicLibraryVisualTab =
  | "songs"
  | "artists"
  | "albums"
  | "playlists"
  | "smart"
  | "intelligence"
  | "discover"
  | "audition";

export const MUSIC_LIBRARY_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const MUSIC_LIBRARY_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec2 uPointer;
  uniform float uMobile;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += noise(p) * a;
      p = p * 2.04 + vec2(7.4, 9.1);
      a *= 0.48;
    }
    return v;
  }

  void main() {
    vec2 p = vUv - 0.5;
    p.x *= 1.7;
    float t = uTime * (0.08 + uEnergy * 0.018);
    float n = fbm(p * 2.15 + vec2(t * 0.18, -t * 0.12));
    float fine = fbm(p * 6.0 - vec2(t * 0.07, t * 0.05));

    vec2 pointer = (uPointer - 0.5) * vec2(1.55, 0.95);
    float pointerPool = exp(-5.8 * dot(p - pointer * 0.25, p - pointer * 0.25));

    float bluePool = exp(-5.2 * dot(p - vec2(-0.52, 0.12), p - vec2(-0.52, 0.12)));
    float orangePool = exp(-6.0 * dot(p - vec2(0.58, -0.12), p - vec2(0.58, -0.12)));

    float sweepX = p.x + 0.24 * p.y + 0.08 * sin(t + p.y * 3.0);
    float specular = exp(-pow((sweepX - 0.05) * 7.0, 2.0));
    specular *= smoothstep(0.52, -0.20, abs(p.y));

    float micro = pow(max(0.0, sin((p.x * 1.8 + p.y * 0.8 + n * 0.25) * 15.0 - t)), 10.0);

    vec3 base = vec3(0.0028, 0.0065, 0.0105);
    vec3 color = base;
    color += uColorA * bluePool * (0.040 + uEnergy * 0.010);
    color += uColorB * orangePool * (0.026 + uEnergy * 0.007);
    color += mix(uColorA, vec3(1.0), 0.16) * specular * 0.014;
    color += uColorA * pointerPool * 0.008;
    color += mix(uColorA, uColorB, 0.35) * micro * 0.0025;

    float center = exp(-2.7 * dot(p * vec2(0.74, 1.0), p * vec2(0.74, 1.0)));
    color *= 0.78 + (1.0 - center) * 0.20;

    float edge = smoothstep(1.20, 0.24, length(p * vec2(0.82, 1.0)));
    color *= 0.74 + edge * 0.28;

    float grain = hash21(gl_FragCoord.xy + uTime * 9.0) - 0.5;
    color += grain * (uMobile > 0.5 ? 0.0020 : 0.0034);
    color += (fine - 0.5) * 0.0012;

    gl_FragColor = vec4(color, 0.92);
  }
`;

export const MUSIC_LIBRARY_TAB_COLORS: Record<MusicLibraryVisualTab, [string, string]> = {
  songs: ["#0361DF", "#EB8B0F"],
  artists: ["#0361DF", "#EB8B0F"],
  albums: ["#0361DF", "#EB8B0F"],
  playlists: ["#0361DF", "#EB8B0F"],
  smart: ["#0361DF", "#EB8B0F"],
  intelligence: ["#0361DF", "#EB8B0F"],
  discover: ["#0361DF", "#EB8B0F"],
  audition: ["#0361DF", "#EB8B0F"],
};
