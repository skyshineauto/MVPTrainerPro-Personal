import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

type MusicLibraryVisualTab =
  | "songs"
  | "artists"
  | "albums"
  | "playlists"
  | "smart"
  | "intelligence"
  | "discover"
  | "audition";

type Palette = {
  primary: string;
  secondary: string;
  tertiary: string;
};

const TAB_PALETTES: Record<MusicLibraryVisualTab, Palette> = {
  songs: { primary: "#3edcff", secondary: "#ff9f3c", tertiary: "#8deeff" },
  artists: { primary: "#45ddff", secondary: "#9a6cff", tertiary: "#72e6ff" },
  albums: { primary: "#48dfff", secondary: "#ff9d36", tertiary: "#9aefff" },
  playlists: { primary: "#45ddff", secondary: "#d35dff", tertiary: "#ff9f3b" },
  smart: { primary: "#49e5c0", secondary: "#ffc04d", tertiary: "#63dcff" },
  intelligence: { primary: "#45ddff", secondary: "#ff9d35", tertiary: "#78ebff" },
  discover: { primary: "#48dcff", secondary: "#ff9d3e", tertiary: "#87ebff" },
  audition: { primary: "#4cddff", secondary: "#ff9834", tertiary: "#8deaff" },
};

function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function MicroDepthHighlights({ palette, mobile, reducedMotion }: {
  palette: Palette;
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const count = mobile ? 26 : 64;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cool = new THREE.Color(palette.primary);
    const pale = new THREE.Color(palette.tertiary);
    const warm = new THREE.Color(palette.secondary);

    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seeded(index + 10.2) - 0.5) * (mobile ? 9 : 15.5);
      positions[index * 3 + 1] = (seeded(index + 40.7) - 0.5) * (mobile ? 13 : 20);
      positions[index * 3 + 2] = -6 + seeded(index + 80.4) * 4.5;

      const tone = seeded(index + 120.9);
      const source = tone > 0.965 ? warm : tone > 0.78 ? pale : cool;
      colors[index * 3] = source.r;
      colors[index * 3 + 1] = source.g;
      colors[index * 3 + 2] = source.b;
    }

    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    next.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return next;
  }, [mobile, palette.primary, palette.secondary, palette.tertiary]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (!ref.current || reducedMotion) return;
    const time = state.clock.elapsedTime;
    ref.current.rotation.z = Math.sin(time * 0.012) * 0.004;
    ref.current.position.x = state.pointer.x * 0.018;
    ref.current.position.y = state.pointer.y * 0.014;
  });

  return (
    <points ref={ref} geometry={geometry} renderOrder={1}>
      <pointsMaterial
        vertexColors
        size={mobile ? 0.003 : 0.0045}
        transparent
        opacity={0.13}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function HighTechAtmosphere({ palette, activeTab, playing, reducedMotion }: {
  palette: Palette;
  activeTab: MusicLibraryVisualTab;
  playing: boolean;
  reducedMotion: boolean;
}) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const primary = useMemo(() => new THREE.Color(palette.primary), [palette.primary]);
  const secondary = useMemo(() => new THREE.Color(palette.secondary), [palette.secondary]);
  const tertiary = useMemo(() => new THREE.Color(palette.tertiary), [palette.tertiary]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uPrimary: { value: primary },
    uSecondary: { value: secondary },
    uTertiary: { value: tertiary },
    uDiscover: { value: activeTab === "discover" ? 1 : 0 },
    uPlaying: { value: playing ? 1 : 0 },
  }), [activeTab, playing, primary, secondary, tertiary]);

  useFrame((state) => {
    if (!materialRef.current || reducedMotion) return;
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh frustumCulled={false} renderOrder={-10}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
        blending={THREE.NormalBlending}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          uniform float uTime;
          uniform vec3 uPrimary;
          uniform vec3 uSecondary;
          uniform vec3 uTertiary;
          uniform float uDiscover;
          uniform float uPlaying;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }

          float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;
            for (int i = 0; i < 4; i++) {
              value += amplitude * noise(p);
              p = p * 2.03 + vec2(17.13, 9.71);
              amplitude *= 0.5;
            }
            return value;
          }

          void main() {
            vec2 uv = vUv;
            vec2 p = uv - 0.5;
            float t = uTime * 0.018;

            float edgeFade = smoothstep(0.0, 0.17, uv.x) *
                             smoothstep(0.0, 0.17, 1.0 - uv.x) *
                             smoothstep(0.0, 0.14, uv.y) *
                             smoothstep(0.0, 0.14, 1.0 - uv.y);

            float slowNoise = fbm(uv * 2.1 + vec2(t, -t * 0.61));
            float fineNoise = noise(uv * 22.0 + vec2(-t * 0.35, t * 0.22));

            vec2 coolP = vec2((p.x + 0.34) * 0.72, (p.y - 0.12) * 1.12);
            vec2 warmP = vec2((p.x - 0.43) * 0.78, (p.y + 0.29) * 1.18);
            float coolLight = exp(-dot(coolP, coolP) * 7.0);
            float warmLight = exp(-dot(warmP, warmP) * 10.5);

            float filamentA = exp(-pow((p.y + 0.20 + (slowNoise - 0.5) * 0.055) * 16.0, 2.0));
            float filamentB = exp(-pow((p.x + p.y * 0.28 - 0.08 + (fineNoise - 0.5) * 0.020) * 19.0, 2.0));

            vec2 microCell = floor(uv * vec2(180.0, 120.0));
            float microSeed = hash(microCell);
            float micro = smoothstep(0.9968, 0.9995, microSeed);
            micro *= 0.35 + 0.65 * hash(microCell + 7.41);

            float gridX = 1.0 - smoothstep(0.0, 0.055, abs(fract(uv.x * 34.0) - 0.5));
            float gridY = 1.0 - smoothstep(0.0, 0.055, abs(fract(uv.y * 26.0) - 0.5));
            float microGrid = max(gridX, gridY) * 0.012;

            vec3 color = vec3(0.0);
            color += uPrimary * coolLight * (0.040 + uDiscover * 0.008);
            color += uSecondary * warmLight * 0.010;
            color += uTertiary * filamentA * 0.010;
            color += uPrimary * filamentB * 0.006;
            color += uPrimary * microGrid;
            color += mix(uPrimary, uTertiary, 0.45) * micro * (0.095 + uPlaying * 0.025);
            color += uPrimary * (slowNoise - 0.5) * 0.004;

            float luminance = max(max(color.r, color.g), color.b);
            float alpha = edgeFade * clamp(0.12 + luminance * 2.3, 0.0, 0.34);
            gl_FragColor = vec4(max(color, vec3(0.0)), alpha);
          }
        `}
      />
    </mesh>
  );
}

function Scene({ activeTab, playing, mobile, reducedMotion }: {
  activeTab: MusicLibraryVisualTab;
  playing: boolean;
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const palette = TAB_PALETTES[activeTab];

  return (
    <>
      <color attach="background" args={["#010407"]} />
      <fog attach="fog" args={["#010509", 8, 20]} />
      <HighTechAtmosphere
        palette={palette}
        activeTab={activeTab}
        playing={playing}
        reducedMotion={reducedMotion}
      />
      <MicroDepthHighlights palette={palette} mobile={mobile} reducedMotion={reducedMotion} />
      {!reducedMotion ? (
        <EffectComposer multisampling={mobile ? 0 : 2} enableNormalPass={false}>
          <Bloom
            intensity={playing ? 0.24 : 0.17}
            luminanceThreshold={0.78}
            luminanceSmoothing={0.90}
            mipmapBlur
          />
          <Noise opacity={mobile ? 0.001 : 0.0025} />
          <Vignette offset={0.19} darkness={0.61} />
        </EffectComposer>
      ) : null}
    </>
  );
}

export function MusicLibraryVisualEngine({ activeTab, playing }: {
  activeTab: MusicLibraryVisualTab;
  playing: boolean;
}) {
  const [mobile, setMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setMobile(mobileQuery.matches);
      setReducedMotion(motionQuery.matches);
    };
    sync();
    mobileQuery.addEventListener?.("change", sync);
    motionQuery.addEventListener?.("change", sync);
    return () => {
      mobileQuery.removeEventListener?.("change", sync);
      motionQuery.removeEventListener?.("change", sync);
    };
  }, []);

  return (
    <div className={`mlv-engine mlv-engine--r67 ${activeTab === "discover" ? "is-discover" : ""} ${playing ? "is-playing" : ""}`} aria-hidden="true">
      <Canvas
        dpr={mobile ? [1, 1.15] : [1, 1.4]}
        camera={{ position: [0, 0, 8], fov: 48, near: 0.1, far: 30 }}
        gl={{ alpha: true, antialias: !mobile, powerPreference: "high-performance", premultipliedAlpha: false }}
        frameloop={reducedMotion ? "demand" : "always"}
        performance={{ min: 0.68 }}
      >
        <Scene activeTab={activeTab} playing={playing} mobile={mobile} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
