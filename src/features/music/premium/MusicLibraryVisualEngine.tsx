import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
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

function MicroLightField({ palette, mobile, reducedMotion }: {
  palette: Palette;
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const count = mobile ? 72 : 170;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cool = new THREE.Color(palette.primary);
    const pale = new THREE.Color(palette.tertiary);
    const warm = new THREE.Color(palette.secondary);

    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seeded(index + 10.2) - 0.5) * (mobile ? 8.5 : 14.5);
      positions[index * 3 + 1] = (seeded(index + 40.7) - 0.5) * (mobile ? 12 : 18);
      positions[index * 3 + 2] = -7.5 + seeded(index + 80.4) * 8.5;

      const tone = seeded(index + 120.9);
      const source = tone > 0.94 ? warm : tone > 0.72 ? pale : cool;
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
    ref.current.rotation.z = Math.sin(time * 0.018) * 0.009;
    ref.current.position.x = state.pointer.x * 0.035;
    ref.current.position.y = state.pointer.y * 0.025;
  });

  return (
    <points ref={ref} geometry={geometry} renderOrder={0}>
      <pointsMaterial
        vertexColors
        size={mobile ? 0.008 : 0.011}
        transparent
        opacity={0.22}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function AmbientField({ palette, activeTab, reducedMotion }: {
  palette: Palette;
  activeTab: MusicLibraryVisualTab;
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
  }), [activeTab, primary, secondary, tertiary]);

  useFrame((state) => {
    if (!materialRef.current || reducedMotion) return;
    materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh position={[0, 0, -8.8]} scale={[15.5, 19.5, 1]} renderOrder={-2}>
      <planeGeometry args={[1, 1, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          uniform float uTime;
          uniform vec3 uPrimary;
          uniform vec3 uSecondary;
          uniform vec3 uTertiary;
          uniform float uDiscover;

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

          void main() {
            vec2 uv = vUv;
            vec2 p = uv - 0.5;
            float t = uTime * 0.035;

            float n1 = noise(uv * 3.2 + vec2(t, -t * 0.6));
            float n2 = noise(uv * 7.5 + vec2(-t * 0.45, t * 0.35));

            float leftSweep = smoothstep(0.34, 0.0, abs(p.x + 0.34 + (n1 - 0.5) * 0.08));
            leftSweep *= smoothstep(0.60, 0.02, abs(p.y - 0.10));

            float rightSweep = smoothstep(0.26, 0.0, abs(p.x - 0.39 + (n2 - 0.5) * 0.05));
            rightSweep *= smoothstep(0.48, 0.02, abs(p.y + 0.22));

            float horizon = exp(-pow((p.y + 0.33 + (n1 - 0.5) * 0.025) * 7.5, 2.0));
            float centerFalloff = 1.0 - smoothstep(0.12, 0.78, length(p * vec2(0.78, 1.0)));
            float grain = (n2 - 0.5) * 0.015;

            vec3 base = vec3(0.003, 0.010, 0.016);
            vec3 color = base;
            color += uPrimary * leftSweep * (0.045 + uDiscover * 0.014);
            color += uSecondary * rightSweep * 0.018;
            color += uTertiary * horizon * 0.020;
            color += uPrimary * centerFalloff * 0.008;
            color += grain;

            float alpha = 0.93;
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
  const discover = activeTab === "discover";

  return (
    <>
      <color attach="background" args={["#010407"]} />
      <fog attach="fog" args={["#01060a", 7.5, 19]} />
      <AmbientField palette={palette} activeTab={activeTab} reducedMotion={reducedMotion} />
      <MicroLightField palette={palette} mobile={mobile} reducedMotion={reducedMotion} />
      {!reducedMotion ? (
        <EffectComposer multisampling={mobile ? 0 : 2} enableNormalPass={false}>
          <DepthOfField
            focusDistance={0.045}
            focalLength={discover ? 0.038 : 0.032}
            bokehScale={mobile ? 0.65 : 1.15}
            height={mobile ? 320 : 640}
          />
          <Bloom
            intensity={playing ? 0.40 : 0.28}
            luminanceThreshold={0.62}
            luminanceSmoothing={0.82}
            mipmapBlur
          />
          <Noise opacity={mobile ? 0 : 0.004} />
          <Vignette offset={0.20} darkness={0.70} />
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
    <div className={`mlv-engine mlv-engine--r65 ${activeTab === "discover" ? "is-discover" : ""} ${playing ? "is-playing" : ""}`} aria-hidden="true">
      <Canvas
        dpr={mobile ? [1, 1.2] : [1, 1.5]}
        camera={{ position: [0, 0, 8], fov: 48, near: 0.1, far: 30 }}
        gl={{ alpha: true, antialias: !mobile, powerPreference: "high-performance", premultipliedAlpha: false }}
        frameloop={reducedMotion ? "demand" : "always"}
        performance={{ min: 0.6 }}
      >
        <Scene activeTab={activeTab} playing={playing} mobile={mobile} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
