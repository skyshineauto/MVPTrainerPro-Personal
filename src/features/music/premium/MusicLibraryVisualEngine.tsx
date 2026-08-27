import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
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
      uEnergy: { value: playing ? 1 : 0.34 },
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
    const fps = mobile ? (playing ? 28 : 18) : (playing ? 48 : 28);
    const timer = window.setInterval(() => invalidate(), Math.round(1000 / fps));
    return () => window.clearInterval(timer);
  }, [invalidate, mobile, playing, reducedMotion]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, delta) => {
    const uniforms = material.uniforms;
    if (!reducedMotion) uniforms.uTime.value += Math.min(delta, 0.034);
    uniforms.uEnergy.value += ((playing ? 1 : 0.34) - uniforms.uEnergy.value) * 0.05;
    pointer.current.lerp(targetPointer.current, mobile ? 0.024 : 0.052);
    uniforms.uPointer.value.copy(pointer.current);
    state.gl.toneMapping = THREE.ACESFilmicToneMapping;
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(state.gl.toneMappingExposure, playing ? 1.00 : 0.96, 0.035);
  });

  return <mesh frustumCulled={false}><planeGeometry args={[2, 2]} /><primitive attach="material" object={material} /></mesh>;
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
        dpr={mobile ? [0.9, 1.3] : [1, 1.7]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ position: [0, 0, 1], fov: 50 }}
        frameloop="demand"
      >
        <SpectralSurface tab={activeTab} playing={visualPlaying} mobile={mobile} reducedMotion={reducedMotion} />
        {!mobile ? (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom intensity={0.16} luminanceThreshold={0.82} luminanceSmoothing={0.46} mipmapBlur />
            <Noise opacity={0.004} />
            <Vignette offset={0.22} darkness={0.50} />
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom intensity={0.10} luminanceThreshold={0.86} luminanceSmoothing={0.50} mipmapBlur />
            <Vignette offset={0.24} darkness={0.46} />
          </EffectComposer>
        )}
      </Canvas>
      {activeTab === "audition" && auditionArtworkUrl ? <div className="mlv-engineArtwork" style={{ backgroundImage: `url("${auditionArtworkUrl}")` }} /> : null}
      <div className="mlv-engineSheen" />
      <div className="mlv-engineGrain" />
    </div>
  );
}
