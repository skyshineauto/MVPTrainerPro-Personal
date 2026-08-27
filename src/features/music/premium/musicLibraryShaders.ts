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
    for (int i = 0; i < 4; i++) {
      value += amp * noise(p);
      p = p * 2.06 + vec2(9.7, 6.3);
      amp *= 0.49;
    }
    return value;
  }

  float band(float d, float width) {
    return exp(-abs(d) / max(width, 0.0001));
  }

  float ring(vec2 p, vec2 scale, float radius, float width) {
    float d = length(p * scale) - radius;
    return band(d, width);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = uv - 0.5;
    p.x *= 1.74;

    float t = uTime * (0.18 + uEnergy * 0.05);
    float n = fbm(p * 2.2 + vec2(t * 0.12, -t * 0.08));
    float nFine = fbm(p * 5.4 - vec2(t * 0.08, t * 0.06));

    vec2 pointer = (uPointer - 0.5) * vec2(1.72, 1.0);
    float pointerLight = exp(-7.0 * dot(p - pointer * 0.38, p - pointer * 0.38));

    // Localized orbital energy, not a flat full-card gradient wash.
    vec2 orbitP = p + vec2(0.16 * sin(t * 0.7), 0.04 * cos(t * 0.9));
    float orbitA = ring(orbitP + vec2(0.18, 0.02), vec2(0.72, 1.18), 0.58 + n * 0.025, 0.010);
    float orbitB = ring(orbitP - vec2(0.24, 0.00), vec2(0.82, 1.34), 0.78 + nFine * 0.018, 0.0065);
    orbitA *= smoothstep(1.15, 0.22, length(p));
    orbitB *= smoothstep(1.28, 0.28, length(p));

    // Spectral horizon and a faint animated waveform ribbon.
    float horizonY = -0.22 + 0.022 * sin(p.x * 13.0 + t * 2.6) + (n - 0.5) * 0.035;
    float horizon = band(p.y - horizonY, 0.008 + uEnergy * 0.0025) * smoothstep(1.05, 0.06, abs(p.x));

    float ribbonY = 0.07 * sin(p.x * 3.7 + t * 1.9) + 0.026 * sin(p.x * 10.0 - t * 2.3 + n * 2.0);
    float ribbon = band(p.y - ribbonY, 0.012) * 0.66;

    // Metallic caustic pools that create depth behind cards without flattening them.
    float poolA = exp(-4.6 * dot(p - vec2(-0.48, 0.16), p - vec2(-0.48, 0.16)));
    float poolB = exp(-5.2 * dot(p - vec2(0.54, -0.08), p - vec2(0.54, -0.08)));
    float caustic = pow(max(0.0, sin((p.x + p.y * 0.45 + n * 0.32) * 12.0 - t * 1.2)), 7.0);

    vec3 base = vec3(0.0035, 0.010, 0.016);
    vec3 color = base;

    color += uColorA * poolA * (0.13 + uEnergy * 0.025);
    color += uColorB * poolB * (0.12 + uEnergy * 0.025);
    color += mix(uColorA, uColorB, 0.38) * orbitA * (0.18 + uEnergy * 0.055);
    color += mix(uColorB, vec3(1.0), 0.14) * orbitB * (0.10 + uEnergy * 0.035);
    color += mix(uColorA, uColorB, smoothstep(-0.7, 0.7, p.x)) * horizon * (0.10 + uEnergy * 0.04);
    color += mix(uColorA, uColorB, 0.52 + 0.45 * sin(t + p.x)) * ribbon * (0.032 + uEnergy * 0.018);
    color += mix(uColorA, uColorB, 0.5) * caustic * (0.012 + uEnergy * 0.006);
    color += mix(uColorA, uColorB, 0.5) * pointerLight * 0.035;

    // Keep the center dark enough for typography and artwork to dominate.
    float centerShade = 1.0 - exp(-3.6 * dot(p, p));
    color *= 0.72 + centerShade * 0.34;

    // Edge falloff and subtle microtexture.
    float vignette = smoothstep(1.18, 0.20, length(p * vec2(0.86, 1.0)));
    color *= 0.56 + vignette * 0.56;
    float grain = hash21(gl_FragCoord.xy + uTime * 11.0) - 0.5;
    color += grain * (uMobile > 0.5 ? 0.0035 : 0.0065);

    gl_FragColor = vec4(color, 0.98);
  }
`;

export const MUSIC_LIBRARY_TAB_COLORS: Record<MusicLibraryVisualTab, [string, string]> = {
  songs: ["#31d8ff", "#ff9f2f"],
  artists: ["#46ddff", "#ff9a2a"],
  albums: ["#36d8ff", "#ff8928"],
  playlists: ["#35d7ff", "#ff9d30"],
  smart: ["#42ddff", "#ffa836"],
  intelligence: ["#47ddff", "#ff9c2e"],
  discover: ["#3ddcff", "#ff9630"],
  audition: ["#32ddff", "#ff982c"],
};
