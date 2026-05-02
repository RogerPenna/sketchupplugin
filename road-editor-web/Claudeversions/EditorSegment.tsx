import { useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { RoadGeometry } from '../logic/Geometry'
import type { NodeData, EdgeData, JunctionInfo, NeighborInfo } from '../logic/Geometry'
import type { InteractionMode } from '../types/editor'

// ---------------------------------------------------------------------------
// Helper: get the tangent of an edge AT a given node, pointing AWAY from that node.
// This mirrors how EditorSegment computes its own curve but we only need the
// tangent at t=0 or t=1 (the endpoint touching `nodeId`).
// ---------------------------------------------------------------------------
function getEdgeTangentAtNode(
  edge: EdgeData,
  nodeId: string,
  nodesMap: Record<string, NodeData>
): THREE.Vector3 | null {
  const nA = nodesMap[edge.n1];
  const nB = nodesMap[edge.n2];
  if (!nA || !nB) return null;

  const isStart = edge.n1 === nodeId; // nodeId is n1 of this edge → we want tangent at t=0

  const h1 = nA.handles[edge.id] ?? nA.pos.clone().add(nB.pos.clone().sub(nA.pos).multiplyScalar(0.33));
  const h2 = nB.handles[edge.id] ?? nA.pos.clone().add(nB.pos.clone().sub(nA.pos).multiplyScalar(0.66));

  // Cubic Bezier tangent:
  //   t=0: 3*(h1 - p0)
  //   t=1: 3*(p3 - h2)
  let tangent: THREE.Vector3;
  if (isStart) {
    tangent = h1.clone().sub(nA.pos); // direction leaving nA toward h1
  } else {
    tangent = nB.pos.clone().sub(h2); // direction leaving nB away from h2
  }

  if (tangent.length() < 0.0001) {
    // Degenerate handle — fall back to chord direction
    tangent = isStart
      ? nB.pos.clone().sub(nA.pos)
      : nA.pos.clone().sub(nB.pos);
  }

  return tangent.normalize();
}

// ---------------------------------------------------------------------------
// Build JunctionInfo for our edge given all edges in the scene.
// ---------------------------------------------------------------------------
function buildJunctionInfo(
  edge: EdgeData,
  allEdges: EdgeData[],
  nodesMap: Record<string, NodeData>
): JunctionInfo {
  const buildNeighbors = (nodeId: string): NeighborInfo[] | null => {
    // All edges that touch this node EXCEPT our own edge
    const neighborEdges = allEdges.filter(
      e => e.id !== edge.id && (e.n1 === nodeId || e.n2 === nodeId)
    );
    if (neighborEdges.length === 0) return null;

    const infos: NeighborInfo[] = [];
    for (const nb of neighborEdges) {
      const tangent = getEdgeTangentAtNode(nb, nodeId, nodesMap);
      if (tangent) infos.push({ tangentAway: tangent });
    }
    return infos.length > 0 ? infos : null;
  };

  return {
    n1Neighbors: buildNeighbors(edge.n1),
    n2Neighbors: buildNeighbors(edge.n2),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function EditorSegment({
  edge,
  nodesMap,
  allEdges,
  isSelected,
  isHovered,
  onSelect,
  onSceneClick,
  interactionMode,
}: {
  edge: EdgeData;
  nodesMap: Record<string, NodeData>;
  allEdges: EdgeData[]; // NEW: full edge list so we can find neighbors
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onSceneClick: (p: THREE.Vector3, nodeId?: string, edgeId?: string) => void;
  interactionMode: InteractionMode;
}) {
  const n1 = nodesMap[edge.n1], n2 = nodesMap[edge.n2];
  if (!n1 || !n2) return null;
  const h1 = n1.handles[edge.id] || n1.pos.clone().add(n2.pos.clone().sub(n1.pos).multiplyScalar(0.33));
  const h2 = n2.handles[edge.id] || n1.pos.clone().add(n2.pos.clone().sub(n1.pos).multiplyScalar(0.66));
  
  const curve = useMemo(() => new THREE.CubicBezierCurve3(n1.pos, h1, h2, n2.pos), [n1.pos, h1, h2, n2.pos]);
  
  const autoResolution = useMemo(() => {
    const v1 = h1.clone().sub(n1.pos).normalize();
    const v2 = n2.pos.clone().sub(h2).normalize();
    const vMain = n2.pos.clone().sub(n1.pos).normalize();
    const dot1 = Math.abs(v1.dot(vMain));
    const dot2 = Math.abs(v2.dot(vMain));
    if (dot1 > 0.999 && dot2 > 0.999) return 1;
    const angle = v1.angleTo(v2) * (180 / Math.PI);
    return Math.max(2, Math.ceil(angle / 10));
  }, [n1.pos, h1, h2, n2.pos]);

  const resolution = edge.resolution || autoResolution;
  const points = useMemo(() => curve.getPoints(resolution), [curve, resolution]);
  const length = useMemo(() => curve.getLength(), [curve]);
  const angle = useMemo(() => {
    const dir = n2.pos.clone().sub(n1.pos).setZ(0).normalize();
    const ang = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
    return ang < 0 ? ang + 360 : ang;
  }, [n1.pos, n2.pos]);

  // Build a stable cache key for neighbors so useMemo recomputes when topology changes
  const neighborKey = useMemo(() => {
    const n1Neighbors = allEdges
      .filter(e => e.id !== edge.id && (e.n1 === edge.n1 || e.n2 === edge.n1))
      .map(e => e.id)
      .sort()
      .join(',');
    const n2Neighbors = allEdges
      .filter(e => e.id !== edge.id && (e.n1 === edge.n2 || e.n2 === edge.n2))
      .map(e => e.id)
      .sort()
      .join(',');
    return `${n1Neighbors}|${n2Neighbors}`;
  }, [allEdges, edge.id, edge.n1, edge.n2]);

  const roadGeometry = useMemo(() => {
    const pathPoints = RoadGeometry.generateBezierPath(n1, n2, edge.id, resolution, edge);

    // Build junction info so geometry can clip ends to meet neighbors cleanly
    const junctionInfo = buildJunctionInfo(edge, allEdges, nodesMap);

    const edgesArr = RoadGeometry.calculateAllEdges(
      pathPoints.map(p => ({
        pos: p.pos, ll: p.ll, lr: p.lr, sl: p.sl, sr: p.sr,
        tightTurnMode: p.tightTurnMode,
        alignment: p.alignment,
      })) as any,
      junctionInfo,
      n1.pos,
      n2.pos
    );

    const parts = {
      laneL: { v: [] as number[], i: [] as number[], li: [] as number[], c: [] as number[] },
      laneR: { v: [] as number[], i: [] as number[], li: [] as number[], c: [] as number[] },
      swL: { v: [] as number[], i: [] as number[], li: [] as number[], c: [] as number[] },
      swR: { v: [] as number[], i: [] as number[], li: [] as number[], c: [] as number[] }
    };

    const addQ = (
      p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3,
      target: { v: number[], i: number[], li: number[], c: number[] },
      baseColor: THREE.Color,
      shading: number
    ) => {
      const off = target.v.length / 3; 
      target.v.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z); 
      target.i.push(off, off + 1, off + 2, off, off + 2, off + 3);
      target.li.push(off, off + 1, off + 1, off + 2, off + 2, off + 3, off + 3, off);
      const c = baseColor.clone().multiplyScalar(shading);
      for (let i = 0; i < 4; i++) target.c.push(c.r, c.g, c.b);
    };

    for (let j = 0; j < edgesArr.length - 1; j++) { 
      const e1 = edgesArr[j], e2 = edgesArr[j+1]; 
      
      const dir = e2.center.clone().sub(e1.center).normalize();
      const slope = Math.abs(dir.z);
      const shading = 1.0 - (slope * 0.6);

      addQ(e1.center, e1.l_lane, e2.l_lane, e2.center, parts.laneL, new THREE.Color(isSelected ? "#add8e6" : "#ccc"), shading);
      addQ(e1.center, e2.center, e2.r_lane, e1.r_lane, parts.laneR, new THREE.Color(isSelected ? "#b0e0e6" : "#d0d0d0"), shading);
      addQ(e1.l_lane, e1.l_sw, e2.l_sw, e2.l_lane, parts.swL, new THREE.Color(isSelected ? "#c0e8f0" : "#ddd"), shading);
      addQ(e1.r_lane, e2.r_lane, e2.r_sw, e1.r_sw, parts.swR, new THREE.Color(isSelected ? "#c8edf4" : "#e5e5e5"), shading);
    }

    const createG = (v: number[], idx: number[], lIdx: number[], c: number[]) => { 
      const g = new THREE.BufferGeometry(); 
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); 
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.setIndex(idx); 
      g.computeVertexNormals(); 
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      lg.setIndex(lIdx);
      return { fill: g, wire: lg }; 
    };

    return { 
      laneL: createG(parts.laneL.v, parts.laneL.i, parts.laneL.li, parts.laneL.c),
      laneR: createG(parts.laneR.v, parts.laneR.i, parts.laneR.li, parts.laneR.c),
      swL: createG(parts.swL.v, parts.swL.i, parts.swL.li, parts.swL.c),
      swR: createG(parts.swR.v, parts.swR.i, parts.swR.li, parts.swR.c)
    };
  }, [
    n1.pos, n2.pos, n1.handles, n2.handles,
    n1.lane_l, n1.lane_r, n1.sw_l, n1.sw_r,
    n2.lane_l, n2.lane_r, n2.sw_l, n2.sw_r,
    edge.id, resolution, edge.resMode, edge.resValue, isSelected,
    neighborKey, // recompute when junction topology changes
  ]);

  return (
    <group renderOrder={5} userData={{ edgeId: edge.id }}>
      <Line points={[n1.pos, n2.pos]} color={isHovered ? "orange" : "#999"} lineWidth={isHovered ? 4 : 2} transparent opacity={0.3} depthTest={false} />
      <Line points={points} color={isSelected ? "#00ffff" : "#444"} lineWidth={isSelected ? 5 : 2} depthTest={false} />
      
      {[
        { data: roadGeometry.laneL, offset: 1 },
        { data: roadGeometry.laneR, offset: 1 },
        { data: roadGeometry.swL, offset: 2 },
        { data: roadGeometry.swR, offset: 2 }
      ].map((part, idx) => (
        <group key={idx}>
          <mesh geometry={part.data.fill} castShadow>
            <meshLambertMaterial vertexColors side={THREE.DoubleSide} polygonOffset={true} polygonOffsetFactor={part.offset} polygonOffsetUnits={part.offset} />
          </mesh>
          <lineSegments geometry={part.data.wire}>
            <lineBasicMaterial color={isSelected ? "#005577" : "#777"} transparent opacity={0.8} depthTest={true} />
          </lineSegments>
        </group>
      ))}
      
      {(isSelected || isHovered) && (
        <Html position={n1.pos.clone().lerp(n2.pos, 0.5)}>
          <div style={{ background: 'rgba(0,0,0,0.7)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {length.toFixed(2)}m | {angle.toFixed(1)}°
          </div>
        </Html>
      )}

      <mesh
        position={n1.pos.clone().lerp(n2.pos, 0.5)}
        quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), n2.pos.clone().sub(n1.pos).normalize())}
        onClick={(e) => { 
          if (interactionMode === 'SELECT') {
            e.stopPropagation(); 
            onSelect(); 
          } else if (interactionMode === 'CREATE') {
            e.stopPropagation();
            onSceneClick(e.point, undefined, edge.id);
          }
        }}
        onPointerDown={(e) => {
          if (interactionMode === 'SELECT' || interactionMode === 'CREATE') e.stopPropagation();
        }}
      >
        <cylinderGeometry args={[0.8, 0.8, n1.pos.distanceTo(n2.pos) * 0.9, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
