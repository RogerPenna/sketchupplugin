import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Grid, PerspectiveCamera, OrthographicCamera, Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { NodeData } from './logic/Geometry'
import { ImportLoaders, type LayerData } from './logic/ImportLoaders'
import './App.css'

// Standard SketchUp Colors
const X_COLOR = '#ff0000'
const Y_COLOR = '#00ff00'
const Z_COLOR = '#0000ff'
const GRID_COLOR = '#d1e7f0'
const GRID_SECTION_COLOR = '#a0c4d1'

type InteractionMode = 'idle' | 'adding_node' | 'calibrate_origin' | 'calibrate_scale_p1' | 'calibrate_scale_p2';

function DragHandle({ direction, color, nodePos, onUpdate, onStart, onEnd, onSelect }: { 
  direction: THREE.Vector3, 
  color: string, 
  nodePos: THREE.Vector3,
  onUpdate: (newPos: THREE.Vector3) => void,
  onStart: () => void,
  onEnd: () => void,
  onSelect: () => void
}) {
  const { camera, raycaster } = useThree();
  const [hovered, setHovered] = useState(false);
  const dragging = useRef(false);
  const plane = useRef(new THREE.Plane());
  const startNodePos = useRef(new THREE.Vector3());
  const startIntersect = useRef(new THREE.Vector3());

  const handlePointerDown = (e: any) => {
    e.stopPropagation();
    (e.target as any).setPointerCapture(e.pointerId);
    dragging.current = true;
    onSelect();
    onStart();
    startNodePos.current.copy(nodePos);
    if (Math.abs(direction.z) > 0.5) {
      const camDir = new THREE.Vector3().subVectors(camera.position, nodePos).setZ(0).normalize();
      plane.current.setFromNormalAndCoplanarPoint(camDir, nodePos);
    } else {
      plane.current.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), nodePos);
    }
    raycaster.ray.intersectPlane(plane.current, startIntersect.current);
  };

  const handlePointerMove = (e: any) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const currentIntersect = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane.current, currentIntersect)) {
      const totalDelta = new THREE.Vector3().subVectors(currentIntersect, startIntersect.current);
      const newPos = startNodePos.current.clone();
      if (Math.abs(direction.z) > 0.5) newPos.z += totalDelta.z;
      else { newPos.x += totalDelta.x; newPos.y += totalDelta.y; }
      onUpdate(newPos);
    }
  };

  const handlePointerUp = (e: any) => {
    dragging.current = false;
    onEnd();
    (e.target as any).releasePointerCapture(e.pointerId);
  };

  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  const offset = direction.clone().multiplyScalar(1.5);

  return (
    <group position={[offset.x, offset.y, offset.z]} quaternion={quat} onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onClick={(e) => e.stopPropagation()} >
      <mesh>
        <coneGeometry args={[0.2, 0.5, 16]} />
        <meshStandardMaterial color={color} transparent opacity={hovered ? 0.9 : 0.4} depthTest={false} />
      </mesh>
      <mesh position={[0, -0.4, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 16]} />
        <meshStandardMaterial color={color} transparent opacity={hovered ? 0.9 : 0.4} depthTest={false} />
      </mesh>
      <mesh visible={false}>
        <sphereGeometry args={[0.8]} />
      </mesh>
    </group>
  );
}

function Node({ data, onChange, onSelect, isSelected, orbitControlsRef }: { 
  data: NodeData, onChange: (newData: NodeData) => void, onSelect: () => void, isSelected: boolean, orbitControlsRef: any
}) {
  const showElevationLine = Math.abs(data.pos.z) > 0.01;
  const handleUpdate = (newPos: THREE.Vector3) => {
    onChange({ ...data, pos: newPos, left_h: newPos.clone().add(new THREE.Vector3(-5,0,0)), right_h: newPos.clone().add(new THREE.Vector3(5,0,0)) });
  };
  const toggleOrbit = (active: boolean) => { if (orbitControlsRef.current) orbitControlsRef.current.enabled = !active; };

  return (
    <group position={[data.pos.x, data.pos.y, data.pos.z]}>
      <mesh onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial color={isSelected ? "yellow" : "#2222ff"} emissive={isSelected ? "yellow" : "black"} emissiveIntensity={0.5} />
      </mesh>
      {showElevationLine && !isNaN(data.pos.x) && !isNaN(data.pos.y) && !isNaN(data.pos.z) && (
        <group position={[-data.pos.x, -data.pos.y, -data.pos.z]}>
          <Line points={[[data.pos.x, data.pos.y, 0], [data.pos.x, data.pos.y, data.pos.z]]} color="#666" lineWidth={1} dashed dashSize={0.2} gapSize={0.2} transparent opacity={0.6} />
          <mesh position={[data.pos.x, data.pos.y, 0.01]}>
            <ringGeometry args={[0.25, 0.35, 32]} />
            <meshBasicMaterial color="#444" opacity={0.8} transparent side={THREE.DoubleSide} />
          </mesh>
        </group>
      )}
      {isSelected && (
        <group>
          <DragHandle color="#ff4444" nodePos={data.pos} direction={new THREE.Vector3(1, 0, 0)} onUpdate={handleUpdate} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="#ff4444" nodePos={data.pos} direction={new THREE.Vector3(-1, 0, 0)} onUpdate={handleUpdate} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="#44ff44" nodePos={data.pos} direction={new THREE.Vector3(0, 1, 0)} onUpdate={handleUpdate} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="#44ff44" nodePos={data.pos} direction={new THREE.Vector3(0, -1, 0)} onUpdate={handleUpdate} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="#4444ff" nodePos={data.pos} direction={new THREE.Vector3(0, 0, 1)} onUpdate={handleUpdate} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
          <DragHandle color="#4444ff" nodePos={data.pos} direction={new THREE.Vector3(0, 0, -1)} onUpdate={handleUpdate} onStart={() => toggleOrbit(true)} onEnd={() => toggleOrbit(false)} onSelect={onSelect} />
        </group>
      )}
    </group>
  );
}

function Segment({ start, end, isSelected, onSelect }: { start: THREE.Vector3, end: THREE.Vector3, isSelected: boolean, onSelect: () => void }) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const angle = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());

  return (
    <group>
      <line>
        <bufferGeometry attach="geometry">
          <float32BufferAttribute attach="attributes-position" args={[new Float32Array([start.x, start.y, start.z + 0.01, end.x, end.y, end.z + 0.01]), 3]} />
        </bufferGeometry>
        <lineBasicMaterial attach="material" color={isSelected ? "#ffeb3b" : "#444"} linewidth={isSelected ? 5 : 2} />
      </line>
      <mesh position={midpoint} quaternion={quat} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <cylinderGeometry args={[0.6, 0.6, length, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <Html position={[midpoint.x, midpoint.y, midpoint.z]} center style={{ pointerEvents: 'auto' }}>
        <div onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ background: isSelected ? '#ffeb3b' : 'rgba(0, 0, 0, 0.75)', color: isSelected ? 'black' : 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap', fontFamily: 'monospace', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', border: isSelected ? '2px solid black' : '1px solid rgba(255,255,255,0.2)', fontWeight: isSelected ? 'bold' : 'normal', cursor: 'pointer', pointerEvents: 'auto' }}>
          {length.toFixed(2)}m | {angle.toFixed(1)}°
        </div>
      </Html>
    </group>
  );
}

function NumericInput({ label, value, onChange, gridSpan = "1" }: { label: string, value: number, onChange: (val: number) => void, gridSpan?: string }) {
  const [localValue, setLocalValue] = useState(value.toFixed(2));
  useEffect(() => { setLocalValue(value.toFixed(2)); }, [value]);
  const handleCommit = () => { const parsed = parseFloat(localValue); if (!isNaN(parsed)) onChange(parsed); else setLocalValue(value.toFixed(2)); };
  return (
    <label style={{ fontSize: '0.7rem', fontWeight: 'bold', gridColumn: `span ${gridSpan}`, color: '#666' }}>
      {label}
      <input type="text" value={localValue} onChange={e => setLocalValue(e.target.value)} onBlur={handleCommit} onKeyDown={e => e.key === 'Enter' && handleCommit()} style={{ width: '100%', padding: '6px', marginTop: '4px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.8rem' }} />
    </label>
  );
}

function LayerItem({ layer, onToggle, onDelete, onCalibrateOrigin, onCalibrateScale }: { 
  layer: LayerData, onToggle: () => void, onDelete: () => void, onCalibrateOrigin: () => void, onCalibrateScale: () => void 
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#f5f5f5', borderRadius: '6px', marginBottom: '4px' }}>
      <div style={{ flex: 1, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={layer.name}>
        {layer.name}
      </div>
      <button onClick={onToggle} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>{layer.visible ? '👁️' : '🕶️'}</button>
      <button onClick={onCalibrateOrigin} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }} title="Set Origin">🎯</button>
      <button onClick={onCalibrateScale} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }} title="Set Scale">📏</button>
      <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }}>🗑️</button>
    </div>
  );
}

function App() {
  const [nodes, setNodes] = useState<NodeData[]>([
    { pos: new THREE.Vector3(0, 0, 0), left_h: new THREE.Vector3(-5, 0, 0), right_h: new THREE.Vector3(5, 0, 0), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5 },
    { pos: new THREE.Vector3(10, 10, 0), left_h: new THREE.Vector3(5, 10, 0), right_h: new THREE.Vector3(15, 10, 0), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5 }
  ]);
  const [layers, setLayers] = useState<LayerData[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(0);
  const [selectedSegIdx, setSelectedSegIdx] = useState<number | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('idle');
  const [calibratingLayerId, setCalibratingLayerId] = useState<string | null>(null);
  const [scaleP1, setScaleP1] = useState<THREE.Vector3 | null>(null);
  const [isPerspective, setIsPerspective] = useState(true);
  const orbitRef = useRef<any>();

  const updateNode = useCallback((idx: number, newData: NodeData) => {
    setNodes(prev => { const next = [...prev]; next[idx] = newData; return next; });
  }, []);

  const handleImport = async (type: 'pdf' | 'dxf') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'pdf' ? '.pdf' : '.dxf';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const newLayer = type === 'pdf' ? await ImportLoaders.loadPDF(file) : await ImportLoaders.loadDXF(file);
        setLayers(prev => [...prev, newLayer]);
      } catch (err) { console.error("Import error:", err); alert("Failed to import file."); }
    };
    input.click();
  };

  const handleGroundClick = (e: any) => {
    if (interactionMode === 'adding_node') {
      e.stopPropagation();
      const clickPos = e.point.clone();
      const newNode: NodeData = { pos: clickPos, left_h: clickPos.clone().add(new THREE.Vector3(-5,0,0)), right_h: clickPos.clone().add(new THREE.Vector3(5,0,0)), lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5 };
      setNodes(prev => [...prev, newNode]);
      setSelectedIdx(nodes.length);
      setSelectedSegIdx(null);
      setInteractionMode('idle');
    } else if (interactionMode === 'calibrate_origin' && calibratingLayerId) {
      e.stopPropagation();
      const clickPos = e.point.clone();
      setLayers(prev => prev.map(l => {
        if (l.id !== calibratingLayerId) return l;
        // Shift layer so that clickPos becomes global origin
        const offset = new THREE.Vector3().subVectors(l.position, clickPos).setZ(l.position.z);
        return { ...l, position: offset };
      }));
      setInteractionMode('idle');
      setCalibratingLayerId(null);
    } else if (interactionMode === 'calibrate_scale_p1' && calibratingLayerId) {
      e.stopPropagation();
      setScaleP1(e.point.clone());
      setInteractionMode('calibrate_scale_p2');
    } else if (interactionMode === 'calibrate_scale_p2' && calibratingLayerId && scaleP1) {
      e.stopPropagation();
      const p2 = e.point.clone();
      const dist = scaleP1.distanceTo(p2);
      const realDistStr = window.prompt(`Distance in 3D space is ${dist.toFixed(3)}m. What is the real distance in meters?`, "10");
      const realDist = parseFloat(realDistStr || "");
      if (!isNaN(realDist) && realDist > 0) {
        setLayers(prev => prev.map(l => {
          if (l.id !== calibratingLayerId) return l;
          const ratio = realDist / dist;
          return { ...l, scale: l.scale * ratio };
        }));
      }
      setInteractionMode('idle');
      setCalibratingLayerId(null);
      setScaleP1(null);
    } else {
      setSelectedIdx(null);
      setSelectedSegIdx(null);
    }
  };

  const deleteNode = () => {
    if (selectedIdx === null || nodes.length <= 1) return;
    setNodes(prev => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  };

  const nodeData = selectedIdx !== null ? nodes[selectedIdx] : null;
  const segData = selectedSegIdx !== null ? { start: nodes[selectedSegIdx - 1], end: nodes[selectedSegIdx] } : null;

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', color: '#333', background: 'white' }}>
      {/* Interaction Help Overlay */}
      {interactionMode !== 'idle' && (
        <div style={{ position: 'absolute', top: 100, left: '50%', transform: 'translateX(-50%)', zIndex: 100, background: 'rgba(0,0,0,0.8)', color: 'white', padding: '10px 20px', borderRadius: '20px', pointerEvents: 'none' }}>
          {interactionMode === 'adding_node' && 'Click on ground to add node'}
          {interactionMode === 'calibrate_origin' && 'Click on layer point to set as origin (0,0)'}
          {interactionMode === 'calibrate_scale_p1' && 'Click START point of known distance'}
          {interactionMode === 'calibrate_scale_p2' && 'Click END point of known distance'}
        </div>
      )}

      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', gap: '10px' }}>
        <button style={{ padding: '8px 16px', background: isPerspective ? '#222' : '#eee', color: isPerspective ? 'white' : '#222', border: '1px solid #222', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setIsPerspective(true)}>Perspective</button>
        <button style={{ padding: '8px 16px', background: !isPerspective ? '#222' : '#eee', color: !isPerspective ? 'white' : '#222', border: '1px solid #222', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => setIsPerspective(false)}>Top Parallel</button>
      </div>

      <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: 'rgba(255,255,255,0.95)', padding: '20px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)', width: '260px', border: '1px solid #eee' }}>
          <h2 style={{ margin: '0 0 5px 0', fontSize: '1.4rem', color: '#000', fontWeight: 800 }}>ROAD EDITOR</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
            <button style={{ padding: '10px', background: interactionMode === 'adding_node' ? '#4CAF50' : '#222', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }} onClick={() => { setInteractionMode(interactionMode === 'adding_node' ? 'idle' : 'adding_node'); setSelectedIdx(null); setSelectedSegIdx(null); }}>{interactionMode === 'adding_node' ? 'CLICK ON GROUND' : '+ Add Node Tool'}</button>
            <button style={{ padding: '10px', background: '#fee', color: '#f44', border: '1px solid #fcc', borderRadius: '6px', cursor: 'pointer' }} onClick={deleteNode} disabled={selectedIdx === null}>Delete Selected</button>
          </div>
          {selectedIdx !== null && nodeData ? (
            <div style={{ padding: '15px', background: '#f9f9f9', borderRadius: '8px', border: '1px solid #eee' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Node #{selectedIdx}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '15px' }}>
                <NumericInput label="X" value={nodeData.pos.x} onChange={val => updateNode(selectedIdx, { ...nodeData, pos: nodeData.pos.clone().setX(val) })} />
                <NumericInput label="Y" value={nodeData.pos.y} onChange={val => updateNode(selectedIdx, { ...nodeData, pos: nodeData.pos.clone().setY(val) })} />
                <NumericInput label="Z" value={nodeData.pos.z} onChange={val => updateNode(selectedIdx, { ...nodeData, pos: nodeData.pos.clone().setZ(val) })} />
              </div>
              {selectedIdx > 0 && (
                <div style={{ borderTop: '1px solid #ddd', paddingTop: '15px', marginTop: '15px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <NumericInput label="DISTANCE (m)" value={nodes[selectedIdx-1].pos.distanceTo(new THREE.Vector3(nodeData.pos.x, nodeData.pos.y, nodes[selectedIdx-1].pos.z))} onChange={L => { const prev = nodes[selectedIdx-1].pos; const A = Math.atan2(nodeData.pos.y - prev.y, nodeData.pos.x - prev.x); const newPos = new THREE.Vector3(prev.x + L * Math.cos(A), prev.y + L * Math.sin(A), nodeData.pos.z); updateNode(selectedIdx, { ...nodeData, pos: newPos }); }} />
                    <NumericInput label="ANGLE (°)" value={Math.atan2(nodeData.pos.y - nodes[selectedIdx-1].pos.y, nodeData.pos.x - nodes[selectedIdx-1].pos.x) * 180 / Math.PI} onChange={deg => { const A = deg * Math.PI / 180; const prev = nodes[selectedIdx-1].pos; const L = prev.distanceTo(new THREE.Vector3(nodeData.pos.x, nodeData.pos.y, prev.z)); const newPos = new THREE.Vector3(prev.x + L * Math.cos(A), prev.y + L * Math.sin(A), nodeData.pos.z); updateNode(selectedIdx, { ...nodeData, pos: newPos }); }} />
                  </div>
                </div>
              )}
            </div>
          ) : selectedSegIdx !== null && segData ? (
            <div style={{ padding: '15px', background: '#fff9c4', borderRadius: '8px', border: '1px solid #fbc02d' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Segment {selectedSegIdx-1} → {selectedSegIdx}</h3>
              <div style={{ display: 'grid', gap: '10px' }}>
                <div style={{ fontSize: '0.8rem' }}><strong>Length:</strong> {segData.start.pos.distanceTo(segData.end.pos).toFixed(2)}m</div>
                <div style={{ fontSize: '0.8rem' }}><strong>Angle:</strong> {(Math.atan2(segData.end.pos.y - segData.start.pos.y, segData.end.pos.x - segData.start.pos.x) * 180 / Math.PI).toFixed(1)}°</div>
              </div>
            </div>
          ) : ( <div style={{ textAlign: 'center', padding: '20px', color: '#999', border: '2px dashed #eee', borderRadius: '8px' }}>Select a node or edge to edit</div> )}
        </div>

        <div style={{ background: 'rgba(255,255,255,0.95)', padding: '20px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)', width: '260px', border: '1px solid #eee' }}>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#000', fontWeight: 800 }}>LAYERS</h2>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
            <button onClick={() => handleImport('pdf')} style={{ flex: 1, padding: '8px', fontSize: '0.7rem', background: '#222', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Import PDF</button>
            <button onClick={() => handleImport('dxf')} style={{ flex: 1, padding: '8px', fontSize: '0.7rem', background: '#222', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Import DXF</button>
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {layers.map(l => (
              <LayerItem 
                key={l.id} 
                layer={l} 
                onToggle={() => setLayers(prev => prev.map(ly => ly.id === l.id ? { ...ly, visible: !ly.visible } : ly))} 
                onDelete={() => setLayers(prev => prev.filter(ly => ly.id !== l.id))}
                onCalibrateOrigin={() => { setInteractionMode('calibrate_origin'); setCalibratingLayerId(l.id); }}
                onCalibrateScale={() => { setInteractionMode('calibrate_scale_p1'); setCalibratingLayerId(l.id); }}
              />
            ))}
            {layers.length === 0 && <div style={{ textAlign: 'center', padding: '10px', color: '#999', fontSize: '0.8rem' }}>No layers imported</div>}
          </div>
        </div>
      </div>

      <Canvas shadows>
        <color attach="background" args={['white']} />
        {isPerspective ? ( <PerspectiveCamera makeDefault position={[30, -30, 30]} up={[0, 0, 1]} fov={45} /> ) : ( <OrthographicCamera makeDefault position={[0, 0, 50]} up={[0, 1, 0]} zoom={20} far={1000} near={-1000} /> )}
        <OrbitControls ref={orbitRef} makeDefault enableDamping={false} enableRotate={isPerspective} mouseButtons={{ LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }} />
        <ambientLight intensity={0.8} />
        <pointLight position={[50, 50, 50]} intensity={1.5} />
        <Grid infiniteGrid fadeDistance={200} sectionSize={10} sectionThickness={1.5} sectionColor={GRID_SECTION_COLOR} cellSize={1} cellThickness={0.8} cellColor={GRID_COLOR} rotation={[Math.PI / 2, 0, 0]} />
        
        {/* Layer Rendering */}
        {layers.map(layer => (
          <group key={layer.id} position={layer.position} scale={[layer.scale, layer.scale, 1]} visible={layer.visible}>
            {layer.type === 'pdf' ? (
              <mesh rotation={[0, 0, 0]}>
                <planeGeometry args={[10 * (layer.aspectRatio || 1), 10]} />
                <meshBasicMaterial map={layer.content as THREE.Texture} transparent opacity={0.7} side={THREE.DoubleSide} />
              </mesh>
            ) : (
              <primitive object={layer.content} />
            )}
          </group>
        ))}

        <mesh rotation={[0, 0, 0]} onClick={handleGroundClick}>
          <planeGeometry args={[4000, 4000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
        
        <group>
          <line>
            <bufferGeometry attach="geometry" onUpdate={self => self.setFromPoints([new THREE.Vector3(-1000, 0, 0.005), new THREE.Vector3(1000, 0, 0.005)])} />
            <lineBasicMaterial attach="material" color={X_COLOR} linewidth={2} />
          </line>
          <line>
            <bufferGeometry attach="geometry" onUpdate={self => self.setFromPoints([new THREE.Vector3(0, -1000, 0.005), new THREE.Vector3(0, 1000, 0.005)])} />
            <lineBasicMaterial attach="material" color={Y_COLOR} linewidth={2} />
          </line>
        </group>
        
        {nodes.map((node, i) => (
          <Node key={i} data={node} isSelected={selectedIdx === i} onSelect={() => { setSelectedIdx(i); setSelectedSegIdx(null); }} onChange={(newData) => updateNode(i, newData)} orbitControlsRef={orbitRef} />
        ))}
        {nodes.map((node, i) => {
          if (i === 0) return null;
          return <Segment key={`seg-${i}`} start={nodes[i-1].pos} end={node.pos} isSelected={selectedSegIdx === i} onSelect={() => { setSelectedSegIdx(i); setSelectedIdx(null); }} />;
        })}

        {/* Scale Calibration Visualization */}
        {interactionMode === 'calibrate_scale_p2' && scaleP1 && (
          <mesh position={[scaleP1.x, scaleP1.y, 0.1]}>
            <sphereGeometry args={[0.2]} />
            <meshBasicMaterial color="yellow" />
          </mesh>
        )}
      </Canvas>
    </div>
  );
}

export default App
