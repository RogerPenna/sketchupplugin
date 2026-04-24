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

type InteractionMode = 'idle' | 'ROAD_CREATION' | 'calibrate_origin' | 'calibrate_scale_p1' | 'calibrate_scale_p2';
type EditMode = 'MOVE_NODE' | 'MOVE_BEZIER';
type AxisLock = 'none' | 'xy' | 'z';

function AdaptiveGrid({ visible, setSnapStep }: { visible: boolean, setSnapStep: (s: number) => void }) {
  const { camera } = useThree();
  const [config, setConfig] = useState({ cellSize: 1, sectionSize: 10, fadeDistance: 600 });
  useFrame(() => {
    if (!visible) return;
    let dist = (camera instanceof THREE.PerspectiveCamera) ? camera.position.length() : 600 / camera.zoom;
    let newCell = dist > 800 ? 50 : (dist > 300 ? 10 : (dist < 40 ? 0.5 : 1));
    if (config.cellSize !== newCell) { setConfig({ cellSize: newCell, sectionSize: newCell * 10, fadeDistance: newCell * 400 }); setSnapStep(newCell); }
  });
  if (!visible) return null;
  return <Grid position={[0, 0, 0]} infiniteGrid fadeDistance={config.fadeDistance} sectionSize={config.sectionSize} sectionThickness={1.5} sectionColor={GRID_SECTION_COLOR} cellSize={config.cellSize} cellThickness={0.8} cellColor={GRID_COLOR} rotation={[Math.PI / 2, 0, 0]} renderOrder={2} />;
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
    const s = (camera instanceof THREE.PerspectiveCamera) ? camera.position.distanceTo(groupRef.current.getWorldPosition(new THREE.Vector3())) / 25 : 1.2 / camera.zoom;
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
    <group ref={groupRef} position={direction.clone().multiplyScalar(1.5)} quaternion={quat} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={() => { dragging.current = false; onEnd(); }} onClick={(e) => e.stopPropagation()} >
      <mesh renderOrder={1000}><coneGeometry args={[0.2, 0.5, 16]} /><meshBasicMaterial color={color} transparent opacity={0.7} depthTest={false} /></mesh>
      <mesh position={[0, -0.4, 0]} renderOrder={1000}><cylinderGeometry args={[0.05, 0.05, 0.4, 16]} /><meshBasicMaterial color={color} transparent opacity={0.7} depthTest={false} /></mesh>
      <mesh visible={false}><sphereGeometry args={[0.8]} /></mesh>
    </group>
  );
}

function Node({ node, isSelected, isHovered, onSelect, editMode, axisLock, snapVec, onChange, orbitControlsRef }: { 
  node: NodeData, isSelected: boolean, isHovered: boolean, onSelect: () => void, editMode: EditMode, axisLock: AxisLock, snapVec: (v: THREE.Vector3) => THREE.Vector3, onChange: (d: NodeData) => void, orbitControlsRef: any
}) {
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
  return (
    <group position={[node.pos.x, node.pos.y, node.pos.z]} renderOrder={500} userData={{ nodeId: node.id }}>
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(); }} onPointerDown={(e) => e.stopPropagation()}>
        <sphereGeometry args={[isHovered ? 0.45 : 0.25, 32, 32]} />
        <meshBasicMaterial color={isSelected ? "yellow" : (isHovered ? "orange" : "#2222ff")} depthTest={false} />
      </mesh>
      {isSelected && editMode === 'MOVE_NODE' && (
        <group>
          <DragHandle color="red" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(1, 0, 0)} onUpdate={moveNode} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="green" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(0, 1, 0)} onUpdate={moveNode} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="blue" axisLock={axisLock} nodePos={node.pos} direction={new THREE.Vector3(0, 0, 1)} onUpdate={moveNode} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
        </group>
      )}
      {isSelected && editMode === 'MOVE_BEZIER' && (
        <group>
          <group position={node.left_h.clone().sub(node.pos)}>
            <mesh><sphereGeometry args={[0.15]} /><meshBasicMaterial color="cyan" depthTest={false} /></mesh>
            <DragHandle color="red" axisLock={axisLock} nodePos={node.left_h} direction={new THREE.Vector3(1,0,0)} onUpdate={(p) => mirrorHandles(p, true)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            <DragHandle color="green" axisLock={axisLock} nodePos={node.left_h} direction={new THREE.Vector3(0,1,0)} onUpdate={(p) => mirrorHandles(p, true)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          </group>
          <group position={node.right_h.clone().sub(node.pos)}>
            <mesh><sphereGeometry args={[0.15]} /><meshBasicMaterial color="cyan" depthTest={false} /></mesh>
            <DragHandle color="red" axisLock={axisLock} nodePos={node.right_h} direction={new THREE.Vector3(1,0,0)} onUpdate={(p) => mirrorHandles(p, false)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            <DragHandle color="green" axisLock={axisLock} nodePos={node.right_h} direction={new THREE.Vector3(0,1,0)} onUpdate={(p) => mirrorHandles(p, false)} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          </group>
          <Line points={[[node.left_h.x-node.pos.x, node.left_h.y-node.pos.y, node.left_h.z-node.pos.z], [0,0,0], [node.right_h.x-node.pos.x, node.right_h.y-node.pos.y, node.right_h.z-node.pos.z]]} color="cyan" lineWidth={1} transparent opacity={0.6} depthTest={false} />
        </group>
      )}
    </group>
  );
}

function Segment({ edge, nodesMap, isSelected, isHovered, onSelect }: { edge: EdgeData, nodesMap: Record<string, NodeData>, isSelected: boolean, isHovered: boolean, onSelect: () => void }) {
  const n1 = nodesMap[edge.n1], n2 = nodesMap[edge.n2];
  if (!n1 || !n2) return null;
  const curve = useMemo(() => new THREE.CubicBezierCurve3(n1.pos, n1.right_h, n2.left_h, n2.pos), [n1.pos, n1.right_h, n2.left_h, n2.pos]);
  const points = useMemo(() => curve.getPoints(24), [curve]);
  const roadGeometry = useMemo(() => {
    const pathPoints = edge.isCurved ? RoadGeometry.generateBezierPath(n1, n2, 24) : [{ pos: n1.pos, ll: n1.lane_l, lr: n1.lane_r, sl: n1.sw_l, sr: n1.sw_r }, { pos: n2.pos, ll: n2.lane_l, lr: n2.lane_r, sl: n2.sw_l, sr: n2.sw_r }];
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
    <group renderOrder={400} userData={{ edgeId: edge.id }}>
      <Line points={[n1.pos, n2.pos]} color={isSelected && !edge.isCurved ? "yellow" : (isHovered ? "orange" : "#999")} lineWidth={isHovered ? 4 : 2} transparent opacity={0.3} depthTest={false} />
      {edge.isCurved && <Line points={points} color={isSelected ? "#00ffff" : "#444"} lineWidth={isSelected ? 5 : 2} depthTest={false} />}
      <mesh geometry={roadGeometry.road} renderOrder={9}><meshBasicMaterial color="#3366ff" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh geometry={roadGeometry.sw} renderOrder={9}><meshBasicMaterial color="#6699ff" transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh position={n1.pos.clone().lerp(n2.pos, 0.5)} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), n2.pos.clone().sub(n1.pos).normalize())} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <cylinderGeometry args={[0.8, 0.8, n1.pos.distanceTo(n2.pos) * 0.9, 8]} /><meshBasicMaterial transparent opacity={0} />
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

function App() {
  const [nodes, setNodes] = useState<Record<string, NodeData>>({});
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const [editMode, setEditMode] = useState<EditMode>('MOVE_NODE');
  const [axisLock, setAxisLock] = useState<AxisLock>('none');
  const [useSnap, setUseSnap] = useState(false);
  const [snapStep, setSnapStep] = useState(1);
  const [isPerspective, setIsPerspective] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [layers, setLayers] = useState<LayerData[]>([]);
  const [activeChainStartId, setActiveChainStartId] = useState<string | null>(null);
  const [mousePointer, setMousePointer] = useState<THREE.Vector3>(new THREE.Vector3());
  const orbitRef = useRef<any>();

  const snap = (v: number) => useSnap ? Math.round(v / snapStep) * snapStep : v;
  const snapVec = (v: THREE.Vector3) => new THREE.Vector3(snap(v.x), snap(v.y), snap(v.z));

  const addNode = (pos: THREE.Vector3) => {
    const id = "n" + Math.random().toString(36).substr(2, 5);
    const newNode = { id, pos: pos.clone(), left_h: pos.clone().add(new THREE.Vector3(-2,0,0)), right_h: pos.clone().add(new THREE.Vector3(2,0,0)), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5 };
    setNodes(prev => ({ ...prev, [id]: newNode }));
    return id;
  };
  const addEdge = (n1: string, n2: string) => {
    const id = "e" + Math.random().toString(36).substr(2, 5);
    setEdges(prev => [...prev, { id, n1, n2, isCurved: false }]);
    return id;
  };
  const splitEdge = (edgeId: string, splitPos: THREE.Vector3) => {
    const edge = edges.find(e => e.id === edgeId); if (!edge) return null;
    const newNodeId = addNode(splitPos);
    setEdges(prev => { const filtered = prev.filter(e => e.id !== edgeId); return [...filtered, { id: "e" + Math.random().toString(36).substr(2, 5), n1: edge.n1, n2: newNodeId, isCurved: edge.isCurved }, { id: "e" + Math.random().toString(36).substr(2, 5), n1: newNodeId, n2: edge.n2, isCurved: edge.isCurved }]; });
    return newNodeId;
  };

  useEffect(() => {
    const handleKD = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'w') setEditMode(p => p === 'MOVE_NODE' ? 'MOVE_BEZIER' : 'MOVE_NODE');
      if (e.key === 'ArrowUp') setAxisLock('z'); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setAxisLock('xy'); if (e.key === 'ArrowDown') setAxisLock('none');
      if (e.key === 'Escape') { setInteractionMode('idle'); setActiveChainStartId(null); }
    };
    window.addEventListener('keydown', handleKD); return () => window.removeEventListener('keydown', handleKD);
  }, []);

  const handlePointerMove = (e: any) => {
    if (!e.point) return;
    const point = snapVec(e.point.clone());
    
    if (interactionMode === 'ROAD_CREATION') {
      const intersects = e.raycaster.intersectObjects(e.scene.children, true);
      let foundNode: string | null = null; let foundEdge: string | null = null;
      for (const intersect of intersects) {
        let obj = intersect.object;
        while (obj && !obj.userData.nodeId && !obj.userData.edgeId && obj.parent) obj = obj.parent as any;
        if (obj?.userData.nodeId) { foundNode = obj.userData.nodeId; break; }
        if (obj?.userData.edgeId) { foundEdge = obj.userData.edgeId; break; }
      }
      setHoveredNodeId(foundNode); setHoveredEdgeId(foundNode ? null : foundEdge);
      
      // MAGNETISMO VISUAL
      if (foundNode) setMousePointer(nodes[foundNode].pos.clone());
      else setMousePointer(point);
    } else {
      setMousePointer(point);
    }
  };

  const handleCanvasClick = (e: any) => {
    if (interactionMode !== 'ROAD_CREATION') { setSelectedNodeId(null); setSelectedEdgeId(null); return; }
    e.stopPropagation();
    
    let targetNodeId: string | null = hoveredNodeId;
    if (!targetNodeId && hoveredEdgeId) targetNodeId = splitEdge(hoveredEdgeId, mousePointer);
    if (!targetNodeId) targetNodeId = addNode(mousePointer);
    if (activeChainStartId && activeChainStartId !== targetNodeId) addEdge(activeChainStartId, targetNodeId);

    setActiveChainStartId(targetNodeId);
    setSelectedNodeId(targetNodeId);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: 'white' }}>
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', gap: '5px', background: 'rgba(255,255,255,0.9)', padding: '5px', borderRadius: '8px' }}>
        <button className={`tool-btn ${interactionMode === 'ROAD_CREATION' ? 'active' : ''}`} onClick={() => setInteractionMode(p => p === 'ROAD_CREATION' ? 'idle' : 'ROAD_CREATION')}>🛣️ Road Tool</button>
        <button className={`tool-btn ${isPerspective ? 'active' : ''}`} onClick={() => setIsPerspective(true)}>Persp</button><button className={`tool-btn ${!isPerspective ? 'active' : ''}`} onClick={() => setIsPerspective(false)}>Top</button>
        <button className={`tool-btn ${showGrid ? 'active' : ''}`} onClick={() => setShowGrid(!showGrid)}>Grid</button><button className={`tool-btn ${useSnap ? 'active' : ''}`} onClick={() => setUseSnap(!useSnap)}>Snap: {snapStep}m</button>
      </div>
      <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 100, pointerEvents: 'none' }}>
        <div style={{ background: interactionMode === 'ROAD_CREATION' ? '#4CAF50' : 'rgba(255,255,255,0.9)', color: interactionMode === 'ROAD_CREATION' ? 'white' : '#222', padding: '8px 20px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold' }}>
          {interactionMode === 'ROAD_CREATION' ? "ROAD TOOL (Click nodes/edges to connect, ESC to finish chain)" : `MODE: ${editMode} (W) | LOCK: ${axisLock.toUpperCase()}`}
        </div>
      </div>
      <Canvas shadows flat onPointerMove={handlePointerMove}>
        <color attach="background" args={['white']} />
        {isPerspective ? <PerspectiveCamera makeDefault position={[30, -30, 30]} up={[0, 0, 1]} fov={45} /> : <OrthographicCamera makeDefault position={[0, 0, 50]} up={[0, 1, 0]} zoom={20} far={1000} near={-1000} />}
        <OrbitControls ref={orbitRef} makeDefault enableRotate={isPerspective} />
        <ambientLight intensity={1.0} /><AdaptiveGrid visible={showGrid} setSnapStep={setSnapStep} />
        
        <mesh rotation={[0, 0, 0]} onPointerMove={handlePointerMove} onClick={handleCanvasClick} onDoubleClick={() => setActiveChainStartId(null)} position={[0,0,0]} renderOrder={0}>
          <planeGeometry args={[20000, 20000]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {interactionMode === 'ROAD_CREATION' && activeChainStartId && nodes[activeChainStartId] && <Line points={[nodes[activeChainStartId].pos, mousePointer]} color="orange" lineWidth={2} dashed dashSize={0.5} gapSize={0.2} transparent opacity={0.8} />}
        {interactionMode === 'ROAD_CREATION' && <mesh position={[mousePointer.x, mousePointer.y, mousePointer.z + 0.05]}><sphereGeometry args={[0.25]} /><meshBasicMaterial color="orange" depthTest={false} /></mesh>}

        <group renderOrder={10}>
          {Object.values(nodes).map((n) => <Node key={n.id} node={n} isSelected={selectedNodeId === n.id} isHovered={hoveredNodeId === n.id} onSelect={() => { if (interactionMode === 'ROAD_CREATION') { if (activeChainStartId && activeChainStartId !== n.id) addEdge(activeChainStartId, n.id); setActiveChainStartId(n.id); } setSelectedNodeId(n.id); setSelectedEdgeId(null); }} onChange={(newData) => setNodes(prev => ({ ...prev, [newData.id]: newData }))} editMode={editMode} axisLock={axisLock} snapVec={snapVec} orbitControlsRef={orbitRef} />)}
          {edges.map((e) => <Segment key={e.id} edge={e} nodesMap={nodes} isSelected={selectedEdgeId === e.id} isHovered={hoveredEdgeId === e.id} onSelect={() => { if (interactionMode === 'ROAD_CREATION') { const nid = splitEdge(e.id, mousePointer); if (nid) { if (activeChainStartId) addEdge(activeChainStartId, nid); setActiveChainStartId(nid); setSelectedNodeId(nid); } } else { setSelectedEdgeId(e.id); setSelectedNodeId(null); } }} />)}
        </group>
        
        {layers.map(layer => (
          <group key={layer.id} position={layer.position} scale={[layer.scale, layer.scale, 1]} visible={layer.visible} renderOrder={1} onClick={handleCanvasClick} onPointerMove={handlePointerMove}>
            {layer.type === 'pdf' ? <mesh><planeGeometry args={[10 * (layer.aspectRatio || 1), 10]} /><meshBasicMaterial map={layer.content as THREE.Texture} side={THREE.DoubleSide} toneMapped={false} depthWrite={true} /></mesh> : <primitive object={layer.content} />}
          </group>
        ))}
      </Canvas>
    </div>
  );
}

export default App
