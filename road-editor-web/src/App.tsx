import { useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, OrthographicCamera, Html, Line } from '@react-three/drei'
import * as THREE from 'three'

import { AdaptiveGrid, AxisLines } from './components/EditorHelpers'
import { EditorNode } from './components/EditorNode'
import { EditorSegment } from './components/EditorSegment'
import { NumericInput, LayerItem } from './components/Sidebar'
import { useRoadEditor } from './hooks/useRoadEditor'
import type { NodeData } from './logic/Geometry'

import './App.css'

function SceneController({ editor }: { editor: ReturnType<typeof useRoadEditor> }) {
  const { scene, raycaster } = useThree();
  const { 
    interactionMode, activeChainStartId, nodes, edges, 
    setHoveredNodeId, setHoveredEdgeId, setMousePointer, setIs90Snapped,
    snapVec, handleSceneClick, mousePointer, is90Snapped, minZ
  } = editor;

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
      <mesh 
        rotation={[0, 0, 0]} 
        onPointerMove={onPointerMove} 
        onClick={(e) => { e.stopPropagation(); handleSceneClick(mousePointer, editor.hoveredNodeId, editor.hoveredEdgeId); }} 
        onPointerDown={(e) => { e.stopPropagation(); }}
        onDoubleClick={(e) => { e.stopPropagation(); editor.setActiveChainStartId(null); }} 
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

function App() {
  const editor = useRoadEditor();
  const orbitRef = useRef<any>(null);

  const {
    nodes, setNodes, edges, setEdges,
    undo, redo, canUndo, canRedo, pushHistory,
    selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId,
    hoveredNodeId, hoveredEdgeId,
    interactionMode, setInteractionMode, editMode, axisLock,
    useSnap, setUseSnap, snapStep, setSnapStep,
    isPerspective, setIsPerspective, showGrid, setShowGrid,
    layers, setLayers, activeChainStartId, mousePointer, is90Snapped,
    snapVec, minZ, handleSceneClick, handleImport
  } = editor;

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: 'white' }}>
      <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10, display: 'flex', gap: '5px', background: 'rgba(255,255,255,0.9)', padding: '5px', borderRadius: '8px' }}>
        <button className={`tool-btn ${canUndo ? '' : 'disabled'}`} onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩️</button>
        <button className={`tool-btn ${canRedo ? '' : 'disabled'}`} onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪️</button>
        <div style={{ width: '1px', background: '#ccc', margin: '0 5px' }} />
        <button className={`tool-btn ${interactionMode === 'SELECT' ? 'active' : ''}`} onClick={() => { setInteractionMode('SELECT'); editor.setActiveChainStartId(null); }}>🖱️ Move/Select</button>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><span>Node Info</span><button className="tool-btn" style={{ fontSize: '0.6rem' }} onClick={() => { 
                pushHistory(nodes, edges);
                const connectedEdges = edges.filter(e => e.n1 === selectedNodeId || e.n2 === selectedNodeId);
                setNodes(prev => {
                  const newNodes = { ...prev };
                  delete newNodes[selectedNodeId];
                  connectedEdges.forEach(edge => {
                    const otherNodeId = edge.n1 === selectedNodeId ? edge.n2 : edge.n1;
                    if (newNodes[otherNodeId]) {
                      const newHandles = { ...newNodes[otherNodeId].handles };
                      delete newHandles[edge.id];
                      newNodes[otherNodeId] = { ...newNodes[otherNodeId], handles: newHandles };
                    }
                  });
                  return newNodes;
                });
                setEdges(prev => prev.filter(e => e.n1 !== selectedNodeId && e.n2 !== selectedNodeId)); 
                setSelectedNodeId(null); 
              }}>Delete</button></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                <NumericInput label="X" value={nodes[selectedNodeId].pos.x} onChange={v => { pushHistory(nodes, edges); setNodes(p => ({ ...p, [selectedNodeId]: { ...p[selectedNodeId], pos: p[selectedNodeId].pos.clone().setX(v) } })); }} />
                <NumericInput label="Y" value={nodes[selectedNodeId].pos.y} onChange={v => { pushHistory(nodes, edges); setNodes(p => ({ ...p, [selectedNodeId]: { ...p[selectedNodeId], pos: p[selectedNodeId].pos.clone().setY(v) } })); }} />
                <NumericInput label="Z" value={nodes[selectedNodeId].pos.z} onChange={v => { pushHistory(nodes, edges); setNodes(p => ({ ...p, [selectedNodeId]: { ...p[selectedNodeId], pos: p[selectedNodeId].pos.clone().setZ(v) } })); }} />
              </div>
            </div>
          )}
          {selectedEdgeId && edges.find(e => e.id === selectedEdgeId) && (
            <div style={{ padding: '15px', background: '#e3f2fd', borderRadius: '8px', marginTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><span>Edge Info</span><button className="tool-btn" style={{ fontSize: '0.6rem' }} onClick={() => { 
                pushHistory(nodes, edges);
                const edgeToDelete = edges.find(e => e.id === selectedEdgeId)!;
                setNodes(prev => {
                  const newNodes = { ...prev };
                  [edgeToDelete.n1, edgeToDelete.n2].forEach(nid => {
                    if (newNodes[nid]) {
                      const newHandles = { ...newNodes[nid].handles };
                      delete newHandles[selectedEdgeId!];
                      newNodes[nid] = { ...newNodes[nid], handles: newHandles };
                    }
                  });
                  return newNodes;
                });
                setEdges(prev => prev.filter(e => e.id !== selectedEdgeId)); 
                setSelectedEdgeId(null); 
              }}>Delete</button></div>
              
              {(() => {
                const edge = edges.find(e => e.id === selectedEdgeId)!;
                const n1 = nodes[edge.n1];
                if (!n1) return null;
                const updateEdgeNodes = (field: keyof NodeData, val: number) => {
                  pushHistory(nodes, edges);
                  setNodes(prev => ({
                    ...prev,
                    [edge.n1]: { ...prev[edge.n1], [field]: val },
                    [edge.n2]: { ...prev[edge.n2], [field]: val }
                  }));
                };
                const totalWidth = n1.lane_l + n1.lane_r + n1.sw_l + n1.sw_r;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                    <NumericInput label="Total Width" value={totalWidth} onChange={v => {
                      pushHistory(nodes, edges);
                      const ratio = v / (totalWidth || 1);
                      setNodes(prev => ({
                        ...prev,
                        [edge.n1]: { ...prev[edge.n1], lane_l: prev[edge.n1].lane_l * ratio, lane_r: prev[edge.n1].lane_r * ratio, sw_l: prev[edge.n1].sw_l * ratio, sw_r: prev[edge.n1].sw_r * ratio },
                        [edge.n2]: { ...prev[edge.n2], lane_l: prev[edge.n2].lane_l * ratio, lane_r: prev[edge.n2].lane_r * ratio, sw_l: prev[edge.n2].sw_l * ratio, sw_r: prev[edge.n2].sw_r * ratio }
                      }));
                    }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <NumericInput label="Lane L" value={n1.lane_l} onChange={v => updateEdgeNodes('lane_l', v)} />
                      <NumericInput label="Lane R" value={n1.lane_r} onChange={v => updateEdgeNodes('lane_r', v)} />
                      <NumericInput label="Sidewalk L" value={n1.sw_l} onChange={v => updateEdgeNodes('sw_l', v)} />
                      <NumericInput label="Sidewalk R" value={n1.sw_r} onChange={v => updateEdgeNodes('sw_r', v)} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid #ddd', padding: '10px', borderRadius: '8px', background: 'rgba(255,255,255,0.5)' }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>Road Alignment
                        <select 
                          value={edge.alignment || 'CENTER'} 
                          onChange={(e) => {
                            pushHistory(nodes, edges);
                            const align = e.target.value as any;
                            setEdges(prev => prev.map(ed => {
                              if (ed.id === selectedEdgeId) {
                                const newEdge = { ...ed, alignment: align };
                                // Auto-switch to ANGLE mode if it's currently FIXED or low-res
                                if (align !== 'CENTER' && (!ed.resMode || ed.resMode === 'FIXED')) {
                                  newEdge.resMode = 'ANGLE';
                                  newEdge.resValue = 5; // Good default for tight turns
                                }
                                return newEdge;
                              }
                              return ed;
                            }));
                          }}
                          style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                        >
                          <option value="CENTER">Center (Standard)</option>
                          <option value="LEFT">Left Border (Inside)</option>
                          <option value="RIGHT">Right Border (Inside)</option>
                        </select>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '4px', border: '1px solid #eee', borderRadius: '4px', background: 'rgba(0,0,0,0.03)' }}>
                        <label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#888' }}>START ANCHOR
                          <select 
                            value={edge.n1Anchor || edge.alignment || 'CENTER'}
                            onChange={(e) => {
                              pushHistory(nodes, edges);
                              const val = e.target.value as any;
                              setEdges(prev => prev.map(ed => ed.id === selectedEdgeId ? { ...ed, n1Anchor: val } : ed));
                            }}
                            style={{ width: '100%', fontSize: '0.7rem' }}
                          >
                            <option value="CENTER">Center</option>
                            <option value="LEFT">Left Side</option>
                            <option value="RIGHT">Right Side</option>
                          </select>
                        </label>
                        <label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#888' }}>END ANCHOR
                          <select 
                            value={edge.n2Anchor || edge.alignment || 'CENTER'}
                            onChange={(e) => {
                              pushHistory(nodes, edges);
                              const val = e.target.value as any;
                              setEdges(prev => prev.map(ed => ed.id === selectedEdgeId ? { ...ed, n2Anchor: val } : ed));
                            }}
                            style={{ width: '100%', fontSize: '0.7rem' }}
                          >
                            <option value="CENTER">Center</option>
                            <option value="LEFT">Left Side</option>
                            <option value="RIGHT">Right Side</option>
                          </select>
                        </label>
                      </div>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>Tight Turn Mode
                        <select 
                          value={edge.tightTurnMode || 'APEX'} 
                          onChange={(e) => {
                            pushHistory(nodes, edges);
                            const mode = e.target.value as any;
                            setEdges(prev => prev.map(ed => ed.id === selectedEdgeId ? { ...ed, tightTurnMode: mode } : ed));
                          }}
                          style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                        >
                          <option value="APEX">Apex (Fast/Pointy)</option>
                          <option value="CLEAN">Clean (Smooth Offset)</option>
                        </select>
                      </label>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#666' }}>Res. Mode
                        <select 
                          value={edge.resMode || 'FIXED'} 
                          onChange={(e) => {
                            pushHistory(nodes, edges);
                            const mode = e.target.value as any;
                            setEdges(prev => prev.map(ed => ed.id === selectedEdgeId ? { ...ed, resMode: mode, resValue: mode === 'FIXED' ? 24 : (mode === 'LENGTH' ? 2 : 10) } : ed));
                          }}
                          style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                        >
                          <option value="FIXED">Fixed Divisions</option>
                          <option value="LENGTH">By Length (m)</option>
                          <option value="ANGLE">By Angle (°)</option>
                          <option value="ERROR">Chord Error (m)</option>
                        </select>
                      </label>
                      <NumericInput 
                        label={
                          edge.resMode === 'LENGTH' ? "Interval (meters)" : 
                          (edge.resMode === 'ANGLE' ? "Interval (degrees)" : 
                          (edge.resMode === 'ERROR' ? "Max Deviation (meters)" : "Total Divisions"))
                        } 
                        value={edge.resValue || edge.resolution || (edge.resMode === 'FIXED' ? 24 : (edge.resMode === 'LENGTH' ? 2 : (edge.resMode === 'ANGLE' ? 10 : 0.01)))} 
                        onChange={v => {
                          pushHistory(nodes, edges);
                          setEdges(prev => prev.map(ed => ed.id === selectedEdgeId ? { ...ed, resValue: v, resolution: undefined } : ed));
                        }} 
                      />
                    </div>
                    <button className="tool-btn" onClick={() => {
                      pushHistory(nodes, edges);
                      const dir = nodes[edge.n2].pos.clone().sub(nodes[edge.n1].pos);
                      setNodes(pn => ({ 
                        ...pn, 
                        [edge.n1]: { ...pn[edge.n1], handles: { ...pn[edge.n1].handles, [edge.id]: nodes[edge.n1].pos.clone().add(dir.clone().multiplyScalar(0.33)) } }, 
                        [edge.n2]: { ...pn[edge.n2], handles: { ...pn[edge.n2].handles, [edge.id]: nodes[edge.n1].pos.clone().add(dir.clone().multiplyScalar(0.66)) } } 
                      }));
                    }}>Straighten Curve</button>
                  </div>
                );
              })()}
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
        <SceneController editor={editor} />
        
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
            <EditorNode 
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
              onDragStart={() => pushHistory(nodes, edges)}
            />
          ))}
          {edges.map((e) => (
            <EditorSegment 
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
