import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import {
  MUSIC_LIBRARY_FRAGMENT_SHADER,
  MUSIC_LIBRARY_TAB_COLORS,
  MUSIC_LIBRARY_VERTEX_SHADER,
  type MusicLibraryVisualTab,
} from "./musicLibraryShaders";

function color(value: string) { return new THREE.Color(value); }

function SpectralSurface({ tab, playing, mobile, reducedMotion }: {
  tab: MusicLibraryVisualTab;
  playing: boolean;
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const pointer = useRef(new THREE.Vector2(0.5, 0.5));
  const targetPointer = useRef(new THREE.Vector2(0.5, 0.5));
  const invalidate = useThree((state) => state.invalidate);
  const palette = MUSIC_LIBRARY_TAB_COLORS[tab];
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    vertexShader: MUSIC_LIBRARY_VERTEX_SHADER,
    fragmentShader: MUSIC_LIBRARY_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: playing ? 1 : 0.32 },
      uColorA: { value: color(palette[0]) },
      uColorB: { value: color(palette[1]) },
      uPointer: { value: pointer.current },
      uMobile: { value: mobile ? 1 : 0 },
    },
  }), []);

  useEffect(() => {
    material.uniforms.uColorA.value.copy(color(palette[0]));
    material.uniforms.uColorB.value.copy(color(palette[1]));
    invalidate();
  }, [material, palette, invalidate]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      targetPointer.current.set(
        Math.min(1, Math.max(0, event.clientX / Math.max(1, window.innerWidth))),
        Math.min(1, Math.max(0, 1 - event.clientY / Math.max(1, window.innerHeight))),
      );
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => window.removeEventListener("pointermove", onPointer);
  }, []);

  useEffect(() => {
    if (reducedMotion) { invalidate(); return; }
    const fps = mobile ? (playing ? 34 : 24) : (playing ? 60 : 36);
    const timer = window.setInterval(() => invalidate(), Math.round(1000 / fps));
    return () => window.clearInterval(timer);
  }, [invalidate, mobile, playing, reducedMotion]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, delta) => {
    const uniforms = material.uniforms;
    if (!reducedMotion) uniforms.uTime.value += Math.min(delta, 0.034);
    uniforms.uEnergy.value += ((playing ? 1 : 0.32) - uniforms.uEnergy.value) * 0.045;
    pointer.current.lerp(targetPointer.current, mobile ? 0.022 : 0.046);
    uniforms.uPointer.value.copy(pointer.current);
    state.gl.toneMapping = THREE.ACESFilmicToneMapping;
    state.gl.outputColorSpace = THREE.SRGBColorSpace;
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(state.gl.toneMappingExposure, playing ? 1.02 : 0.97, 0.035);
  });

  return <mesh frustumCulled={false} position={[0, 0, -0.12]}><planeGeometry args={[2, 2]} /><primitive attach="material" object={material} /></mesh>;
}

function DepthArchitecture({ mobile, playing }: { mobile: boolean; playing: boolean }) {
  const blue = "#1288f5";
  const orange = "#f39a1f";
  const alpha = mobile ? 0.030 : 0.045;
  return <group>
    <ambientLight intensity={0.14} />
    <pointLight position={[-2.8, 1.6, 1.2]} color={blue} intensity={playing ? 1.8 : 1.15} distance={5} decay={2.2} />
    <pointLight position={[3.0, -1.8, 0.8]} color={orange} intensity={playing ? 1.05 : 0.62} distance={5} decay={2.3} />
    <RoundedBox args={[3.6, 0.42, 0.08]} radius={0.12} smoothness={8} position={[-0.8, 0.86, -1.2]} rotation={[0.08, 0.12, -0.07]}>
      <meshPhysicalMaterial color="#06111a" roughness={0.34} metalness={0.34} clearcoat={0.55} clearcoatRoughness={0.27} transparent opacity={alpha} emissive={blue} emissiveIntensity={0.055} />
    </RoundedBox>
    <RoundedBox args={[3.1, 0.34, 0.07]} radius={0.11} smoothness={8} position={[1.15, -0.70, -1.8]} rotation={[-0.06, -0.18, 0.08]}>
      <meshPhysicalMaterial color="#090f15" roughness={0.38} metalness={0.30} clearcoat={0.42} clearcoatRoughness={0.31} transparent opacity={alpha * 0.82} emissive={orange} emissiveIntensity={0.045} />
    </RoundedBox>
    <RoundedBox args={[2.2, 0.22, 0.05]} radius={0.09} smoothness={6} position={[-1.35, -1.32, -2.45]} rotation={[0.04, 0.22, -0.10]}>
      <meshPhysicalMaterial color="#061018" roughness={0.44} metalness={0.24} transparent opacity={alpha * 0.62} emissive={blue} emissiveIntensity={0.035} />
    </RoundedBox>
  </group>;
}

export function MusicLibraryVisualEngine({ activeTab, playing }: {
  activeTab: MusicLibraryVisualTab;
  playing: boolean;
}) {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [auditionPreviewPlaying, setAuditionPreviewPlaying] = useState(false);
  const [auditionArtworkUrl, setAuditionArtworkUrl] = useState<string | null>(null);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMobile = () => setMobile(mobileQuery.matches);
    const syncMotion = () => setReducedMotion(motionQuery.matches);
    mobileQuery.addEventListener("change", syncMobile);
    motionQuery.addEventListener("change", syncMotion);
    return () => {
      mobileQuery.removeEventListener("change", syncMobile);
      motionQuery.removeEventListener("change", syncMotion);
    };
  }, []);

  useEffect(() => {
    const onAuditionPreview = (event: Event) => {
      const detail = (event as CustomEvent<{ playing?: boolean; artworkUrl?: string | null }>).detail;
      setAuditionPreviewPlaying(Boolean(detail?.playing));
      if (detail?.artworkUrl) setAuditionArtworkUrl(detail.artworkUrl);
      if (detail?.playing === false && activeTab !== "audition") setAuditionArtworkUrl(null);
    };
    window.addEventListener("mvp:audition-preview-state", onAuditionPreview as EventListener);
    return () => window.removeEventListener("mvp:audition-preview-state", onAuditionPreview as EventListener);
  }, [activeTab]);

  const visualPlaying = playing || (activeTab === "audition" && auditionPreviewPlaying);

  return (
    <div className={`mlv-engine ${activeTab === "audition" && auditionPreviewPlaying ? "is-audition-preview" : ""}`} aria-hidden="true">
      <Canvas
        dpr={mobile ? [1, 1.55] : [1.2, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 0, 1.8], fov: 48, near: 0.05, far: 12 }}
        frameloop="demand"
      >
        <SpectralSurface tab={activeTab} playing={visualPlaying} mobile={mobile} reducedMotion={reducedMotion} />
        <DepthArchitecture mobile={mobile} playing={visualPlaying} />
        <EffectComposer multisampling={mobile ? 2 : 4} enableNormalPass={false}>
          <DepthOfField focusDistance={0.012} focalLength={mobile ? 0.022 : 0.028} bokehScale={reducedMotion ? 0 : mobile ? 0.75 : 1.35} height={mobile ? 360 : 560} />
          <Bloom intensity={mobile ? 0.075 : 0.105} luminanceThreshold={0.90} luminanceSmoothing={0.36} mipmapBlur />
          {!mobile ? <Noise opacity={0.0024} /> : null}
          <Vignette offset={0.28} darkness={mobile ? 0.34 : 0.38} />
        </EffectComposer>
      </Canvas>
      {activeTab === "audition" && auditionArtworkUrl ? <div className="mlv-engineArtwork" style={{ backgroundImage: `url("${auditionArtworkUrl}")` }} /> : null}
      <div className="mlv-engineSheen" />
      <div className="mlv-engineGrain" />
    </div>
  );
}
