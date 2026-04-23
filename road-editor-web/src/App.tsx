import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, PerspectiveCamera, OrthographicCamera, Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { RoadGeometry, type NodeData } from './logic/Geometry'
import { ImportLoaders, type LayerData } from './logic/ImportLoaders'
import './App.css'

// Colors
const X_COLOR = '#ff0000', Y_COLOR = '#00ff00', Z_COLOR = '#0000ff'
const GRID_COLOR = '#d1e7f0', GRID_SECTION_COLOR = '#a0c4d1'

type InteractionMode = 'idle' | 'adding_node' | 'calibrate_origin' | 'calibrate_scale_p1' | 'calibrate_scale_p2';
type EditMode = 'MOVE_NODE' | 'MOVE_BEZIER';
type AxisLock = 'none' | 'xy' | 'z';

function AdaptiveGrid({ visible, setSnapStep }: { visible: boolean, setSnapStep: (s: number) => void }) {
  const { camera } = useThree();
  const [config, setConfig] = useState({ cellSize: 1, sectionSize: 10, fadeDistance: 600 });
  useFrame(() => {
    if (!visible) return;
    let dist = (camera instanceof THREE.PerspectiveCamera) ? camera.position.length() : 600 / camera.zoom;
    let newCell = 1; let newSection = 10; let newFade = 600;
    if (dist > 300) { newCell = 10; newSection = 100; newFade = 3000; }
    else if (dist > 1000) { newCell = 50; newSection = 500; newFade = 8000; }
    else if (dist < 40) { newCell = 0.5; newSection = 5; newFade = 200; }
    if (config.cellSize !== newCell) { setConfig({ cellSize: newCell, sectionSize: newSection, fadeDistance: newFade }); setSnapStep(newCell); }
  });
  if (!visible) return null;
  return <Grid position={[0, 0, -0.05]} infiniteGrid fadeDistance={config.fadeDistance} sectionSize={config.sectionSize} sectionThickness={1.5} sectionColor={GRID_SECTION_COLOR} cellSize={config.cellSize} cellThickness={0.8} cellColor={GRID_COLOR} rotation={[Math.PI / 2, 0, 0]} renderOrder={0} />;
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
      const newPos = startNodePos.current.clone();
      const lock = axisLock !== 'none' ? axisLock : (Math.abs(direction.z) > 0.5 ? 'z' : 'xy');
      if (lock === 'z') newPos.z += delta.z; else { newPos.x += delta.x; newPos.y += delta.y; }
      onUpdate(newPos);
    }
  };

  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()), [direction]);
  const offset = useMemo(() => direction.clone().multiplyScalar(1.5), [direction]);

  return (
    <group ref={groupRef} position={[offset.x, offset.y, offset.z]} quaternion={quat} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={() => { dragging.current = false; onEnd(); }} onClick={(e) => e.stopPropagation()} >
      <mesh renderOrder={1000}><coneGeometry args={[0.2, 0.5, 16]} /><meshBasicMaterial color={color} transparent opacity={0.7} depthTest={false} /></mesh>
      <mesh position={[0, -0.4, 0]} renderOrder={1000}><cylinderGeometry args={[0.05, 0.05, 0.4, 16]} /><meshBasicMaterial color={color} transparent opacity={0.7} depthTest={false} /></mesh>
      <mesh visible={false}><sphereGeometry args={[0.8]} /></mesh>
    </group>
  );
}

function Node({ data, onChange, onSelect, isSelected, orbitControlsRef, snapVec, axisLock, editMode }: { 
  data: NodeData, onChange: (newData: NodeData) => void, onSelect: () => void, isSelected: boolean, orbitControlsRef: any, snapVec: (v: THREE.Vector3) => THREE.Vector3, axisLock: AxisLock, editMode: EditMode
}) {
  const toggleOrbit = (active: boolean) => { if (orbitControlsRef.current) orbitControlsRef.current.enabled = !active; };
  const moveAll = (newPos: THREE.Vector3) => {
    const snapped = snapVec(newPos);
    const delta = snapped.clone().sub(data.pos);
    onChange({ ...data, pos: snapped, left_h: data.left_h.clone().add(delta), right_h: data.right_h.clone().add(delta) });
  };
  return (
    <group position={[data.pos.x, data.pos.y, data.pos.z]} renderOrder={500}>
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(); }}><sphereGeometry args={[0.3, 32, 32]} /><meshBasicMaterial color={isSelected ? "yellow" : "#2222ff"} depthTest={false} /></mesh>
      {isSelected && editMode === 'MOVE_NODE' && (
        <>
          <DragHandle color="red" axisLock={axisLock} nodePos={data.pos} direction={new THREE.Vector3(1, 0, 0)} onUpdate={moveAll} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="green" axisLock={axisLock} nodePos={data.pos} direction={new THREE.Vector3(0, 1, 0)} onUpdate={moveAll} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="blue" axisLock={axisLock} nodePos={data.pos} direction={new THREE.Vector3(0, 0, 1)} onUpdate={moveAll} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
        </>
      )}
    </group>
  );
}

function Segment({ n1, n2, isSelected, onSelect, editMode, axisLock, snapVec, onChangeN1, onChangeN2, orbitControlsRef }: { 
  n1: NodeData, n2: NodeData, isSelected: boolean, onSelect: () => void, editMode: EditMode, axisLock: AxisLock, snapVec: (v: THREE.Vector3) => THREE.Vector3, onChangeN1: (d: NodeData) => void, onChangeN2: (d: NodeData) => void, orbitControlsRef: any
}) {
  const curve = useMemo(() => new THREE.CubicBezierCurve3(n1.pos, n1.right_h, n2.left_h, n2.pos), [n1.pos, n1.right_h, n2.left_h, n2.pos]);
  const points = useMemo(() => curve.getPoints(32), [curve]);
  const midpointStraight = useMemo(() => n1.pos.clone().lerp(n2.pos, 0.5), [n1.pos, n2.pos]);
  const straightQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), n2.pos.clone().sub(n1.pos).normalize()), [n1.pos, n2.pos]);
  const toggleOrbit = (active: boolean) => { if (orbitControlsRef.current) orbitControlsRef.current.enabled = !active; };

  const roadGeometry = useMemo(() => {
    const pathPoints = n2.isCurved ? RoadGeometry.generateBezierPath(n1, n2, 32) : [
      { pos: n1.pos, ll: n1.lane_l, lr: n1.lane_r, sl: n1.sw_l, sr: n1.sw_r },
      { pos: n2.pos, ll: n2.lane_l, lr: n2.lane_r, sl: n2.sw_l, sr: n2.sw_r }
    ];
    const mapped = pathPoints.map(p => ({ pos: p.pos, ll: p.ll, lr: p.lr, sl: (p as any).sl || p.sw_l, sr: (p as any).sr || p.sw_r }));
    const edges = RoadGeometry.calculateAllEdges(mapped as any);
    const roadV: number[] = [], roadI: number[] = [], swV: number[] = [], swI: number[] = [];
    const addQ = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3, v: number[], idx: number[]) => {
      const off = v.length / 3; v.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
      idx.push(off, off + 1, off + 2, off, off + 2, off + 3);
    };
    for (let j = 0; j < edges.length - 1; j++) {
      const e1 = edges[j], e2 = edges[j+1];
      addQ(e1.l_lane, e1.r_lane, e2.r_lane, e2.l_lane, roadV, roadI);
      addQ(e1.l_sw, e1.l_lane, e2.l_lane, e2.l_sw, swV, swI);
      addQ(e1.r_lane, e1.r_sw, e2.r_sw, e2.r_lane, swV, swI);
    }
    const createG = (v: number[], idx: number[]) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
    return { road: createG(roadV, roadI), sw: createG(swV, swI) };
  }, [n1, n2, n2.isCurved]);

  return (
    <group renderOrder={400}>
      {/* BASE STRAIGHT LINE (Master reference) */}
      <Line points={[n1.pos, n2.pos]} color={isSelected && !n2.isCurved ? "yellow" : "#999"} lineWidth={2} transparent opacity={0.3} depthTest={false} />
      <mesh position={midpointStraight} quaternion={straightQuat} onClick={(e) => { e.stopPropagation(); onSelect(); }}><cylinderGeometry args={[0.6, 0.6, n1.pos.distanceTo(n2.pos) * 0.8, 8]} /><meshBasicMaterial transparent opacity={0} /></mesh>

      {/* CURVED SPLINE (Only if enabled) */}
      {n2.isCurved && <Line points={points} color={isSelected ? "#00ffff" : "#444"} lineWidth={isSelected ? 5 : 2} depthTest={false} />}
      
      {/* ROAD PREVIEW (Always visible guide) */}
      <mesh geometry={roadGeometry.road} renderOrder={9}><meshBasicMaterial color="#3366ff" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh geometry={roadGeometry.sw} renderOrder={9}><meshBasicMaterial color="#6699ff" transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} /></mesh>

      {/* BEZIER HANDLES - ONLY IF CURVED AND IN BEZIER MODE */}
      {isSelected && n2.isCurved && editMode === 'MOVE_BEZIER' && (
        <>
          <group position={n1.right_h.clone()}>
            <mesh><sphereGeometry args={[0.2]} /><meshBasicMaterial color="cyan" depthTest={false} /></mesh>
            <DragHandle axisLock={axisLock} nodePos={n1.right_h} direction={new THREE.Vector3(1,0,0)} color="red" onUpdate={(p) => onChangeN1({...n1, right_h: snapVec(p)})} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            <DragHandle axisLock={axisLock} nodePos={n1.right_h} direction={new THREE.Vector3(0,1,0)} color="green" onUpdate={(p) => onChangeN1({...n1, right_h: snapVec(p)})} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            <DragHandle axisLock={axisLock} nodePos={n1.right_h} direction={new THREE.Vector3(0,0,1)} color="blue" onUpdate={(p) => onChangeN1({...n1, right_h: snapVec(p)})} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          </group>
          <group position={n2.left_h.clone()}>
            <mesh><sphereGeometry args={[0.2]} /><meshBasicMaterial color="cyan" depthTest={false} /></mesh>
            <DragHandle axisLock={axisLock} nodePos={n2.left_h} direction={new THREE.Vector3(1,0,0)} color="red" onUpdate={(p) => onChangeN2({...n2, left_h: snapVec(p)})} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            <DragHandle axisLock={axisLock} nodePos={n2.left_h} direction={new THREE.Vector3(0,1,0)} color="green" onUpdate={(p) => onChangeN2({...n2, left_h: snapVec(p)})} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
            <DragHandle axisLock={axisLock} nodePos={n2.left_h} direction={new THREE.Vector3(0,0,1)} color="blue" onUpdate={(p) => onChangeN2({...n2, left_h: snapVec(p)})} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          </group>
          <Line points={[n1.pos, n1.right_h]} color="cyan" lineWidth={1} transparent opacity={0.6} depthTest={false} />
          <Line points={[n2.pos, n2.left_h]} color="cyan" lineWidth={1} transparent opacity={0.6} depthTest={false} />
        </>
      )}
    </group>
  );
}

function NumericInput({ label, value, onChange, gridSpan = "1" }: { label: string, value: number, onChange: (val: number) => void, gridSpan?: string }) {
  const [localValue, setLocalValue] = useState(value.toFixed(2));
  useEffect(() => { setLocalValue(value.toFixed(2)); }, [value]);
  const commit = () => { const p = parseFloat(localValue); if (!isNaN(p)) onChange(p); else setLocalValue(value.toFixed(2)); };
  return <label style={{ fontSize: '0.7rem', fontWeight: 'bold', gridColumn: `span ${gridSpan}`, color: '#666' }}>{label}<input type="text" value={localValue} onChange={e => setLocalValue(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} style={{ width: '100%', padding: '6px', marginTop: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem' }} /></label>;
}

function LayerItem({ layer, onToggle, onDelete, onCalibrateOrigin, onCalibrateScale }: { layer: LayerData, onToggle: () => void, onDelete: () => void, onCalibrateOrigin: () => void, onCalibrateScale: () => void }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '4px' }}><div style={{ flex: 1, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={layer.name}>{layer.name}</div><button onClick={onToggle}>{layer.visible ? '👁️' : '🕶️'}</button><button onClick={onCalibrateOrigin}>🎯</button><button onClick={onCalibrateScale}>📏</button><button onClick={onDelete}>🗑️</button></div>;
}

function App() {
  const [nodes, setNodes] = useState<NodeData[]>([
    { pos: new THREE.Vector3(0, 0, 0), left_h: new THREE.Vector3(-3, 0, 0), right_h: new THREE.Vector3(3, 0, 0), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5, isCurved: false },
    { pos: new THREE.Vector3(10, 10, 0), left_h: new THREE.Vector3(7, 10, 0), right_h: new THREE.Vector3(13, 10, 0), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5, isCurved: false }
  ]);
  const [layers, setLayers] = useState<LayerData[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(0);
  const [selectedSegIdx, setSelectedSegIdx] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const [editMode, setEditMode] = useState<EditMode>('MOVE_NODE');
  const [axisLock, setAxisLock] = useState<AxisLock>('none');
  const [defaultSegmentType, setDefaultSegmentType] = useState<'straight' | 'curved'>('straight');
  const [snapStep, setSnapStep] = useState(1);
  const [useSnap, setUseSnap] = useState(false);
  const [calibratingLayerId, setCalibratingLayerId] = useState<string | null>(null);
  const [scaleP1, setScaleP1] = useState<THREE.Vector3 | null>(null);
  const [isPerspective, setIsPerspective] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const orbitRef = useRef<any>();

  const snap = (v: number) => useSnap ? Math.round(v / snapStep) * snapStep : v;
  const snapVec = (v: THREE.Vector3) => new THREE.Vector3(snap(v.x), snap(v.y), snap(v.z));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'w') setEditMode(prev => prev === 'MOVE_NODE' ? 'MOVE_BEZIER' : 'MOVE_NODE');
      if (e.key === 'ArrowUp') setAxisLock('z'); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setAxisLock('xy'); if (e.key === 'ArrowDown') setAxisLock('none');
    };
    window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const updateNode = useCallback((idx: number, newData: NodeData) => { setNodes(prev => { const next = [...prev]; next[idx] = newData; return next; }); }, []);
  const toggleSegmentType = (idx: number) => {
    setNodes(prev => {
      const next = [...prev]; const node = next[idx]; const isCurved = !node.isCurved;
      if (isCurved && idx > 0) { const p1 = next[idx-1].pos, p2 = node.pos, dir = p2.clone().sub(p1); next[idx-1].right_h = p1.clone().add(dir.clone().multiplyScalar(0.33)); node.left_h = p1.clone().add(dir.clone().multiplyScalar(0.66)); }
      next[idx] = { ...node, isCurved }; return next;
    });
  };
  const handleImport = async (type: 'pdf' | 'dxf') => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = type === 'pdf' ? '.pdf' : '.dxf';
    input.onchange = async (e: any) => {
      const file = e.target.files[0]; if (!file) return;
      try { const newLayer = type === 'pdf' ? await ImportLoaders.loadPDF(file) : await ImportLoaders.loadDXF(file); setLayers(prev => [...prev, newLayer]); } 
      catch (err) { alert("Import failed."); }
    };
    input.click();
  };
  const handleGroundClick = (e: any) => {
    const point = snapVec(e.point.clone());
    if (interactionMode === 'adding_node') {
      const newNode: NodeData = { pos: point, left_h: point.clone().add(new THREE.Vector3(-2,0,0)), right_h: point.clone().add(new THREE.Vector3(2,0,0)), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5, isCurved: defaultSegmentType === 'curved' };
      if (newNode.isCurved && nodes.length > 0) { const p1 = nodes[nodes.length-1].pos, p2 = newNode.pos, dir = p2.clone().sub(p1); const next = [...nodes]; next[nodes.length-1].right_h = p1.clone().add(dir.clone().multiplyScalar(0.33)); newNode.left_h = p1.clone().add(dir.clone().multiplyScalar(0.66)); setNodes([...next, newNode]); } 
      else { setNodes(prev => [...prev, newNode]); }
      setSelectedIdx(nodes.length); setInteractionMode('idle');
    } else if (interactionMode === 'calibrate_origin' && calibratingLayerId) { setLayers(prev => prev.map(l => l.id === calibratingLayerId ? { ...l, position: new THREE.Vector3().subVectors(l.position, point).setZ(l.position.z) } : l)); setInteractionMode('idle'); }
    else if (interactionMode === 'calibrate_scale_p1' && calibratingLayerId) { setScaleP1(point); setInteractionMode('calibrate_scale_p2'); }
    else if (interactionMode === 'calibrate_scale_p2' && scaleP1) { const dist = scaleP1.distanceTo(point), real = parseFloat(window.prompt(`Dist: ${dist.toFixed(3)}m. Real?`, "10") || ""); if (real) setLayers(prev => prev.map(l => l.id === calibratingLayerId ? { ...l, scale: l.scale * (real / dist) } : l)); setInteractionMode('idle'); setScaleP1(null); }
    else { setSelectedIdx(null); setSelectedSegIdx(null); }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', color: '#333', background: 'white' }}>
      <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
        <div style={{ background: 'rgba(255,255,255,0.9)', color: '#222', padding: '8px 20px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
          MODE: {editMode} (W) | LOCK: {axisLock.toUpperCase()} (Arrows)
        </div>
      </div>
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', gap: '5px', background: 'rgba(255,255,255,0.9)', padding: '5px', borderRadius: '8px' }}>
        <button className={`tool-btn ${isPerspective ? 'active' : ''}`} onClick={() => setIsPerspective(true)}>Persp</button><button className={`tool-btn ${!isPerspective ? 'active' : ''}`} onClick={() => setIsPerspective(false)}>Top</button>
        <button className={`tool-btn ${showGrid ? 'active' : ''}`} onClick={() => setShowGrid(!showGrid)}>Grid</button><button className={`tool-btn ${useSnap ? 'active' : ''}`} onClick={() => setUseSnap(!useSnap)}>Snap: {snapStep}m</button>
      </div>
      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: 'rgba(255,255,255,0.95)', padding: '20px', borderRadius: '12px', width: '260px' }}>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '1.2rem', fontWeight: 800 }}>ROAD EDITOR</h2>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}><button className={`tool-btn ${defaultSegmentType === 'straight' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setDefaultSegmentType('straight')}>Straight</button><button className={`tool-btn ${defaultSegmentType === 'curved' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setDefaultSegmentType('curved')}>Curved</button></div>
          <button style={{ width: '100%', padding: '10px', background: interactionMode === 'adding_node' ? '#4CAF50' : '#222', color: 'white', borderRadius: '6px', fontWeight: 'bold' }} onClick={() => setInteractionMode(interactionMode === 'adding_node' ? 'idle' : 'adding_node')}>+ Add Node</button>
          {selectedIdx !== null ? (
            <div style={{ padding: '15px', background: '#f9f9f9', borderRadius: '8px', marginTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><span>Node #{selectedIdx}</span>{selectedIdx > 0 && <button className={`tool-btn ${nodes[selectedIdx].isCurved ? 'active' : ''}`} onClick={() => toggleSegmentType(selectedIdx)}>{nodes[selectedIdx].isCurved ? 'CURVED' : 'STRAIGHT'}</button>}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}><NumericInput label="X" value={nodes[selectedIdx].pos.x} onChange={v => updateNode(selectedIdx, {...nodes[selectedIdx], pos: nodes[selectedIdx].pos.clone().setX(snap(v))})} /><NumericInput label="Y" value={nodes[selectedIdx].pos.y} onChange={v => updateNode(selectedIdx, {...nodes[selectedIdx], pos: nodes[selectedIdx].pos.clone().setY(snap(v))})} /><NumericInput label="Z" value={nodes[selectedIdx].pos.z} onChange={v => updateNode(selectedIdx, {...nodes[selectedIdx], pos: nodes[selectedIdx].pos.clone().setZ(snap(v))})} /></div>
            </div>
          ) : selectedSegIdx !== null ? (
            <div style={{ padding: '15px', background: '#e3f2fd', borderRadius: '8px', marginTop: '10px' }}><button className={`tool-btn ${nodes[selectedSegIdx].isCurved ? 'active' : ''}`} onClick={() => toggleSegmentType(selectedSegIdx)}>{nodes[selectedSegIdx].isCurved ? 'CURVED' : 'STRAIGHT'}</button><div>Dist: {nodes[selectedSegIdx-1].pos.distanceTo(nodes[selectedSegIdx].pos).toFixed(2)}m</div></div>
          ) : null}
        </div>
        <div style={{ background: 'rgba(255,255,255,0.95)', padding: '20px', borderRadius: '12px', width: '260px' }}><h2 style={{ fontSize: '1rem', fontWeight: 800 }}>LAYERS</h2><div style={{ display: 'flex', gap: '8px' }}><button onClick={() => handleImport('pdf')} style={{ flex: 1 }}>PDF</button><button onClick={() => handleImport('dxf')} style={{ flex: 1 }}>DXF</button></div>{layers.map(l => <LayerItem key={l.id} layer={l} onToggle={() => setLayers(prev => prev.map(ly => ly.id === l.id ? { ...ly, visible: !ly.visible } : ly))} onDelete={() => setLayers(prev => prev.filter(ly => ly.id !== l.id))} onCalibrateOrigin={() => { setInteractionMode('calibrate_origin'); setCalibratingLayerId(l.id); }} onCalibrateScale={() => { setInteractionMode('calibrate_scale_p1'); setCalibratingLayerId(l.id); }} />)}</div>
      </div>
      <Canvas shadows flat>
        <color attach="background" args={['white']} />
        {isPerspective ? <PerspectiveCamera makeDefault position={[30, -30, 30]} up={[0, 0, 1]} fov={45} /> : <OrthographicCamera makeDefault position={[0, 0, 50]} up={[0, 1, 0]} zoom={20} far={1000} near={-1000} />}
        <OrbitControls ref={orbitRef} makeDefault enableRotate={isPerspective} />
        <ambientLight intensity={1.0} /><AdaptiveGrid visible={showGrid} setSnapStep={setSnapStep} />
        {layers.map(layer => (
          <group key={layer.id} position={layer.position} scale={[layer.scale, layer.scale, 1]} visible={layer.visible} renderOrder={1}>
            {layer.type === 'pdf' ? <mesh><planeGeometry args={[10 * (layer.aspectRatio || 1), 10]} /><meshBasicMaterial map={layer.content as THREE.Texture} side={THREE.DoubleSide} toneMapped={false} depthWrite={true} /></mesh> : <primitive object={layer.content} />}
          </group>
        ))}
        <mesh rotation={[0, 0, 0]} onClick={handleGroundClick} position={[0,0,-0.1]}><planeGeometry args={[8000, 8000]} /><meshBasicMaterial transparent opacity={0} /></mesh>
        <group renderOrder={10}>
          {nodes.map((node, i) => <Node key={i} data={node} editMode={editMode} axisLock={axisLock} isSelected={selectedIdx === i} onSelect={() => { setSelectedIdx(i); setSelectedSegIdx(null); }} onChange={(newData) => updateNode(i, newData)} orbitControlsRef={orbitRef} snapVec={snapVec} />)}
          {nodes.map((node, i) => i > 0 && <Segment key={`seg-${i}`} editMode={editMode} axisLock={axisLock} n1={nodes[i-1]} n2={node} isSelected={selectedSegIdx === i} onSelect={() => { setSelectedSegIdx(i); setSelectedIdx(null); }} snapVec={snapVec} onChangeN1={(d) => updateNode(i-1, d)} onChangeN2={(d) => updateNode(i, d)} orbitControlsRef={orbitRef} />)}
        </group>
      </Canvas>
    </div>
  );
}
export default App
