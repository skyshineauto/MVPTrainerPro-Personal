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

type BokehOrb = {
  position: [number, number, number];
  scale: number;
  opacity: number;
  phase: number;
  drift: number;
  warm: boolean;
};

function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function makeBokeh(count: number, mobile: boolean, discover: boolean): BokehOrb[] {
  return Array.from({ length: count }, (_, index) => {
    const a = seeded(index + 2.17);
    const b = seeded(index + 7.91);
    const c = seeded(index + 19.43);
    const d = seeded(index + 31.77);
    const depth = -5.8 + c * 9.6;
    const warm = d > (discover ? 0.73 : 0.82);
    return {
      position: [
        (a - 0.5) * (mobile ? 9 : 13.5),
        (b - 0.5) * (mobile ? 12 : 16.5),
        depth,
      ],
      scale: (mobile ? 0.055 : 0.07) + seeded(index + 51.2) * (discover ? 0.34 : 0.24),
      opacity: 0.14 + seeded(index + 81.3) * (discover ? 0.46 : 0.30),
      phase: seeded(index + 112.4) * Math.PI * 2,
      drift: 0.08 + seeded(index + 142.8) * 0.22,
      warm,
    };
  });
}

function BokehOrbMesh({ orb, palette, reducedMotion, index }: {
  orb: BokehOrb;
  palette: Palette;
  reducedMotion: boolean;
  index: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!ref.current || reducedMotion) return;
    const time = state.clock.elapsedTime;
    const x = orb.position[0] + Math.sin(time * orb.drift + orb.phase) * 0.14;
    const y = orb.position[1] + Math.cos(time * orb.drift * 0.82 + orb.phase) * 0.11;
    ref.current.position.x = x + state.pointer.x * (0.04 + Math.abs(orb.position[2]) * 0.006);
    ref.current.position.y = y + state.pointer.y * (0.03 + Math.abs(orb.position[2]) * 0.004);
    const pulse = 1 + Math.sin(time * 0.34 + orb.phase) * 0.06;
    ref.current.scale.setScalar(orb.scale * pulse);
  });

  const tone = orb.warm ? palette.secondary : index % 5 === 0 ? palette.tertiary : palette.primary;
  return (
    <mesh ref={ref} position={orb.position} scale={orb.scale} renderOrder={1}>
      <circleGeometry args={[1, 48]} />
      <meshBasicMaterial
        color={tone}
        transparent
        opacity={orb.opacity}
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function DustField({ palette, mobile, reducedMotion }: {
  palette: Palette;
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const count = mobile ? 70 : 150;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seeded(index + 210.1) - 0.5) * (mobile ? 9 : 14);
      positions[index * 3 + 1] = (seeded(index + 260.7) - 0.5) * (mobile ? 13 : 18);
      positions[index * 3 + 2] = -5 + seeded(index + 330.2) * 8;
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return next;
  }, [mobile]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (!ref.current || reducedMotion) return;
    const time = state.clock.elapsedTime;
    ref.current.rotation.z = Math.sin(time * 0.025) * 0.018;
    ref.current.position.x = state.pointer.x * 0.08;
    ref.current.position.y = state.pointer.y * 0.05;
  });

  return (
    <points ref={ref} geometry={geometry} renderOrder={0}>
      <pointsMaterial
        color={palette.primary}
        size={mobile ? 0.012 : 0.016}
        transparent
        opacity={0.28}
        depthWrite={false}
        sizeAttenuation
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function SoftVolume({ palette, discover }: { palette: Palette; discover: boolean }) {
  return (
    <group>
      <mesh position={[-4.2, 2.0, -4.8]} scale={[discover ? 4.8 : 3.8, discover ? 3.5 : 2.8, 1]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial color={palette.primary} transparent opacity={discover ? 0.035 : 0.024} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[4.8, -1.6, -3.9]} scale={[discover ? 3.9 : 3.0, discover ? 3.1 : 2.4, 1]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial color={palette.secondary} transparent opacity={discover ? 0.022 : 0.014} depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
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
  const orbCount = mobile ? (discover ? 18 : 12) : discover ? 38 : 26;
  const orbs = useMemo(() => makeBokeh(orbCount, mobile, discover), [orbCount, mobile, discover]);

  return (
    <>
      <color attach="background" args={["#010407"]} />
      <fog attach="fog" args={["#01060a", 6.5, 17.5]} />
      <SoftVolume palette={palette} discover={discover} />
      <DustField palette={palette} mobile={mobile} reducedMotion={reducedMotion} />
      {orbs.map((orb, index) => (
        <BokehOrbMesh key={`${activeTab}-${index}`} orb={orb} palette={palette} reducedMotion={reducedMotion} index={index} />
      ))}
      {!reducedMotion ? (
        <EffectComposer multisampling={mobile ? 0 : 2} enableNormalPass={false}>
          <DepthOfField
            focusDistance={discover ? 0.025 : 0.03}
            focalLength={discover ? 0.052 : 0.045}
            bokehScale={mobile ? (discover ? 2.3 : 1.8) : discover ? 4.2 : 3.0}
            height={mobile ? 360 : 720}
          />
          <Bloom
            intensity={playing ? (discover ? 0.78 : 0.62) : discover ? 0.62 : 0.46}
            luminanceThreshold={0.28}
            luminanceSmoothing={0.68}
            mipmapBlur
          />
          <Noise opacity={mobile ? 0 : 0.008} />
          <Vignette offset={0.16} darkness={discover ? 0.78 : 0.72} />
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
    <div className={`mlv-engine mlv-engine--r64 ${activeTab === "discover" ? "is-discover" : ""} ${playing ? "is-playing" : ""}`} aria-hidden="true">
      <Canvas
        dpr={mobile ? [1, 1.25] : [1, 1.65]}
        camera={{ position: [0, 0, 8], fov: 48, near: 0.1, far: 28 }}
        gl={{ alpha: true, antialias: !mobile, powerPreference: "high-performance", premultipliedAlpha: false }}
        frameloop={reducedMotion ? "demand" : "always"}
        performance={{ min: 0.55 }}
      >
        <Scene activeTab={activeTab} playing={playing} mobile={mobile} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
