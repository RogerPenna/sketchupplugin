import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { DragHandle } from './EditorHelpers'
import type { InteractionMode, EditMode, AxisLock } from '../types/editor'
import type { NodeData } from '../logic/Geometry'

export function EditorNode({ node, isSelected, isHovered, onSelect, onSceneClick, interactionMode, editMode, axisLock, snapVec, onChange, orbitControlsRef, onDragStart }: { 
  node: NodeData, isSelected: boolean, isHovered: boolean, onSelect: () => void, onSceneClick: (p: THREE.Vector3, nodeId?: string, edgeId?: string) => void, interactionMode: InteractionMode, editMode: EditMode, axisLock: AxisLock, snapVec: (v: THREE.Vector3) => THREE.Vector3, onChange: (d: NodeData) => void, orbitControlsRef: any, onDragStart: () => void
}) {
  const nodeVisualsRef = useRef<THREE.Group>(null!);
  const selectionGroupRef = useRef<THREE.Group>(null!);

  const toggleOrbit = (active: boolean) => { if (orbitControlsRef.current) orbitControlsRef.current.enabled = !active; };
  const moveNode = (newPos: THREE.Vector3) => {
    const snapped = snapVec(newPos);
    const delta = snapped.clone().sub(node.pos);
    const newHandles: Record<string, THREE.Vector3> = {};
    Object.entries(node.handles).forEach(([id, h]) => {
      newHandles[id] = h.clone().add(delta);
    });
    onChange({ ...node, pos: snapped, handles: newHandles });
  };
  const updateHandle = (edgeId: string, newH: THREE.Vector3) => {
    const snapped = snapVec(newH);
    onChange({ 
      ...node, 
      handles: { ...node.handles, [edgeId]: snapped } 
    });
  };

  useFrame(({ camera }) => {
    if (!nodeVisualsRef.current) return;
    const worldPos = new THREE.Vector3().setFromMatrixPosition(nodeVisualsRef.current.matrixWorld);
    // Reduzi o fator de 0.05 para 0.025 (50% menor) e o valor base de 15 para 7.5
    const s = (camera instanceof THREE.PerspectiveCamera) 
      ? camera.position.distanceTo(worldPos) * 0.025 
      : 7.5 / camera.zoom;
    
    // Scale everything inside nodeVisualsRef (sphere + interactive area)
    nodeVisualsRef.current.scale.setScalar(s);
    
    if (selectionGroupRef.current) {
      selectionGroupRef.current.scale.setScalar(1.0); // Already inside nodeVisualsRef, so just match
    }
  });

  return (
    <group position={[node.pos.x, node.pos.y, node.pos.z]} renderOrder={1000} userData={{ nodeId: node.id }}>
      <group ref={nodeVisualsRef}>
        <mesh onClick={(e) => { 
          if (interactionMode === 'SELECT') {
            e.stopPropagation(); 
            onSelect(); 
          } else if (interactionMode === 'CREATE') {
            e.stopPropagation();
            onSceneClick(node.pos, node.id);
          }
        }} onPointerDown={(e) => {
          if (interactionMode === 'SELECT') e.stopPropagation();
        }} castShadow renderOrder={1001}>
          <sphereGeometry args={[isHovered ? 0.45 : 0.25, 32, 32]} />
          <meshBasicMaterial color={isSelected ? "yellow" : (isHovered ? "orange" : "#2222ff")} depthTest={false} />
        </mesh>

        {isSelected && interactionMode === 'SELECT' && (
          <group ref={selectionGroupRef} renderOrder={1100} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh>
              <ringGeometry args={[0.5, 0.75, 32]} />
              <meshBasicMaterial color="yellow" depthTest={false} side={THREE.DoubleSide} transparent opacity={0.6} />
            </mesh>
            <mesh>
              <circleGeometry args={[0.5, 32]} />
              <meshBasicMaterial color="yellow" depthTest={false} transparent opacity={0.3} />
            </mesh>
          </group>
        )}
      </group>
      
      <Line points={[[0, 0, 0], [0, 0, -node.pos.z]]} color="#999" lineWidth={1} transparent opacity={0.4} dashed dashSize={0.5} gapSize={0.2} depthTest={false} />

      {isSelected && interactionMode === 'SELECT' && editMode === 'MOVE_NODE' && (
        <group>
          {(axisLock === 'none' || axisLock === 'xy') && (
            <>
              <DragHandle color="#ff3333" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(1, 0, 0)} onUpdate={moveNode} onStart={() => { onDragStart(); toggleOrbit(true); }} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
              <DragHandle color="#33ff33" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(0, 1, 0)} onUpdate={moveNode} onStart={() => { onDragStart(); toggleOrbit(true); }} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            </>
          )}
          {(axisLock === 'none' || axisLock === 'z') && (
            <DragHandle color="#3333ff" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(0, 0, 1)} onUpdate={moveNode} onStart={() => { onDragStart(); toggleOrbit(true); }} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          )}
        </group>
      )}
      {isSelected && interactionMode === 'SELECT' && editMode === 'MOVE_BEZIER' && (
        <group>
          {Object.entries(node.handles).map(([edgeId, h]) => (
            <group key={edgeId}>
              <group position={h.clone().sub(node.pos)}>
                <mesh renderOrder={1500}><sphereGeometry args={[0.15]} /><meshBasicMaterial color="yellow" depthTest={false} /></mesh>
                
                {/* Invisible larger picking sphere for the handle itself */}
                <mesh 
                  onPointerDown={(e) => e.stopPropagation()} 
                  onClick={(e) => e.stopPropagation()}
                >
                  <sphereGeometry args={[0.4]} />
                  <meshBasicMaterial visible={false} />
                </mesh>

                {(axisLock === 'none' || axisLock === 'xy') && (
                  <>
                    <DragHandle color="#ff3333" axisLock={axisLock} nodePos={h} direction={new THREE.Vector3(1,0,0)} onUpdate={(p) => updateHandle(edgeId, p)} onStart={() => { onDragStart(); toggleOrbit(true); }} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
                    <DragHandle color="#33ff33" axisLock={axisLock} nodePos={h} direction={new THREE.Vector3(0,1,0)} onUpdate={(p) => updateHandle(edgeId, p)} onStart={() => { onDragStart(); toggleOrbit(true); }} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
                  </>
                )}
                {(axisLock === 'none' || axisLock === 'z') && (
                  <DragHandle color="#3333ff" axisLock={axisLock} nodePos={h} direction={new THREE.Vector3(0,0,1)} onUpdate={(p) => updateHandle(edgeId, p)} onStart={() => { onDragStart(); toggleOrbit(true); }} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
                )}
              </group>
              <Line points={[[h.x - node.pos.x, h.y - node.pos.y, h.z - node.pos.z], [0,0,0]]} color="yellow" lineWidth={1} transparent opacity={0.6} depthTest={false} />
            </group>
          ))}
        </group>
      )}
    </group>
  );
}
