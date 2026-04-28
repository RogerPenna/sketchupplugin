import { useState, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { NodeData, EdgeData } from '../logic/Geometry';
import { ImportLoaders } from '../logic/ImportLoaders';
import type { LayerData } from '../logic/ImportLoaders';
import type { InteractionMode, EditMode, AxisLock } from '../types/editor';

export function useRoadEditor() {
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

  const snapVec = useCallback((v: THREE.Vector3) => useSnap ? new THREE.Vector3(Math.round(v.x / snapStep) * snapStep, Math.round(v.y / snapStep) * snapStep, Math.round(v.z / snapStep) * snapStep) : v, [useSnap, snapStep]);

  const minZ = useMemo(() => {
    const vals = Object.values(nodes).map(n => n.pos.z);
    return vals.length > 0 ? Math.min(0, ...vals) : 0;
  }, [nodes]);

  const generateId = (prefix: string) => prefix + Math.random().toString(36).substring(2, 7);

  const addNode = useCallback((pos: THREE.Vector3) => {
    const id = generateId("n");
    const newNode = { id, pos: pos.clone(), handles: {}, lane_l: 3.5, lane_r: 3.5, sw_l: 1.5, sw_r: 1.5 };
    setNodes(prev => ({ ...prev, [id]: newNode }));
    return id;
  }, []);

  const addEdge = useCallback((n1Id: string, n2Id: string) => {
    const id = generateId("e");
    setEdges(prev => [...prev, { id, n1: n1Id, n2: n2Id }]);
    
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
  }, []);

  const handleSceneClick = useCallback((point: THREE.Vector3, targetNodeId?: string | null, targetEdgeId?: string | null) => {
    if (interactionMode !== 'CREATE') return;
    
    let targetId = targetNodeId;
    
    if (!targetId && targetEdgeId) {
        const edge = edges.find(ed => ed.id === targetEdgeId)!;
        targetId = addNode(point);
        const e1Id = generateId("e");
        const e2Id = generateId("e");

        setEdges(prev => {
           const filtered = prev.filter(ed => ed.id !== targetEdgeId);
           return [...filtered, 
             { id: e1Id, n1: edge.n1, n2: targetId! }, 
             { id: e2Id, n1: targetId!, n2: edge.n2 }
           ];
        });

        setNodes(prev => {
          const nStart = prev[edge.n1], nMid = prev[targetId!], nEnd = prev[edge.n2];
          const d1 = nMid.pos.clone().sub(nStart.pos), d2 = nEnd.pos.clone().sub(nMid.pos);
          return {
            ...prev,
            [edge.n1]: { ...nStart, handles: { ...nStart.handles, [e1Id]: nStart.pos.clone().add(d1.clone().multiplyScalar(0.33)) } },
            [targetId!]: { ...nMid, handles: { 
              ...nMid.handles, 
              [e1Id]: nStart.pos.clone().add(d1.clone().multiplyScalar(0.66)),
              [e2Id]: nMid.pos.clone().add(d2.clone().multiplyScalar(0.33))
            } },
            [edge.n2]: { ...nEnd, handles: { ...nEnd.handles, [e2Id]: nMid.pos.clone().add(d2.clone().multiplyScalar(0.66)) } }
          };
        });
    }

    if (!targetId) {
        targetId = addNode(point);
    }
    
    if (activeChainStartId && activeChainStartId !== targetId) {
        addEdge(activeChainStartId, targetId);
    }
    
    setActiveChainStartId(targetId); 
    setSelectedNodeId(targetId);
    setSelectedEdgeId(null);
  }, [interactionMode, activeChainStartId, edges, addNode, addEdge]);

  const handleImport = async (type: 'pdf' | 'dxf') => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = type === 'pdf' ? '.pdf' : '.dxf';
    input.onchange = async (e: any) => {
      const file = e.target.files[0]; if (!file) return;
      try { const newLayer = type === 'pdf' ? await ImportLoaders.loadPDF(file) : await ImportLoaders.loadDXF(file); setLayers(prev => [...prev, newLayer]); } 
      catch (err) { alert("Import failed."); }
    };
    input.click();
  };

  useEffect(() => {
    const handleKD = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'w') setEditMode(p => p === 'MOVE_NODE' ? 'MOVE_BEZIER' : 'MOVE_NODE');
      if (e.key === 'ArrowUp') setAxisLock('z'); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') setAxisLock('xy'); if (e.key === 'ArrowDown') setAxisLock('none');
      if (e.key === 'Escape') { setInteractionMode('SELECT'); setActiveChainStartId(null); }
    };
    window.addEventListener('keydown', handleKD); return () => window.removeEventListener('keydown', handleKD);
  }, []);

  return {
    nodes, setNodes,
    edges, setEdges,
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
    layers, setLayers,
    activeChainStartId, setActiveChainStartId,
    mousePointer, setMousePointer,
    is90Snapped, setIs90Snapped,
    snapVec, minZ,
    addNode, addEdge, handleSceneClick, handleImport
  };
}
