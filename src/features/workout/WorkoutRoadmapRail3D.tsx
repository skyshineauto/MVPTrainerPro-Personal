import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import {
  ACESFilmicToneMapping,
  Color,
  ExtrudeGeometry,
  Group,
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

function extrudeShape(shape: Shape, depth: number, bevelSize: number, bevelThickness = bevelSize) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize,
    bevelThickness,
    steps: 1,
    curveSegments: 16,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/** Wide sculpted spine, intentionally not a rounded rectangle. */
function spineGeometry(width: number, height: number, depth: number) {
  const hw = width / 2;
  const hh = height / 2;
  const shoulder = Math.min(0.52, width * 0.055);
  const shape = new Shape();
  shape.moveTo(-hw + shoulder, -hh * 0.84);
  shape.quadraticCurveTo(-hw + shoulder * 0.24, -hh * 0.78, -hw, -hh * 0.22);
  shape.quadraticCurveTo(-hw + shoulder * 0.10, hh * 0.60, -hw + shoulder * 0.92, hh * 0.84);
  shape.quadraticCurveTo(-width * 0.18, hh * 1.02, 0, hh * 0.96);
  shape.quadraticCurveTo(width * 0.18, hh * 1.02, hw - shoulder * 0.92, hh * 0.84);
  shape.quadraticCurveTo(hw - shoulder * 0.10, hh * 0.60, hw, -hh * 0.22);
  shape.quadraticCurveTo(hw - shoulder * 0.24, -hh * 0.78, hw - shoulder, -hh * 0.84);
  shape.quadraticCurveTo(width * 0.20, -hh * 1.01, 0, -hh * 0.94);
  shape.quadraticCurveTo(-width * 0.20, -hh * 1.01, -hw + shoulder, -hh * 0.84);
  shape.closePath();
  return extrudeShape(shape, depth, Math.min(0.042, depth * 0.18));
}

/** Recessed lens / port profile, a precision slot rather than a button. */
function slotGeometry(width: number, height: number, depth: number) {
  const hw = width / 2;
  const hh = height / 2;
  const nose = Math.min(height * 0.48, width * 0.18);
  const shape = new Shape();
  shape.moveTo(-hw + nose, -hh);
  shape.lineTo(hw - nose, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, 0);
  shape.quadraticCurveTo(hw, hh, hw - nose, hh);
  shape.lineTo(-hw + nose, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, 0);
  shape.quadraticCurveTo(-hw, -hh, -hw + nose, -hh);
  shape.closePath();
  return extrudeShape(shape, depth, Math.min(0.026, depth * 0.22));
}

function PrecisionPort({
  x,
  accent,
  state,
  mobile,
  reducedMotion,
}: {
  x: number;
  accent: string;
  state: WorkoutRoadmapRailState;
  mobile: boolean;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<Group | null>(null);
  const accentColor = useMemo(() => new Color(accent), [accent]);
  const isCurrent = state === "current";
  const isNext = state === "next";
  const isDone = state === "done";
  const power = isCurrent ? 1 : isNext ? 0.62 : isDone ? 0.46 : 0.19;
  const portW = mobile ? 0.64 : 0.72;
  const portH = mobile ? 0.31 : 0.34;
  const recess = useMemo(() => slotGeometry(portW, portH, 0.11), [portW, portH]);
  const lens = useMemo(() => slotGeometry(portW * 0.78, portH * 0.50, 0.055), [portW, portH]);
  const accentLens = useMemo(() => slotGeometry(portW * 0.43, portH * 0.15, 0.025), [portW, portH]);

  useEffect(() => () => {
    recess.dispose();
    lens.dispose();
    accentLens.dispose();
  }, [recess, lens, accentLens]);

  useFrame(({ clock }) => {
    if (!groupRef.current || reducedMotion || !isCurrent) return;
    const t = clock.getElapsedTime();
    // Barely perceptible, more like live hardware breathing than animation.
    groupRef.current.position.z = 0.385 + Math.sin(t * 1.05) * 0.008;
  });

  return (
    <group ref={groupRef} position={[x, 0, 0.385]}>
      <mesh geometry={recess} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#05090c"
          metalness={0.86}
          roughness={0.34}
          clearcoat={0.42}
          clearcoatRoughness={0.18}
          envMapIntensity={1.38}
        />
      </mesh>

      <mesh geometry={lens} position={[0, 0.004, 0.074]}>
        <meshPhysicalMaterial
          color={isCurrent ? "#19242a" : "#10171b"}
          transparent
          opacity={0.94}
          metalness={0.16}
          roughness={0.105}
          clearcoat={1}
          clearcoatRoughness={0.045}
          transmission={0.10}
          thickness={0.16}
          envMapIntensity={2.35}
          emissive={accentColor}
          emissiveIntensity={0.025 + power * 0.10}
        />
      </mesh>

      <mesh geometry={accentLens} position={[0, -portH * 0.015, 0.112]}>
        <meshPhysicalMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.12 + power * 0.75}
          metalness={0.12}
          roughness={0.18}
          clearcoat={1}
          clearcoatRoughness={0.04}
          envMapIntensity={1.3}
          toneMapped={false}
        />
      </mesh>

      {/* precision white specular catch, not another colored object */}
      <mesh position={[-portW * 0.08, portH * 0.105, 0.137]} rotation={[0, 0, -0.06]}>
        <boxGeometry args={[portW * 0.30, 0.010, 0.012]} />
        <meshBasicMaterial color="#dff3f8" transparent opacity={isCurrent ? 0.34 : 0.15} />
      </mesh>

      {isDone ? (
        <group position={[portW * 0.37, -portH * 0.31, 0.14]}>
          <mesh rotation={[0, 0, -0.72]} position={[-0.032, 0.002, 0]}>
            <boxGeometry args={[0.085, 0.020, 0.018]} />
            <meshBasicMaterial color="#77e3ab" toneMapped={false} />
          </mesh>
          <mesh rotation={[0, 0, 0.70]} position={[0.027, 0.026, 0]}>
            <boxGeometry args={[0.14, 0.020, 0.018]} />
            <meshBasicMaterial color="#77e3ab" toneMapped={false} />
          </mesh>
        </group>
      ) : null}

      {isCurrent ? (
        <pointLight color={accentColor} intensity={mobile ? 0.16 : 0.20} distance={1.25} decay={2.5} position={[0, -0.05, 0.36]} />
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
  const railWidth = Math.max(4.7, viewport.width * (mobile ? 0.92 : 0.925));
  const railHeight = mobile ? 0.92 : 1.05;
  const span = railWidth * 0.80;
  const spacing = items.length > 1 ? span / (items.length - 1) : span;
  const portXs = items.map((_, index) => (items.length <= 1 ? 0 : -span / 2 + spacing * index));

  const shadowGeo = useMemo(() => spineGeometry(railWidth * 1.01, railHeight * 0.94, 0.14), [railWidth, railHeight]);
  const baseGeo = useMemo(() => spineGeometry(railWidth, railHeight, 0.34), [railWidth, railHeight]);
  const crownGeo = useMemo(() => spineGeometry(railWidth * 0.982, railHeight * 0.77, 0.14), [railWidth, railHeight]);
  const channelGeo = useMemo(() => slotGeometry(railWidth * 0.88, mobile ? 0.21 : 0.235, 0.06), [railWidth, mobile]);

  useEffect(() => () => {
    shadowGeo.dispose();
    baseGeo.dispose();
    crownGeo.dispose();
    channelGeo.dispose();
  }, [shadowGeo, baseGeo, crownGeo, channelGeo]);

  return (
    <>
      <ambientLight intensity={0.18} />
      <hemisphereLight intensity={0.33} color="#d8e6ea" groundColor="#020405" />
      <directionalLight position={[-3.8, 5.2, 6.4]} intensity={2.7} color="#f4fbfd" />
      <directionalLight position={[4.6, -2.4, 4.4]} intensity={0.48} color="#f1a46f" />
      <directionalLight position={[0.4, 0.1, 6.5]} intensity={0.55} color="#9dc8d4" />

      <Environment resolution={mobile ? 32 : 64} frames={1}>
        <Lightformer form="rect" intensity={5.4} color="#eef9fc" position={[-1.7, 4.2, 4.2]} scale={[7.2, 0.26, 1]} />
        <Lightformer form="rect" intensity={2.1} color="#9db6bd" position={[2.8, 1.5, 4]} scale={[4.4, 0.16, 1]} />
        <Lightformer form="rect" intensity={1.0} color="#d88955" position={[4.0, -2.9, 3.2]} scale={[2.5, 0.12, 1]} />
      </Environment>

      <group rotation={[mobile ? -0.01 : -0.018, 0, 0]}>
        <mesh geometry={shadowGeo} position={[0, -0.10, -0.18]} scale={[0.99, 0.93, 1]}>
          <meshBasicMaterial color="#000000" transparent opacity={0.48} depthWrite={false} />
        </mesh>

        <mesh geometry={baseGeo} castShadow receiveShadow>
          <meshPhysicalMaterial
            color="#11171b"
            metalness={0.88}
            roughness={0.43}
            clearcoat={0.38}
            clearcoatRoughness={0.19}
            envMapIntensity={1.48}
          />
        </mesh>

        <mesh geometry={crownGeo} position={[0, 0.085, 0.215]} castShadow>
          <meshPhysicalMaterial
            color="#1a2227"
            metalness={0.78}
            roughness={0.34}
            clearcoat={0.62}
            clearcoatRoughness={0.105}
            envMapIntensity={1.85}
          />
        </mesh>

        {/* upper/lower precision seams read as machining, not neon */}
        {[-0.31, 0.31].map((y) => (
          <group key={y} position={[0, y * railHeight, 0.337]}>
            <mesh>
              <boxGeometry args={[railWidth * 0.82, 0.012, 0.018]} />
              <meshStandardMaterial color={y > 0 ? "#607077" : "#050708"} metalness={0.96} roughness={0.26} envMapIntensity={1.8} />
            </mesh>
            {y > 0 ? (
              <mesh position={[0, 0.009, 0.011]}>
                <boxGeometry args={[railWidth * 0.72, 0.005, 0.008]} />
                <meshBasicMaterial color="#d9e6e9" transparent opacity={0.10} />
              </mesh>
            ) : null}
          </group>
        ))}

        <mesh geometry={channelGeo} position={[0, -0.015, 0.36]}>
          <meshPhysicalMaterial
            color="#050a0d"
            metalness={0.22}
            roughness={0.095}
            clearcoat={1}
            clearcoatRoughness={0.035}
            transmission={0.07}
            thickness={0.10}
            envMapIntensity={2.15}
          />
        </mesh>

        {/* subdued internal conductive seam, only slightly alive */}
        <mesh position={[0, -0.015, 0.402]}>
          <boxGeometry args={[railWidth * 0.835, 0.014, 0.013]} />
          <meshBasicMaterial color="#94aab0" transparent opacity={0.18} />
        </mesh>

        {portXs.slice(0, -1).map((x, index) => {
          const nextX = portXs[index + 1];
          const mid = (x + nextX) / 2;
          return (
            <group key={`seam-${items[index]?.id ?? index}`} position={[mid, 0, 0.354]}>
              <mesh>
                <boxGeometry args={[0.012, railHeight * 0.48, 0.024]} />
                <meshStandardMaterial color="#070b0d" metalness={0.92} roughness={0.31} />
              </mesh>
              <mesh position={[0.008, railHeight * 0.06, 0.018]}>
                <boxGeometry args={[0.006, railHeight * 0.32, 0.009]} />
                <meshBasicMaterial color="#b4c5ca" transparent opacity={0.085} />
              </mesh>
            </group>
          );
        })}

        {items.map((item, index) => (
          <PrecisionPort
            key={item.id}
            x={portXs[index] ?? 0}
            accent={item.accent}
            state={item.state}
            mobile={mobile}
            reducedMotion={reducedMotion}
          />
        ))}
      </group>

      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom intensity={mobile ? 0.14 : 0.18} luminanceThreshold={0.92} luminanceSmoothing={0.12} mipmapBlur radius={0.34} />
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
            dpr={mobile ? [1, 1.25] : [1, 1.65]}
            frameloop={!pageVisible || reducedMotion ? "demand" : "always"}
            camera={{ position: [0, 0.14, mobile ? 7.5 : 7.25], fov: mobile ? 30 : 28, near: 0.1, far: 40 }}
            shadows={false}
            gl={{ alpha: true, antialias: !mobile, powerPreference: "high-performance" }}
            onCreated={({ gl }) => {
              gl.toneMapping = ACESFilmicToneMapping;
              gl.toneMappingExposure = mobile ? 0.96 : 1.0;
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
              className={`tr-roadmapRail3DFallbackPort is-${item.state}`}
              style={{ "--rail-accent": item.accent } as CSSProperties}
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
