import { useState, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { NodeData, EdgeData } from '../logic/Geometry';
import { ImportLoaders } from '../logic/ImportLoaders';
import type { LayerData } from '../logic/ImportLoaders';
import type { InteractionMode, EditMode, AxisLock } from '../types/editor';

export function useRoadEditor() {
  // --- STATES ---
  const [nodes, setNodes] = useState<Record<string, NodeData>>({});
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [history, setHistory] = useState<{ past: { nodes: Record<string, NodeData>, edges: EdgeData[] }[], future: { nodes: Record<string, NodeData>, edges: EdgeData[] }[] }>({ past: [], future: [] });

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
  const [showDebug, setShowDebug] = useState(true);
  const [shadowOffset, setShadowOffset] = useState(-0.4);
  const [gridOffset, setGridOffset] = useState(-1.0);
  const [axisOffset, setAxisOffset] = useState(0.005);
  const [defaultRoadSettings, setDefaultRoadSettings] = useState({
    lane_l: 3.5,
    lane_r: 3.5,
    sw_l: 1.5,
    sw_r: 1.5,
    resMode: 'FIXED' as const,
    resValue: 24,
    alignment: 'CENTER' as const,
    tightTurnMode: 'APEX' as const
  });
  const [layers, setLayers] = useState<LayerData[]>([]);
  const [activeChainStartId, setActiveChainStartId] = useState<string | null>(null);
  const [mousePointer, setMousePointer] = useState<THREE.Vector3>(new THREE.Vector3());
  const [is90Snapped, setIs90Snapped] = useState(false);

  // --- HELPERS (Not Hooks) ---
  const generateId = (prefix: string) => prefix + Math.random().toString(36).substring(2, 7);

  // --- CALLBACKS ---
  const pushHistory = useCallback((currentNodes: Record<string, NodeData>, currentEdges: EdgeData[]) => {
    setHistory(prev => {
      const newPast = [...prev.past, { nodes: JSON.parse(JSON.stringify(currentNodes)), edges: JSON.parse(JSON.stringify(currentEdges)) }];
      if (newPast.length > 10) newPast.shift();
      return { past: newPast, future: [] };
    });
  }, []);

  const hydrateState = useCallback((state: { nodes: Record<string, NodeData>, edges: EdgeData[] }) => {
    const newNodes: Record<string, NodeData> = {};
    Object.entries(state.nodes).forEach(([id, node]) => {
      const newHandles: Record<string, THREE.Vector3> = {};
      Object.entries(node.handles).forEach(([hid, h]) => {
        newHandles[hid] = new THREE.Vector3(h.x, h.y, h.z);
      });
      newNodes[id] = {
        ...node,
        pos: new THREE.Vector3(node.pos.x, node.pos.y, node.pos.z),
        handles: newHandles
      };
    });
    return { nodes: newNodes, edges: state.edges };
  }, []);

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.past.length === 0) return prev;
      const last = prev.past[prev.past.length - 1];
      const newPast = prev.past.slice(0, -1);
      const newFuture = [{ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }, ...prev.future];
      if (newFuture.length > 10) newFuture.pop();
      const hydrated = hydrateState(last);
      setNodes(hydrated.nodes);
      setEdges(hydrated.edges);
      return { past: newPast, future: newFuture };
    });
  }, [nodes, edges, hydrateState]);

  const redo = useCallback(() => {
    setHistory(prev => {
      if (prev.future.length === 0) return prev;
      const next = prev.future[0];
      const newFuture = prev.future.slice(1);
      const newPast = [...prev.past, { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) }];
      if (newPast.length > 10) newPast.shift();
      const hydrated = hydrateState(next);
      setNodes(hydrated.nodes);
      setEdges(hydrated.edges);
      return { past: newPast, future: newFuture };
    });
  }, [nodes, edges, hydrateState]);

  const snapVec = useCallback((v: THREE.Vector3) => useSnap ? new THREE.Vector3(Math.round(v.x / snapStep) * snapStep, Math.round(v.y / snapStep) * snapStep, Math.round(v.z / snapStep) * snapStep) : v, [useSnap, snapStep]);

  const addNode = useCallback((pos: THREE.Vector3) => {
    pushHistory(nodes, edges);
    const id = generateId("n");
    const newNode = { 
      id, 
      pos: pos.clone(), 
      handles: {}, 
      lane_l: defaultRoadSettings.lane_l, 
      lane_r: defaultRoadSettings.lane_r, 
      sw_l: defaultRoadSettings.sw_l, 
      sw_r: defaultRoadSettings.sw_r 
    };
    setNodes(prev => ({ ...prev, [id]: newNode }));
    return id;
  }, [nodes, edges, pushHistory, defaultRoadSettings]);

  const addEdge = useCallback((n1Id: string, n2Id: string) => {
    pushHistory(nodes, edges);
    const id = generateId("e");
    setEdges(prev => [...prev, { 
      id, 
      n1: n1Id, 
      n2: n2Id,
      resMode: defaultRoadSettings.resMode,
      resValue: defaultRoadSettings.resValue,
      alignment: defaultRoadSettings.alignment,
      tightTurnMode: defaultRoadSettings.tightTurnMode
    }]);
    
    setNodes(prev => {
      const node1 = prev[n1Id];
      const node2 = prev[n2Id];
      if (!node1 || !node2) return prev;
      const dir = node2.pos.clone().sub(node1.pos);
      const h1 = node1.pos.clone().add(dir.clone().multiplyScalar(0.33));
      const h2 = node1.pos.clone().add(dir.clone().multiplyScalar(0.66));
      return {
        ...prev,
        [n1Id]: { ...node1, handles: { ...node1.handles, [id]: h1 } },
        [n2Id]: { ...node2, handles: { ...node2.handles, [id]: h2 } }
      };
    });
    return id;
  }, [nodes, edges, pushHistory, defaultRoadSettings]);

  const handleSceneClick = useCallback((point: THREE.Vector3, targetNodeId?: string | null, targetEdgeId?: string | null) => {
    if (interactionMode !== 'CREATE') return;
    let targetId = targetNodeId;
    if (!targetId && targetEdgeId) {
        pushHistory(nodes, edges);
        const edge = edges.find(ed => ed.id === targetEdgeId)!;
        const nStartOrig = nodes[edge.n1];
        const nEndOrig = nodes[edge.n2];
        if (nStartOrig && nEndOrig) {
          const dirOrig = nEndOrig.pos.clone().sub(nStartOrig.pos);
          const h1Orig = nStartOrig.handles[edge.id] || nStartOrig.pos.clone().add(dirOrig.clone().multiplyScalar(0.33));
          const h2Orig = nEndOrig.handles[edge.id] || nStartOrig.pos.clone().add(dirOrig.clone().multiplyScalar(0.66));
          const curve = new THREE.CubicBezierCurve3(nStartOrig.pos, h1Orig, h2Orig, nEndOrig.pos);
          let t = 0.5;
          let minDist = Infinity;
          for (let i = 0; i <= 100; i++) {
            const testT = i / 100;
            const dist = curve.getPoint(testT).distanceTo(point);
            if (dist < minDist) { minDist = dist; t = testT; }
          }
          const p0 = nStartOrig.pos, p1 = h1Orig, p2 = h2Orig, p3 = nEndOrig.pos;
          const p01 = new THREE.Vector3().lerpVectors(p0, p1, t);
          const p12 = new THREE.Vector3().lerpVectors(p1, p2, t);
          const p23 = new THREE.Vector3().lerpVectors(p2, p3, t);
          const p012 = new THREE.Vector3().lerpVectors(p01, p12, t);
          const p123 = new THREE.Vector3().lerpVectors(p12, p23, t);
          const p0123 = new THREE.Vector3().lerpVectors(p012, p123, t);
          const midId = generateId("n");
          const nMid: NodeData = { 
            id: midId, pos: p0123, handles: {}, 
            lane_l: defaultRoadSettings.lane_l, lane_r: defaultRoadSettings.lane_r, 
            sw_l: defaultRoadSettings.sw_l, sw_r: defaultRoadSettings.sw_r 
          };
          targetId = midId;
          const e1Id = generateId("e");
          const e2Id = generateId("e");
          setEdges(prev => {
            const filtered = prev.filter(ed => ed.id !== targetEdgeId);
            return [...filtered, { ...edge, id: e1Id, n1: edge.n1, n2: targetId! }, { ...edge, id: e2Id, n1: targetId!, n2: edge.n2 }];
          });
          setNodes(prev => {
            const nStart = { ...prev[edge.n1] };
            const nEnd = { ...prev[edge.n2] };
            const nMidFinal: NodeData = { ...nMid };
            delete nStart.handles[edge.id];
            delete nEnd.handles[edge.id];
            nStart.handles[e1Id] = p01;
            nMidFinal.handles[e1Id] = p012;
            nMidFinal.handles[e2Id] = p123;
            nEnd.handles[e2Id] = p23;
            return { ...prev, [nStart.id]: nStart, [nEnd.id]: nEnd, [nMidFinal.id]: nMidFinal };
          });
        }
    } else if (!targetId) {
        targetId = addNode(point);
    }
    if (targetId) {
        if (activeChainStartId && activeChainStartId !== targetId) {
            addEdge(activeChainStartId, targetId);
        }
        setActiveChainStartId(targetId); 
        setSelectedNodeId(targetId);
        setSelectedEdgeId(null);
    }
  }, [interactionMode, activeChainStartId, edges, nodes, addNode, addEdge, pushHistory, defaultRoadSettings]);

  const handleImport = useCallback(async (type: 'pdf' | 'dxf') => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = type === 'pdf' ? '.pdf' : '.dxf';
    input.onchange = async (e: any) => {
      const file = e.target.files[0]; if (!file) return;
      try { const newLayer = type === 'pdf' ? await ImportLoaders.loadPDF(file) : await ImportLoaders.loadDXF(file); setLayers(prev => [...prev, newLayer]); } 
      catch (err) { alert("Import failed."); }
    };
    input.click();
  }, []);

  // --- MEMOS ---
  const minZ = useMemo(() => {
    const vals = Object.values(nodes).map(n => n.pos.z);
    return vals.length > 0 ? Math.min(0, ...vals) : 0;
  }, [nodes]);

  // --- EFFECTS ---
  useEffect(() => {
    const handleKD = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (e.key.toLowerCase() === 'w') setEditMode(p => p === 'MOVE_NODE' ? 'MOVE_BEZIER' : 'MOVE_NODE');
      if (e.key === 'ArrowUp') setAxisLock('z'); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setAxisLock('xy'); if (e.key === 'ArrowDown') setAxisLock('none');
      if (e.key === 'Escape') { setInteractionMode('SELECT'); setActiveChainStartId(null); }
    };
    window.addEventListener('keydown', handleKD); return () => window.removeEventListener('keydown', handleKD);
  }, [undo, redo]);

  // --- RETURN ---
  return {
    nodes, setNodes,
    edges, setEdges,
    undo, redo, pushHistory,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    selectedNodeId, setSelectedNodeId,
    selectedEdgeId, setSelectedEdgeId,
    hoveredNodeId, setHoveredNodeId,
    hoveredEdgeId, setHoveredEdgeId,
    interactionMode, setInteractionMode,
    editMode, setEditMode,
    axisLock, setAxisLock,
    useSnap, setUseSnap,
    snapStep, setSnapStep,
    isPerspective, setIsPerspective,
    showGrid, setShowGrid,
    showDebug, setShowDebug,
    shadowOffset, setShadowOffset,
    gridOffset, setGridOffset,
    axisOffset, setAxisOffset,
    defaultRoadSettings, setDefaultRoadSettings,
    layers, setLayers,
    activeChainStartId, setActiveChainStartId,
    mousePointer, setMousePointer,
    is90Snapped, setIs90Snapped,
    snapVec, minZ,
    addNode, addEdge, handleSceneClick, handleImport
  };
}
