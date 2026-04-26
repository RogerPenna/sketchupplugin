import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, PerspectiveCamera, OrthographicCamera, Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { RoadGeometry, type NodeData, type EdgeData } from './logic/Geometry'
import { ImportLoaders, type LayerData } from './logic/ImportLoaders'
import './App.css'

// Colors
const X_COLOR = '#ff0000', Y_COLOR = '#00ff00', Z_COLOR = '#0000ff'
const GRID_COLOR = '#d1e7f0', GRID_SECTION_COLOR = '#a0c4d1'

type InteractionMode = 'SELECT' | 'CREATE' | 'calibrate_origin' | 'calibrate_scale_p1' | 'calibrate_scale_p2';
type EditMode = 'MOVE_NODE' | 'MOVE_BEZIER';
type AxisLock = 'none' | 'xy' | 'z';

function AdaptiveGrid({ visible, setSnapStep, minZ }: { visible: boolean, setSnapStep: (s: number) => void, minZ: number }) {
  const { camera } = useThree();
  const [config, setConfig] = useState({ cellSize: 1, sectionSize: 10, fadeDistance: 600 });
  useFrame(() => {
    if (!visible) return;
    let dist = (camera instanceof THREE.PerspectiveCamera) ? camera.position.length() : 600 / camera.zoom;
    let newCell = dist > 800 ? 50 : (dist > 300 ? 10 : (dist < 40 ? 0.5 : 1));
    if (config.cellSize !== newCell) { setConfig({ cellSize: newCell, sectionSize: newCell * 10, fadeDistance: newCell * 400 }); setSnapStep(newCell); }
  });
  if (!visible) return null;
  // Positioned slightly below minZ to avoid road conflict
  return <Grid position={[0, 0, minZ - 0.05]} infiniteGrid fadeDistance={config.fadeDistance} sectionSize={config.sectionSize} sectionThickness={1.5} sectionColor={GRID_SECTION_COLOR} cellSize={config.cellSize} cellThickness={0.8} cellColor={GRID_COLOR} rotation={[Math.PI / 2, 0, 0]} renderOrder={1} />;
}

function DragHandle({ direction, color, nodePos, onUpdate, onStart, onEnd, onSelect, size = 1.0, axisLock }: { 
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
      {/* Arrow Head: starts at 1.0 (stem end) and goes to 1.4 */}
      <mesh position={[0, 1.2, 0]} renderOrder={2000}>
        <coneGeometry args={[0.15, 0.4, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={1.0} />
      </mesh>
      {/* Arrow Stem: 1.0 length, offset by 0.5 so base is at 0.0 */}
      <mesh position={[0, 0.5, 0]} renderOrder={2000}>
        <cylinderGeometry args={[0.025, 0.025, 1.0, 16]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={1.0} />
      </mesh>
      {/* Invisible Pick Area */}
      <mesh position={[0, 0.7, 0]} visible={false}><cylinderGeometry args={[0.3, 0.3, 1.5, 8]} /></mesh>
    </group>
  );
}

function AxisLines() {
  return (
    <group renderOrder={0}>
      <Line points={[[-1000, 0, 0], [1000, 0, 0]]} color={X_COLOR} lineWidth={1} transparent opacity={0.5} depthTest={false} />
      <Line points={[[0, -1000, 0], [0, 1000, 0]]} color={Y_COLOR} lineWidth={1} transparent opacity={0.5} depthTest={false} />
      <Line points={[[0, 0, -1000], [0, 0, 1000]]} color={Z_COLOR} lineWidth={1} transparent opacity={0.5} depthTest={false} />
    </group>
  );
}

function Node({ node, isSelected, isHovered, onSelect, onSceneClick, interactionMode, editMode, axisLock, snapVec, onChange, orbitControlsRef }: { 
  node: NodeData, isSelected: boolean, isHovered: boolean, onSelect: () => void, onSceneClick: (p: THREE.Vector3, nodeId?: string, edgeId?: string) => void, interactionMode: InteractionMode, editMode: EditMode, axisLock: AxisLock, snapVec: (v: THREE.Vector3) => THREE.Vector3, onChange: (d: NodeData) => void, orbitControlsRef: any
}) {
  const selectionGroupRef = useRef<THREE.Group>(null!);
  const { camera } = useThree();

  const toggleOrbit = (active: boolean) => { if (orbitControlsRef.current) orbitControlsRef.current.enabled = !active; };
  const moveNode = (newPos: THREE.Vector3) => {
    const snapped = snapVec(newPos);
    const delta = snapped.clone().sub(node.pos);
    onChange({ ...node, pos: snapped, left_h: node.left_h.clone().add(delta), right_h: node.right_h.clone().add(delta) });
  };
  const mirrorHandles = (newH: THREE.Vector3, isLeft: boolean) => {
    const snapped = snapVec(newH);
    const rel = snapped.clone().sub(node.pos);
    const mirrored = node.pos.clone().sub(rel);
    onChange(isLeft ? { ...node, left_h: snapped, right_h: mirrored } : { ...node, right_h: snapped, left_h: mirrored });
  };

  useFrame(() => {
    if (!selectionGroupRef.current) return;
    const s = (camera instanceof THREE.PerspectiveCamera) 
      ? camera.position.distanceTo(node.pos) * 0.05 
      : 15 / camera.zoom;
    selectionGroupRef.current.scale.setScalar(s);
  });

  return (
    <group position={[node.pos.x, node.pos.y, node.pos.z]} renderOrder={500} userData={{ nodeId: node.id }}>
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
      }} castShadow>
        <sphereGeometry args={[isHovered ? 0.45 : 0.25, 32, 32]} />
        <meshBasicMaterial color={isSelected ? "yellow" : (isHovered ? "orange" : "#2222ff")} depthTest={false} />
      </mesh>
      
      {/* Vertical helper line to Z=0 */}
      <Line points={[[0, 0, 0], [0, 0, -node.pos.z]]} color="#999" lineWidth={1} transparent opacity={0.4} dashed dashSize={0.5} gapSize={0.2} depthTest={false} />

      {isSelected && interactionMode === 'SELECT' && (
        <group ref={selectionGroupRef} renderOrder={1000} rotation={[-Math.PI / 2, 0, 0]}>
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

      {isSelected && interactionMode === 'SELECT' && editMode === 'MOVE_NODE' && (
        <group>
          {(axisLock === 'none' || axisLock === 'xy') && (
            <>
              <DragHandle color="#ff3333" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(1, 0, 0)} onUpdate={moveNode} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
              <DragHandle color="#33ff33" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(0, 1, 0)} onUpdate={moveNode} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            </>
          )}
          {(axisLock === 'none' || axisLock === 'z') && (
            <DragHandle color="#3333ff" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(0, 0, 1)} onUpdate={moveNode} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          )}
        </group>
      )}
      {isSelected && interactionMode === 'SELECT' && editMode === 'MOVE_BEZIER' && (
        <group>
          <group position={node.left_h.clone().sub(node.pos)}>
            <mesh renderOrder={1500}><sphereGeometry args={[0.15]} /><meshBasicMaterial color="cyan" depthTest={false} /></mesh>
            {(axisLock === 'none' || axisLock === 'xy') && (
              <>
                <DragHandle color="#ff3333" axisLock={axisLock} nodePos={node.left_h} direction={new THREE.Vector3(1,0,0)} onUpdate={(p) => mirrorHandles(p, true)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
                <DragHandle color="#33ff33" axisLock={axisLock} nodePos={node.left_h} direction={new THREE.Vector3(0,1,0)} onUpdate={(p) => mirrorHandles(p, true)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
              </>
            )}
            {(axisLock === 'none' || axisLock === 'z') && (
              <DragHandle color="#3333ff" axisLock={axisLock} nodePos={node.left_h} direction={new THREE.Vector3(0,0,1)} onUpdate={(p) => mirrorHandles(p, true)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
            )}
          </group>
          <group position={node.right_h.clone().sub(node.pos)}>
            <mesh renderOrder={1500}><sphereGeometry args={[0.15]} /><meshBasicMaterial color="cyan" depthTest={false} /></mesh>
            {(axisLock === 'none' || axisLock === 'xy') && (
              <>
                <DragHandle color="#ff3333" axisLock={axisLock} nodePos={node.right_h} direction={new THREE.Vector3(1,0,0)} onUpdate={(p) => mirrorHandles(p, false)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
                <DragHandle color="#33ff33" axisLock={axisLock} nodePos={node.right_h} direction={new THREE.Vector3(0,1,0)} onUpdate={(p) => mirrorHandles(p, false)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
              </>
            )}
            {(axisLock === 'none' || axisLock === 'z') && (
              <DragHandle color="#3333ff" axisLock={axisLock} nodePos={node.right_h} direction={new THREE.Vector3(0,0,1)} onUpdate={(p) => mirrorHandles(p, false)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} size={0.7} />
            )}
          </group>
          <Line points={[[node.left_h.x-node.pos.x, node.left_h.y-node.pos.y, node.left_h.z-node.pos.z], [0,0,0], [node.right_h.x-node.pos.x, node.right_h.y-node.pos.y, node.right_h.z-node.pos.z]]} color="cyan" lineWidth={1} transparent opacity={0.6} depthTest={false} />
        </group>
      )}
    </group>
  );
}

function Segment({ edge, nodesMap, isSelected, isHovered, onSelect, onSceneClick, interactionMode }: { edge: EdgeData, nodesMap: Record<string, NodeData>, isSelected: boolean, isHovered: boolean, onSelect: () => void, onSceneClick: (p: THREE.Vector3, nodeId?: string, edgeId?: string) => void, interactionMode: InteractionMode }) {
  const n1 = nodesMap[edge.n1], n2 = nodesMap[edge.n2];
  if (!n1 || !n2) return null;
  const curve = useMemo(() => new THREE.CubicBezierCurve3(n1.pos, n1.right_h, n2.left_h, n2.pos), [n1.pos, n1.right_h, n2.left_h, n2.pos]);
  const points = useMemo(() => curve.getPoints(24), [curve]);
  const length = useMemo(() => curve.getLength(), [curve]);
  const angle = useMemo(() => {
    const dir = n2.pos.clone().sub(n1.pos).setZ(0).normalize();
    let ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
    return ang < 0 ? ang + 360 : ang;
  }, [n1.pos, n2.pos]);

  const roadGeometry = useMemo(() => {
    const pathPoints = edge.isCurved ? RoadGeometry.generateBezierPath(n1, n2, 24) : [{ pos: n1.pos, ll: n1.lane_l, lr: n1.lane_r, sw_l: n1.sw_l, sr: n1.sw_r }, { pos: n2.pos, ll: n2.lane_l, lr: n2.lane_r, sw_l: n2.sw_l, sr: n2.sw_r }];
    const edgesArr = RoadGeometry.calculateAllEdges(pathPoints.map(p => ({ pos: p.pos, ll: p.ll, lr: p.lr, sl: (p as any).sl || p.sw_l, sr: (p as any).sr || p.sw_r })) as any);
    const roadV: number[] = [], roadI: number[] = [], swV: number[] = [], swI: number[] = [];
    const addQ = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3, v: number[], idx: number[]) => {
      const off = v.length / 3; v.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z); idx.push(off, off + 1, off + 2, off, off + 2, off + 3);
    };
    for (let j = 0; j < edgesArr.length - 1; j++) { const e1 = edgesArr[j], e2 = edgesArr[j+1]; addQ(e1.l_lane, e1.r_lane, e2.r_lane, e2.l_lane, roadV, roadI); addQ(e1.l_sw, e1.l_lane, e2.l_lane, e2.l_sw, swV, swI); addQ(e1.r_lane, e1.r_sw, e2.r_sw, e2.r_lane, swV, swI); }
    const createG = (v: number[], idx: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
    return { road: createG(roadV, roadI), sw: createG(swV, swI) };
  }, [n1, n2, edge.isCurved]);

  return (
    <group renderOrder={5} userData={{ edgeId: edge.id }}>
      <Line points={[n1.pos, n2.pos]} color={isSelected && !edge.isCurved ? "yellow" : (isHovered ? "orange" : "#999")} lineWidth={isHovered ? 4 : 2} transparent opacity={0.3} depthTest={false} />
      {edge.isCurved && <Line points={points} color={isSelected ? "#00ffff" : "#444"} lineWidth={isSelected ? 5 : 2} depthTest={false} />}
      <mesh geometry={roadGeometry.road} renderOrder={6} castShadow>
        <meshLambertMaterial color="#3366ff" side={THREE.DoubleSide} polygonOffset={true} polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <mesh geometry={roadGeometry.sw} renderOrder={7} castShadow>
        <meshLambertMaterial color="#6699ff" side={THREE.DoubleSide} polygonOffset={true} polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      
      {(isSelected || isHovered) && (
        <Html position={n1.pos.clone().lerp(n2.pos, 0.5)}>
          <div style={{ background: 'rgba(0,0,0,0.7)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {length.toFixed(2)}m | {angle.toFixed(1)}°
          </div>
        </Html>
      )}

      <mesh position={n1.pos.clone().lerp(n2.pos, 0.5)} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), n2.pos.clone().sub(n1.pos).normalize())} 
        onClick={(e) => { 
          if (interactionMode === 'SELECT') {
            e.stopPropagation(); 
            onSelect(); 
          } else if (interactionMode === 'CREATE') {
            e.stopPropagation();
            if (typeof onSceneClick === 'function') {
              onSceneClick(e.point, null, edge.id);
            } else {
              console.error('onSceneClick is not a function', onSceneClick);
            }
          }
        }}
        onPointerDown={(e) => {
          if (interactionMode === 'SELECT' || interactionMode === 'CREATE') e.stopPropagation();
        }}>
        <cylinderGeometry args={[0.8, 0.8, n1.pos.distanceTo(n2.pos) * 0.9, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

function NumericInput({ label, value, onChange }: { label: string, value: number, onChange: (val: number) => void }) {
  const [local, setLocal] = useState(value.toFixed(2));
  useEffect(() => setLocal(value.toFixed(2)), [value]);
  const commit = () => { const p = parseFloat(local); if (!isNaN(p)) onChange(p); else setLocal(value.toFixed(2)); };
  return <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>{label}<input type="text" value={local} onChange={e => setLocal(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '4px' }} /></label>;
}

function LayerItem({ layer, onToggle, onDelete }: { layer: LayerData, onToggle: () => void, onDelete: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '4px' }}>
      <div style={{ flex: 1, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={layer.name}>{layer.name}</div>
      <button onClick={onToggle}>{layer.visible ? '👁️' : '🕶️'}</button>
      <button onClick={onDelete}>🗑️</button>
    </div>
  );
}

function App() {
  const [nodes, setNodes] = useState<Record<string, NodeData>>({});
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('SELECT');
  const [editMode, setEditMode] = useState<EditMode>('MOVE_NODE');
  const [axisLock, setAxisLock] = useState<AxisLock>('none');
  const [useSnap, setUseSnap] = useState(true);
  const [snapStep, setSnapStep] = useState(1);
  const [isPerspective, setIsPerspective] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [layers, setLayers] = useState<LayerData[]>([]);
  const [activeChainStartId, setActiveChainStartId] = useState<string | null>(null);
  const [mousePointer, setMousePointer] = useState<THREE.Vector3>(new THREE.Vector3());
  const [is90Snapped, setIs90Snapped] = useState(false);
  const orbitRef = useRef<any>();

  const snapVec = (v: THREE.Vector3) => useSnap ? new THREE.Vector3(Math.round(v.x / snapStep) * snapStep, Math.round(v.y / snapStep) * snapStep, Math.round(v.z / snapStep) * snapStep) : v;

  const minZ = useMemo(() => {
    const vals = Object.values(nodes).map(n => n.pos.z);
    return vals.length > 0 ? Math.min(0, ...vals) : 0;
  }, [nodes]);

  const generateId = (prefix: string) => prefix + Math.random().toString(36).substring(2, 7);

  const addNode = (pos: THREE.Vector3) => {
    const id = generateId("n");
    const newNode = { id, pos: pos.clone(), left_h: pos.clone().add(new THREE.Vector3(-2,0,0)), right_h: pos.clone().add(new THREE.Vector3(2,0,0)), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5 };
    setNodes(prev => ({ ...prev, [id]: newNode }));
    return id;
  };
  const addEdge = (n1: string, n2: string) => {
    const id = generateId("e");
    setEdges(prev => [...prev, { id, n1, n2, isCurved: false }]);
    return id;
  };

  useEffect(() => {
    const handleKD = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'w') setEditMode(p => p === 'MOVE_NODE' ? 'MOVE_BEZIER' : 'MOVE_NODE');
      if (e.key === 'ArrowUp') setAxisLock('z'); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setAxisLock('xy'); if (e.key === 'ArrowDown') setAxisLock('none');
      if (e.key === 'Escape') { setInteractionMode('SELECT'); setActiveChainStartId(null); }
    };
    window.addEventListener('keydown', handleKD); return () => window.removeEventListener('keydown', handleKD);
  }, []);

  const handleImport = async (type: 'pdf' | 'dxf') => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = type === 'pdf' ? '.pdf' : '.dxf';
    input.onchange = async (e: any) => {
      const file = e.target.files[0]; if (!file) return;
      try { const newLayer = type === 'pdf' ? await ImportLoaders.loadPDF(file) : await ImportLoaders.loadDXF(file); setLayers(prev => [...prev, newLayer]); } 
      catch (err) { alert("Import failed."); }
    };
    input.click();
  };

  const handleSceneClick = useCallback((point: THREE.Vector3, targetNodeId?: string | null, targetEdgeId?: string | null) => {
    console.log('handleSceneClick', { interactionMode, targetNodeId, targetEdgeId, point });
    if (interactionMode !== 'CREATE') return;
    
    let targetId = targetNodeId;
    
    if (!targetId && targetEdgeId) {
        console.log('Splitting edge', targetEdgeId);
        const edge = edges.find(ed => ed.id === targetEdgeId)!;
        targetId = addNode(point);
        setEdges(prev => {
           const filtered = prev.filter(ed => ed.id !== targetEdgeId);
           return [...filtered, 
             { id: generateId("e"), n1: edge.n1, n2: targetId!, isCurved: edge.isCurved }, 
             { id: generateId("e"), n1: targetId!, n2: edge.n2, isCurved: edge.isCurved }
           ];
        });
    }

    if (!targetId) {
        console.log('Adding new node at', point);
        targetId = addNode(point);
    }
    
    if (activeChainStartId && activeChainStartId !== targetId) {
        console.log('Adding edge from', activeChainStartId, 'to', targetId);
        addEdge(activeChainStartId, targetId);
    }
    
    setActiveChainStartId(targetId); 
    setSelectedNodeId(targetId);
    setSelectedEdgeId(null);
  }, [interactionMode, activeChainStartId, nodes, edges]);

  function SceneController() {
    const { scene, raycaster } = useThree();
    const onPointerMove = (e: any) => {
      if (!e.point) return;
      let point = snapVec(e.point.clone());
      let snapped90 = false;
      
      const intersects = raycaster.intersectObjects(scene.children, true);
      let foundNode: string | null = null, foundEdge: string | null = null;
      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj && !obj.userData.nodeId && !obj.userData.edgeId && obj.parent) obj = obj.parent as any;
        if (obj?.userData.nodeId) { foundNode = obj.userData.nodeId; break; }
        if (obj?.userData.edgeId) { foundEdge = obj.userData.edgeId; break; }
      }
      setHoveredNodeId(foundNode); setHoveredEdgeId(foundNode ? null : foundEdge);

      if (interactionMode === 'CREATE') {
        if (foundNode) {
          point = nodes[foundNode].pos.clone();
        } else if (activeChainStartId && nodes[activeChainStartId]) {
          const curr = nodes[activeChainStartId].pos;
          const prevEdge = edges.find(ed => ed.n2 === activeChainStartId || ed.n1 === activeChainStartId);
          if (prevEdge) {
            const prevNodeId = prevEdge.n1 === activeChainStartId ? prevEdge.n2 : prevEdge.n1;
            const prev = nodes[prevNodeId].pos;
            const vecIn = new THREE.Vector3().subVectors(curr, prev).setZ(0).normalize();
            const vecOut = new THREE.Vector3().subVectors(point, curr).setZ(0);
            const angle = vecIn.angleTo(vecOut.clone().normalize());
            if (Math.abs(angle - Math.PI / 2) < 0.15 || Math.abs(angle - (3 * Math.PI) / 2) < 0.15) {
              snapped90 = true;
              const side = new THREE.Vector3().crossVectors(vecIn, new THREE.Vector3(0,0,1)).normalize();
              const dist = vecOut.length();
              const dot = vecOut.normalize().dot(side);
              point.copy(curr).add(side.multiplyScalar(dist * (dot > 0 ? 1 : -1)));
            }
          }
        }
      }
      setMousePointer(point);
      setIs90Snapped(snapped90);
    };

    return (
      <>
        {/* Virtual Surface: catch clicks AND shadows, but remains transparent */}
        <mesh 
          rotation={[0, 0, 0]} 
          onPointerMove={onPointerMove} 
          onClick={(e) => { e.stopPropagation(); handleSceneClick(mousePointer, hoveredNodeId, hoveredEdgeId); }} 
          onPointerDown={(e) => { e.stopPropagation(); }}
          onDoubleClick={(e) => { e.stopPropagation(); setActiveChainStartId(null); }} 
          position={[0, 0, minZ - 0.2]} 
          receiveShadow
          renderOrder={0}
        >
          <planeGeometry args={[20000, 20000]} />
          <shadowMaterial transparent opacity={0.3} depthWrite={false} />
        </mesh>
        {is90Snapped && interactionMode === 'CREATE' && activeChainStartId && (
          <group position={nodes[activeChainStartId].pos}>
            <mesh position={[0, 0, 0.05]} renderOrder={1000}>
              <boxGeometry args={[0.5, 0.5, 0.01]} />
              <meshBasicMaterial color="yellow" transparent opacity={0.5} depthTest={false} />
            </mesh>
          </group>
        )}
      </>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: 'white' }}>
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', gap: '5px', background: 'rgba(255,255,255,0.9)', padding: '5px', borderRadius: '8px' }}>
        <button className={`tool-btn ${interactionMode === 'SELECT' ? 'active' : ''}`} onClick={() => { setInteractionMode('SELECT'); setActiveChainStartId(null); }}>🖱️ Move/Select</button>
        <button className={`tool-btn ${interactionMode === 'CREATE' ? 'active' : ''}`} onClick={() => setInteractionMode('CREATE')}>🛣️ Road Tool</button>
        <div style={{ width: '1px', background: '#ccc', margin: '0 5px' }} />
        <button className={`tool-btn ${isPerspective ? 'active' : ''}`} onClick={() => setIsPerspective(true)}>Persp</button><button className={`tool-btn ${!isPerspective ? 'active' : ''}`} onClick={() => setIsPerspective(false)}>Top</button>
        <button className={`tool-btn ${showGrid ? 'active' : ''}`} onClick={() => setShowGrid(!showGrid)}>Grid</button>
        <button className={`tool-btn ${useSnap ? 'active' : ''}`} onClick={() => setUseSnap(!useSnap)}>Snap: {useSnap ? snapStep+'m' : 'OFF'}</button>
      </div>

      <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 100, pointerEvents: 'none' }}>
        <div style={{ background: interactionMode === 'CREATE' ? '#4CAF50' : '#2196F3', color: 'white', padding: '8px 20px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
          {interactionMode === 'CREATE' ? "ROAD TOOL (Click nodes/edges to connect, ESC to finish chain)" : `MOVE/SELECT MODE: ${editMode} (W) | LOCK: ${axisLock.toUpperCase()}`}
        </div>
      </div>

      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: 'rgba(255,255,255,0.95)', padding: '20px', borderRadius: '12px', width: '260px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
          <h2 style={{ margin: '0 0 15px 0', fontSize: '1.2rem', fontWeight: 800 }}>ROAD EDITOR</h2>
          {selectedNodeId && nodes[selectedNodeId] && (
            <div style={{ padding: '15px', background: '#f9f9f9', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><span>Node Info</span><button className="tool-btn" style={{ fontSize: '0.6rem' }} onClick={() => { const filtered = { ...nodes }; delete filtered[selectedNodeId]; setNodes(filtered); setEdges(prev => prev.filter(e => e.n1 !== selectedNodeId && e.n2 !== selectedNodeId)); setSelectedNodeId(null); }}>Delete</button></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <NumericInput label="X" value={nodes[selectedNodeId].pos.x} onChange={v => setNodes(p => ({ ...p, [selectedNodeId]: { ...p[selectedNodeId], pos: p[selectedNodeId].pos.clone().setX(v) } }))} />
                <NumericInput label="Y" value={nodes[selectedNodeId].pos.y} onChange={v => setNodes(p => ({ ...p, [selectedNodeId]: { ...p[selectedNodeId], pos: p[selectedNodeId].pos.clone().setY(v) } }))} />
                <NumericInput label="Z" value={nodes[selectedNodeId].pos.z} onChange={v => setNodes(p => ({ ...p, [selectedNodeId]: { ...p[selectedNodeId], pos: p[selectedNodeId].pos.clone().setZ(v) } }))} />
              </div>
            </div>
          )}
          {selectedEdgeId && edges.find(e => e.id === selectedEdgeId) && (
            <div style={{ padding: '15px', background: '#e3f2fd', borderRadius: '8px', marginTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><span>Edge Info</span><button className="tool-btn" style={{ fontSize: '0.6rem' }} onClick={() => { setEdges(prev => prev.filter(e => e.id !== selectedEdgeId)); setSelectedEdgeId(null); }}>Delete</button></div>
              <button className={`tool-btn ${edges.find(e => e.id === selectedEdgeId)?.isCurved ? 'active' : ''}`} onClick={() => {
                setEdges(prev => prev.map(e => {
                   if (e.id !== selectedEdgeId) return e;
                   const isCurved = !e.isCurved;
                   if (isCurved) {
                      const n1 = nodes[e.n1], n2 = nodes[e.n2]; const dir = n2.pos.clone().sub(n1.pos);
                      setNodes(pn => ({ ...pn, [e.n1]: { ...pn[e.n1], right_h: n1.pos.clone().add(dir.clone().multiplyScalar(0.33)) }, [e.n2]: { ...pn[e.n2], left_h: n1.pos.clone().add(dir.clone().multiplyScalar(0.66)) } }));
                   }
                   return { ...e, isCurved };
                }));
              }}>Toggle Curved</button>
            </div>
          )}
        </div>
        <div style={{ background: 'rgba(255,255,255,0.95)', padding: '20px', borderRadius: '12px', width: '260px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800 }}>LAYERS</h2>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
             <button onClick={() => handleImport('pdf')} style={{ flex: 1 }}>PDF</button>
             <button onClick={() => handleImport('dxf')} style={{ flex: 1 }}>DXF</button>
          </div>
          {layers.map(l => <LayerItem key={l.id} layer={l} onToggle={() => setLayers(prev => prev.map(ly => ly.id === l.id ? { ...ly, visible: !ly.visible } : ly))} onDelete={() => setLayers(prev => prev.filter(ly => ly.id !== l.id))} />)}
        </div>
      </div>

      <Canvas shadows={{ type: THREE.PCFShadowMap }} flat>
        <color attach="background" args={['white']} />
        {isPerspective ? <PerspectiveCamera makeDefault position={[30, -30, 30]} up={[0, 0, 1]} fov={45} /> : <OrthographicCamera makeDefault position={[0, 0, 50]} up={[0, 1, 0]} zoom={20} far={1000} near={-1000} />}
        <OrbitControls ref={orbitRef} makeDefault enableRotate={isPerspective} />
        
        <ambientLight intensity={1.5} />
        <directionalLight 
          position={[50, 50, 100]} 
          intensity={1.2} 
          castShadow 
          shadow-mapSize={[2048, 2048]} 
          shadow-camera-left={-200} 
          shadow-camera-right={200} 
          shadow-camera-top={200} 
          shadow-camera-bottom={-200}
          shadow-camera-near={1}
          shadow-camera-far={500}
        />

        <AdaptiveGrid visible={showGrid} setSnapStep={setSnapStep} minZ={minZ} />
        <AxisLines />
        <SceneController />
        
        {interactionMode === 'CREATE' && activeChainStartId && (
          <>
            <Line points={[nodes[activeChainStartId].pos, mousePointer]} color={is90Snapped ? "yellow" : "orange"} lineWidth={3} depthTest={false} />
            <Html position={nodes[activeChainStartId].pos.clone().lerp(mousePointer, 0.5)}>
              <div style={{ background: 'rgba(0,0,0,0.7)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                {nodes[activeChainStartId].pos.distanceTo(mousePointer).toFixed(2)}m | {(() => {
                  const dir = mousePointer.clone().sub(nodes[activeChainStartId].pos).setZ(0).normalize();
                  let ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
                  return (ang < 0 ? ang + 360 : ang).toFixed(1);
                })()}°
              </div>
            </Html>
          </>
        )}
        {interactionMode === 'CREATE' && <mesh position={[mousePointer.x, mousePointer.y, mousePointer.z + 0.05]}><sphereGeometry args={[0.2]} /><meshBasicMaterial color={is90Snapped ? "yellow" : "orange"} depthTest={false} /></mesh>}
        <group renderOrder={10}>
          {Object.values(nodes).map((n) => (
            <Node 
              key={n.id} 
              node={n} 
              isSelected={selectedNodeId === n.id} 
              isHovered={hoveredNodeId === n.id} 
              onSelect={() => { setSelectedNodeId(n.id); setSelectedEdgeId(null); }} 
              onSceneClick={handleSceneClick} 
              onChange={(newData) => setNodes(prev => ({ ...prev, [newData.id]: newData }))} 
              interactionMode={interactionMode} 
              editMode={editMode} 
              axisLock={axisLock} 
              snapVec={snapVec} 
              orbitControlsRef={orbitRef} 
            />
          ))}
          {edges.map((e) => (
            <Segment 
              key={e.id} 
              edge={e} 
              nodesMap={nodes} 
              isSelected={selectedEdgeId === e.id} 
              isHovered={hoveredEdgeId === e.id} 
              onSelect={() => { setSelectedEdgeId(e.id); setSelectedNodeId(null); }} 
              onSceneClick={handleSceneClick} 
              interactionMode={interactionMode} 
            />
          ))}
        </group>
        {layers.map(layer => (
          <group key={layer.id} position={layer.position} scale={[layer.scale, layer.scale, 1]} visible={layer.visible} renderOrder={1} onPointerMove={(e: any) => e.stopPropagation()} onClick={(e: any) => e.stopPropagation()}>
            {layer.type === 'pdf' ? <mesh><planeGeometry args={[10 * (layer.aspectRatio || 1), 10]} /><meshBasicMaterial map={layer.content as THREE.Texture} side={THREE.DoubleSide} toneMapped={false} depthWrite={true} /></mesh> : <primitive object={layer.content} />}
          </group>
        ))}
      </Canvas>
    </div>
  );
}

export default App
