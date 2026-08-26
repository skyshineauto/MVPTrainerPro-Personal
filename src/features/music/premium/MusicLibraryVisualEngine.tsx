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
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(state.gl.toneMappingExposure, playing ? 1.08 : 0.96, 0.035);
  });

  return <mesh frustumCulled={false}><planeGeometry args={[2, 2]} /><primitive attach="material" object={material} /></mesh>;
}

export function MusicLibraryVisualEngine({ activeTab, playing }: {
  activeTab: MusicLibraryVisualTab;
  playing: boolean;
}) {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

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

  return (
    <div className="mlv-engine" aria-hidden="true">
      <Canvas
        dpr={mobile ? [0.68, 1] : [0.9, 1.4]}
        gl={{ alpha: true, antialias: false, powerPreference: "high-performance" }}
        camera={{ position: [0, 0, 1], fov: 50 }}
        frameloop="demand"
      >
        <SpectralSurface tab={activeTab} playing={playing} mobile={mobile} reducedMotion={reducedMotion} />
        {!mobile ? (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom intensity={0.72} luminanceThreshold={0.54} luminanceSmoothing={0.30} mipmapBlur />
            <Noise opacity={0.012} />
            <Vignette offset={0.16} darkness={0.76} />
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom intensity={0.34} luminanceThreshold={0.64} luminanceSmoothing={0.42} mipmapBlur />
            <Vignette offset={0.19} darkness={0.70} />
          </EffectComposer>
        )}
      </Canvas>
      <div className="mlv-engineSheen" />
      <div className="mlv-engineGrain" />
    </div>
  );
}
