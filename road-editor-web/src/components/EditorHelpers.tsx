import { useState, useRef, useMemo } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { Grid, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { AxisLock } from '../types/editor'

// Colors
export const X_COLOR = '#ff0000', Y_COLOR = '#00ff00', Z_COLOR = '#0000ff'
export const GRID_COLOR = '#d1e7f0', GRID_SECTION_COLOR = '#a0c4d1'

export function AdaptiveGrid({ visible, setSnapStep, minZ }: { visible: boolean, setSnapStep: (s: number) => void, minZ: number }) {
  const { camera, size } = useThree();
  const [config, setConfig] = useState({ cellSize: 10, sectionSize: 100 });
  
  useFrame(() => {
    if (!visible) return;
    
    // Calcular a largura visível aproximada na horizontal em metros
    let horizontalViewMeters = 100;
    if (camera instanceof THREE.OrthographicCamera) {
      horizontalViewMeters = size.width / camera.zoom;
    } else if (camera instanceof THREE.PerspectiveCamera) {
      // Use a distância real da câmera até a origem como métrica de zoom
      // Isso evita que o grid mude para 1m apenas por baixar a câmera (Z baixo mas distância alta)
      const dist = camera.position.length();
      horizontalViewMeters = dist * Math.tan((camera.fov * Math.PI) / 360) * 2 * (size.width / size.height);
    }

    let newCell = 10; // Padrão
    if (horizontalViewMeters < 50) {
      newCell = 1;
    } else if (horizontalViewMeters > 500) {
      newCell = 100;
    }

    if (config.cellSize !== newCell) { 
      setConfig({ 
        cellSize: newCell, 
        sectionSize: newCell * 10
      }); 
      setSnapStep(newCell); 
    }
  });

  if (!visible) return null;
  return (
    <gridHelper 
      args={[10000, 10000 / config.cellSize, GRID_SECTION_COLOR, GRID_COLOR]}
      position={[0, 0, minZ - 1.0]} 
      rotation={[Math.PI / 2, 0, 0]} 
      renderOrder={-10}
    />
  );
}

export function DragHandle({ direction, color, nodePos, onUpdate, onStart, onEnd, onSelect, size = 1.0, axisLock }: { 
  direction: THREE.Vector3, color: string, nodePos: THREE.Vector3, onUpdate: (newPos: THREE.Vector3) => void, onStart: () => void, onEnd: () => void, onSelect: () => void, size?: number, axisLock: AxisLock
}) {
  const { camera, raycaster } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const dragging = useRef(false);
  const plane = useRef(new THREE.Plane());
  const startNodePos = useRef(new THREE.Vector3());
  const startIntersect = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!groupRef.current) return;
    const worldPos = groupRef.current.getWorldPosition(new THREE.Vector3());
    const s = (camera instanceof THREE.PerspectiveCamera) 
      ? camera.position.distanceTo(worldPos) * 0.05 
      : 15 / camera.zoom;
    groupRef.current.scale.setScalar(s * size);
  });

  const handlePointerDown = (e: any) => {
    e.stopPropagation(); (e.target as any).setPointerCapture(e.pointerId);
    dragging.current = true; onSelect(); onStart();
    startNodePos.current.copy(nodePos);
    const lock = axisLock !== 'none' ? axisLock : (Math.abs(direction.z) > 0.5 ? 'z' : 'xy');
    if (lock === 'z') plane.current.setFromNormalAndCoplanarPoint(new THREE.Vector3().subVectors(camera.position, nodePos).setZ(0).normalize(), nodePos);
    else plane.current.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), nodePos);
    raycaster.ray.intersectPlane(plane.current, startIntersect.current);
  };

  const handlePointerMove = (e: any) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const currentIntersect = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane.current, currentIntersect)) {
      const delta = new THREE.Vector3().subVectors(currentIntersect, startIntersect.current);
      const lock = axisLock !== 'none' ? axisLock : (Math.abs(direction.z) > 0.5 ? 'z' : 'xy');
      const finalPos = startNodePos.current.clone();
      if (lock === 'z') finalPos.z += delta.z; else { finalPos.x += delta.x; finalPos.y += delta.y; }
      onUpdate(finalPos);
    }
  };

  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()), [direction]);
  return (
    <group ref={groupRef} quaternion={quat} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={() => { dragging.current = false; onEnd(); }} onClick={(e) => e.stopPropagation()} >
      <mesh position={[0, 1.2, 0]} renderOrder={2000}>
        <coneGeometry args={[0.15, 0.4, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={1.0} />
      </mesh>
      <mesh position={[0, 0.5, 0]} renderOrder={2000}>
        <cylinderGeometry args={[0.025, 0.025, 1.0, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={1.0} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 1.5, 8]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

export function AxisLines() {
  return (
    <group renderOrder={2}>
      <Line points={[[-10000, 0, 0.005], [10000, 0, 0.005]]} color={X_COLOR} lineWidth={2} transparent opacity={0.7} depthTest={false} />
      <Line points={[[0, -10000, 0.005], [0, 10000, 0.005]]} color={Y_COLOR} lineWidth={2} transparent opacity={0.7} depthTest={false} />
      <Line points={[[0, 0, -10000], [0, 0, 10000]]} color={Z_COLOR} lineWidth={2} transparent opacity={0.5} depthTest={false} />
    </group>
  );
}
