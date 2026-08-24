import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Color,
  ExtrudeGeometry,
  Group,
  ShaderMaterial,
  Shape,
  SRGBColorSpace,
} from "three";

export type WorkoutRoadmapRailState = "current" | "next" | "done" | "remaining";

export type WorkoutRoadmapRailItem = {
  id: string;
  name: string;
  accent: string;
  state: WorkoutRoadmapRailState;
};

type WorkoutRoadmapRail3DProps = {
  items: WorkoutRoadmapRailItem[];
  activeIndex: number;
  completedCount: number;
  onSelect: (index: number) => void;
};

function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return visible;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, [query]);

  return matches;
}

function supportsWebGL() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function chamferedGeometry(width: number, height: number, depth: number, chamfer: number) {
  const halfW = width / 2;
  const halfH = height / 2;
  const c = Math.min(chamfer, halfW * 0.25, halfH * 0.7);
  const shape = new Shape();
  shape.moveTo(-halfW + c, -halfH);
  shape.lineTo(halfW - c, -halfH);
  shape.lineTo(halfW, -halfH + c);
  shape.lineTo(halfW, halfH - c);
  shape.lineTo(halfW - c, halfH);
  shape.lineTo(-halfW + c, halfH);
  shape.lineTo(-halfW, halfH - c);
  shape.lineTo(-halfW, -halfH + c);
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: Math.min(0.035, depth * 0.22),
    bevelThickness: Math.min(0.035, depth * 0.22),
    steps: 1,
    curveSegments: 1,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}


function EnergyBus({ width, reducedMotion }: { width: number; reducedMotion: boolean }) {
  const materialRef = useRef<ShaderMaterial | null>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCold: { value: new Color("#48d8ff") },
      uHot: { value: new Color("#ff9a4d") },
      uStrength: { value: reducedMotion ? 0.62 : 0.82 },
    }),
    [reducedMotion]
  );

  useFrame(({ clock }) => {
    if (!materialRef.current || reducedMotion) return;
    materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
  });

  return (
    <mesh position={[0, 0, 0.34]}>
      <planeGeometry args={[width, 0.115, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        vertexShader={`
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform vec3 uCold;
          uniform vec3 uHot;
          uniform float uStrength;
          varying vec2 vUv;
          void main(){
            float center = 1.0 - smoothstep(0.0, 0.5, abs(vUv.y - 0.5) * 2.0);
            float filament = pow(center, 4.0);
            float travel = 0.55 + 0.45 * sin((vUv.x * 8.0 - uTime * 0.34) * 6.2831853);
            float micro = 0.78 + 0.22 * sin((vUv.x * 33.0 + uTime * 0.12) * 6.2831853);
            vec3 base = mix(uCold, uHot, smoothstep(0.58, 1.0, vUv.x));
            float alpha = filament * (0.38 + travel * 0.28) * micro * uStrength;
            gl_FragColor = vec4(base * (0.82 + travel * 0.34), alpha);
          }
        `}
      />
    </mesh>
  );
}

function StatusPort({
  x,
  accent,
  state,
  radius,
  reducedMotion,
}: {
  x: number;
  accent: string;
  state: WorkoutRoadmapRailState;
  radius: number;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<Group | null>(null);
  const accentColor = useMemo(() => new Color(accent), [accent]);
  const current = state === "current";
  const next = state === "next";
  const done = state === "done";
  const intensity = current ? 3.6 : next ? 2.0 : done ? 1.25 : 0.46;

  useFrame(({ clock }) => {
    if (!groupRef.current || reducedMotion || !current) return;
    const pulse = Math.sin(clock.getElapsedTime() * 1.9) * 0.012;
    const scale = 1 + Math.sin(clock.getElapsedTime() * 1.55) * 0.012;
    groupRef.current.position.z = 0.36 + pulse;
    groupRef.current.scale.setScalar(scale);
  });

  return (
    <group ref={groupRef} position={[x, 0, 0.36]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius * 1.16, radius * 1.16, 0.20, 8]} />
        <meshStandardMaterial
          color="#071219"
          metalness={0.94}
          roughness={0.23}
          envMapIntensity={1.75}
        />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.115]} castShadow>
        <cylinderGeometry args={[radius * 0.88, radius * 0.88, 0.075, 8]} />
        <meshPhysicalMaterial
          color="#06141b"
          metalness={0.46}
          roughness={0.10}
          clearcoat={1}
          clearcoatRoughness={0.055}
          transmission={0.10}
          thickness={0.22}
          envMapIntensity={2.0}
          emissive={accentColor}
          emissiveIntensity={intensity * 0.08}
        />
      </mesh>

      {[-0.115, 0, 0.115].map((barY, index) => (
        <mesh key={barY} position={[0, barY * radius * 2.15, 0.185]}>
          <boxGeometry args={[radius * (index === 1 ? 1.12 : 0.83), radius * 0.105, 0.035]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={intensity * (index === 1 ? 1.18 : 0.76)}
            roughness={0.24}
            metalness={0.24}
            toneMapped={false}
          />
        </mesh>
      ))}

      <mesh position={[0, -radius * 0.93, 0.03]}>
        <boxGeometry args={[radius * 0.72, 0.026, 0.06]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={Math.max(0.28, intensity * 0.34)}
          toneMapped={false}
        />
      </mesh>

      {done ? (
        <group position={[radius * 0.78, radius * 0.76, 0.20]}>
          <mesh>
            <sphereGeometry args={[radius * 0.19, 14, 14]} />
            <meshPhysicalMaterial
              color="#7ff0b7"
              emissive="#45e69a"
              emissiveIntensity={2.2}
              roughness={0.15}
              clearcoat={1}
              clearcoatRoughness={0.05}
              toneMapped={false}
            />
          </mesh>
          <pointLight color="#55eea2" intensity={0.55} distance={1.1} decay={2.2} />
        </group>
      ) : null}

      {current ? (
        <pointLight color={accentColor} intensity={1.2} distance={2.2} decay={2.1} position={[0, 0, 0.42]} />
      ) : next ? (
        <pointLight color={accentColor} intensity={0.42} distance={1.45} decay={2.2} position={[0, 0, 0.34]} />
      ) : null}
    </group>
  );
}

function RailScene({
  items,
  mobile,
  reducedMotion,
}: {
  items: WorkoutRoadmapRailItem[];
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const { viewport } = useThree();
  const railWidth = Math.max(4.4, viewport.width * (mobile ? 0.91 : 0.93));
  const span = railWidth * 0.82;
  const spacing = items.length > 1 ? span / (items.length - 1) : span;
  const portRadius = Math.max(0.22, Math.min(mobile ? 0.32 : 0.37, spacing * 0.25));

  const mainGeometry = useMemo(() => chamferedGeometry(railWidth, mobile ? 0.68 : 0.78, 0.31, 0.18), [railWidth, mobile]);
  const upperGeometry = useMemo(() => chamferedGeometry(railWidth * 0.975, mobile ? 0.135 : 0.15, 0.40, 0.07), [railWidth, mobile]);
  const lowerGeometry = useMemo(() => chamferedGeometry(railWidth * 0.975, mobile ? 0.135 : 0.15, 0.40, 0.07), [railWidth, mobile]);
  const channelGeometry = useMemo(() => chamferedGeometry(railWidth * 0.91, mobile ? 0.24 : 0.27, 0.10, 0.09), [railWidth, mobile]);
  const glassGeometry = useMemo(() => chamferedGeometry(railWidth * 0.955, mobile ? 0.50 : 0.57, 0.055, 0.15), [railWidth, mobile]);

  useEffect(
    () => () => {
      mainGeometry.dispose();
      upperGeometry.dispose();
      lowerGeometry.dispose();
      channelGeometry.dispose();
      glassGeometry.dispose();
    }, [mainGeometry, upperGeometry, lowerGeometry, channelGeometry, glassGeometry]
  );

  const portXs = items.map((_, index) => (items.length <= 1 ? 0 : -span / 2 + spacing * index));

  return (
    <>
      <ambientLight intensity={0.34} />
      <hemisphereLight intensity={0.55} color="#b9f1ff" groundColor="#01070a" />
      <directionalLight position={[-4, 4, 6]} intensity={2.0} color="#dff9ff" />
      <directionalLight position={[5, -2, 4]} intensity={0.72} color="#ff9a52" />
      <pointLight position={[0, 1.1, 3.2]} intensity={0.72} color="#67dfff" distance={10} />

      <Environment resolution={mobile ? 32 : 64} frames={1}>
        <Lightformer form="rect" intensity={3.6} color="#d9f8ff" position={[-2.4, 3.2, 4]} scale={[6, 0.55, 1]} />
        <Lightformer form="rect" intensity={2.0} color="#63d9ff" position={[3.2, 1.2, 3]} scale={[3.5, 0.36, 1]} />
        <Lightformer form="rect" intensity={1.75} color="#ff9850" position={[3.9, -2.4, 2]} scale={[2.4, 0.36, 1]} />
        <Lightformer form="ring" intensity={1.2} color="#ffffff" position={[0, 0, 5]} scale={[4.8, 4.8, 1]} />
      </Environment>

      <group rotation={[mobile ? -0.015 : -0.035, 0, 0]}>
        <mesh geometry={mainGeometry} castShadow receiveShadow>
          <meshPhysicalMaterial
            color="#07141b"
            metalness={0.92}
            roughness={0.30}
            clearcoat={0.66}
            clearcoatRoughness={0.12}
            envMapIntensity={1.7}
          />
        </mesh>

        <mesh geometry={upperGeometry} position={[0, mobile ? 0.36 : 0.42, 0.01]} castShadow>
          <meshStandardMaterial color="#102934" metalness={0.95} roughness={0.22} envMapIntensity={1.95} />
        </mesh>
        <mesh geometry={lowerGeometry} position={[0, mobile ? -0.36 : -0.42, 0.01]} castShadow>
          <meshStandardMaterial color="#02090d" metalness={0.92} roughness={0.32} envMapIntensity={1.45} />
        </mesh>

        <mesh geometry={channelGeometry} position={[0, 0, 0.21]}>
          <meshPhysicalMaterial
            color="#031017"
            metalness={0.26}
            roughness={0.12}
            clearcoat={1}
            clearcoatRoughness={0.05}
            transmission={0.08}
            thickness={0.18}
            envMapIntensity={1.8}
          />
        </mesh>

        <EnergyBus width={railWidth * 0.86} reducedMotion={reducedMotion} />

        {portXs.slice(0, -1).map((x, index) => {
          const nextX = portXs[index + 1];
          const mid = (x + nextX) / 2;
          return (
            <group key={`joint-${items[index]?.id ?? index}`} position={[mid, 0, 0.24]}>
              <mesh>
                <boxGeometry args={[0.035, mobile ? 0.44 : 0.52, 0.045]} />
                <meshStandardMaterial color="#183541" metalness={0.96} roughness={0.25} envMapIntensity={1.8} />
              </mesh>
              <mesh position={[0, mobile ? 0.23 : 0.27, 0.035]}>
                <sphereGeometry args={[0.027, 10, 10]} />
                <meshStandardMaterial color="#6b91a0" metalness={1} roughness={0.19} envMapIntensity={2.1} />
              </mesh>
              <mesh position={[0, mobile ? -0.23 : -0.27, 0.035]}>
                <sphereGeometry args={[0.027, 10, 10]} />
                <meshStandardMaterial color="#2c4f5c" metalness={1} roughness={0.24} envMapIntensity={1.8} />
              </mesh>
            </group>
          );
        })}

        {items.map((item, index) => (
          <StatusPort
            key={item.id}
            x={portXs[index] ?? 0}
            accent={item.accent}
            state={item.state}
            radius={portRadius}
            reducedMotion={reducedMotion}
          />
        ))}

        <mesh geometry={glassGeometry} position={[0, 0.04, 0.48]}>
          <meshPhysicalMaterial
            color="#a7e7f5"
            transparent
            opacity={0.045}
            metalness={0.05}
            roughness={0.08}
            clearcoat={1}
            clearcoatRoughness={0.035}
            transmission={0.22}
            thickness={0.12}
            envMapIntensity={2.25}
            depthWrite={false}
          />
        </mesh>
      </group>

      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom
          intensity={mobile ? 0.58 : 0.82}
          luminanceThreshold={0.72}
          luminanceSmoothing={0.16}
          mipmapBlur
          radius={0.52}
        />
      </EffectComposer>
    </>
  );
}

export function WorkoutRoadmapRail3D({
  items,
  activeIndex,
  completedCount,
  onSelect,
}: WorkoutRoadmapRail3DProps) {
  const mobile = useMediaQuery("(max-width: 720px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const pageVisible = usePageVisible();
  const [webgl] = useState(() => supportsWebGL());

  if (!items.length) return null;

  return (
    <div
      className="tr-roadmapRail3D"
      role="navigation"
      aria-label={`Workout exercise status rail. ${completedCount} of ${items.length} completed.`}
      style={{ "--tr-roadmap-rail-count": items.length } as CSSProperties}
      data-active-index={activeIndex}
    >
      {webgl ? (
        <div className="tr-roadmapRail3DCanvas" aria-hidden="true">
          <Canvas
            dpr={mobile ? [1, 1.2] : [1, 1.55]}
            frameloop={!pageVisible || reducedMotion ? "demand" : "always"}
            camera={{ position: [0, 0.18, mobile ? 7.7 : 7.35], fov: mobile ? 31 : 29, near: 0.1, far: 50 }}
            shadows={false}
            gl={{ alpha: true, antialias: !mobile, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              gl.toneMapping = ACESFilmicToneMapping;
              gl.toneMappingExposure = mobile ? 1.0 : 1.06;
              gl.outputColorSpace = SRGBColorSpace;
              gl.setClearColor(0x000000, 0);
            }}
          >
            <RailScene items={items} mobile={mobile} reducedMotion={reducedMotion} />
          </Canvas>
        </div>
      ) : (
        <div className="tr-roadmapRail3DFallback" aria-hidden="true">
          {items.map((item) => (
            <span
              key={item.id}
              className="tr-roadmapRail3DFallbackPort"
              style={{ "--rail-accent": item.state === "done" ? "#50e79d" : item.accent } as CSSProperties}
            />
          ))}
        </div>
      )}

      <div className="tr-roadmapRail3DHitGrid">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="tr-roadmapRail3DHit"
            onClick={() => onSelect(index)}
            aria-current={index === activeIndex ? "step" : undefined}
            aria-label={`${item.name}. ${item.state}. Go to exercise.`}
            title={`${item.name} • ${item.state.toUpperCase()}`}
          />
        ))}
      </div>
    </div>
  );
}
