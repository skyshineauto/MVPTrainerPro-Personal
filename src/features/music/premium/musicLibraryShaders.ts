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
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amp * noise(p);
      p = p * 2.03 + vec2(11.7, 7.1);
      amp *= 0.48;
    }
    return value;
  }

  float lineGlow(float d, float width) {
    return width / max(abs(d), 0.0008);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = uv - 0.5;
    p.x *= 1.72;

    float t = uTime * (0.055 + uEnergy * 0.022);
    vec2 drift = vec2(t * 0.15, -t * 0.12);
    float n1 = fbm(p * 2.0 + drift);
    float n2 = fbm(p * 4.0 - drift * 1.6 + 8.0);

    float radial = exp(-3.8 * dot(p, p));
    vec2 pointer = (uPointer - 0.5) * vec2(1.6, 1.0);
    float pointerGlow = exp(-5.6 * dot(p - pointer * 0.34, p - pointer * 0.34));

    float ribbonY = 0.09 * sin(p.x * 4.6 + t * 3.0 + n1 * 2.8) + 0.035 * sin(p.x * 12.0 - t * 2.0);
    float ribbon = lineGlow(p.y - ribbonY, 0.0024 + uEnergy * 0.0008);
    ribbon = min(ribbon, 1.25);

    float spectralY = -0.23 + 0.025 * sin(p.x * 16.0 + t * 5.2);
    float spectral = lineGlow(p.y - spectralY, 0.0011);
    spectral *= smoothstep(0.95, 0.05, abs(p.x));
    spectral = min(spectral, 0.6);

    vec3 base = vec3(0.006, 0.015, 0.024);
    vec3 field = mix(uColorA, uColorB, smoothstep(-0.7, 0.72, p.x + n1 * 0.27));
    field *= (0.075 + radial * 0.18 + n1 * 0.065 + pointerGlow * 0.08);

    vec3 ribbonColor = mix(uColorA, uColorB, 0.45 + 0.45 * sin(t + p.x * 2.0));
    vec3 color = base + field;
    color += ribbonColor * ribbon * (0.095 + uEnergy * 0.045);
    color += mix(uColorB, vec3(1.0), 0.18) * spectral * (0.055 + uEnergy * 0.02);

    float edge = smoothstep(0.82, 0.1, length(p));
    color *= 0.58 + edge * 0.58;

    // Fine metallic micro-structure. Kept intentionally subtle.
    float grain = hash21(gl_FragCoord.xy + uTime * 12.0) - 0.5;
    color += grain * (uMobile > 0.5 ? 0.005 : 0.009);

    float alpha = 0.94;
    gl_FragColor = vec4(color, alpha);
  }
`;

export const MUSIC_LIBRARY_TAB_COLORS: Record<MusicLibraryVisualTab, [string, string]> = {
  songs: ["#32d7ff", "#ff9d28"],
  artists: ["#5be7ff", "#8f63ff"],
  albums: ["#47d8ff", "#ff7a21"],
  playlists: ["#37d7ff", "#f45be8"],
  smart: ["#59f0bf", "#ffbd4d"],
  intelligence: ["#42d7ff", "#ff8a22"],
  discover: ["#34e3ff", "#f451a4"],
  audition: ["#28d9ff", "#ff8c1f"],
};
