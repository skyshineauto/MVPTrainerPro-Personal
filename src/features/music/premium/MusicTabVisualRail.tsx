import { useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { MusicLibraryVisualTab } from "./musicLibraryShaders";

const TABS: MusicLibraryVisualTab[] = ["songs","artists","albums","playlists","smart","intelligence","discover","audition"];
const BLUE = new THREE.Color("#1288f5");
const BLUE_DEEP = new THREE.Color("#0b4fb3");
const ORANGE = new THREE.Color("#f39a1f");

function Plates({ activeTab, hoveredTab }: { activeTab: MusicLibraryVisualTab; hoveredTab: MusicLibraryVisualTab | null }) {
  const { viewport } = useThree();
  const geometry = useMemo(() => ({
    width: Math.max(0.32, viewport.width / TABS.length - 0.055),
    height: Math.min(0.50, viewport.height * 0.70),
  }), [viewport.width, viewport.height]);

  return <>
    <ambientLight intensity={0.24} />
    <pointLight position={[-viewport.width * 0.32, 1.2, 2.5]} color={BLUE} intensity={4.2} distance={7} decay={2.1} />
    <pointLight position={[viewport.width * 0.34, -1.0, 2.0]} color={ORANGE} intensity={2.1} distance={6} decay={2.2} />
    {TABS.map((tab, index) => {
      const active = tab === activeTab;
      const hovered = tab === hoveredTab;
      const x = -viewport.width / 2 + geometry.width / 2 + 0.028 + index * (viewport.width / TABS.length);
      const lift = active ? 0.045 : hovered ? 0.026 : 0;
      const z = active ? 0.09 : hovered ? 0.055 : 0;
      return <group key={tab} position={[x, lift, z]}>
        <RoundedBox args={[geometry.width, geometry.height, 0.105]} radius={0.055} smoothness={8}>
          <meshPhysicalMaterial
            color={active ? "#091a26" : hovered ? "#091620" : "#061018"}
            roughness={active ? 0.28 : hovered ? 0.34 : 0.40}
            metalness={0.28}
            clearcoat={0.72}
            clearcoatRoughness={0.22}
            reflectivity={0.88}
            emissive={active ? BLUE_DEEP : hovered ? BLUE_DEEP : new THREE.Color("#000000")}
            emissiveIntensity={active ? 0.22 : hovered ? 0.09 : 0}
          />
        </RoundedBox>
        <RoundedBox args={[geometry.width * 0.86, 0.017, 0.014]} radius={0.008} smoothness={6} position={[0, -geometry.height * 0.41, 0.064]}>
          <meshStandardMaterial color={active ? BLUE : hovered ? BLUE_DEEP : "#17303f"} emissive={active ? BLUE : hovered ? BLUE_DEEP : "#000000"} emissiveIntensity={active ? 1.25 : hovered ? 0.45 : 0} roughness={0.24} metalness={0.18} />
        </RoundedBox>
        {(active || hovered) ? <RoundedBox args={[geometry.width * 0.22, 0.010, 0.012]} radius={0.005} smoothness={5} position={[geometry.width * 0.29, geometry.height * 0.40, 0.066]}>
          <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={active ? 0.78 : 0.35} roughness={0.30} />
        </RoundedBox> : null}
      </group>;
    })}
  </>;
}

export function MusicTabVisualRail({ activeTab, hoveredTab }: { activeTab: MusicLibraryVisualTab; hoveredTab: MusicLibraryVisualTab | null }) {
  return <div className="mvpTabVisualRail" aria-hidden="true">
    <Canvas orthographic camera={{ position: [0, 0, 5], zoom: 100 }} dpr={[1, 1.75]} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}>
      <Plates activeTab={activeTab} hoveredTab={hoveredTab} />
    </Canvas>
  </div>;
}
