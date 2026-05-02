import { useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { RoadGeometry } from '../logic/Geometry'
import type { NodeData, EdgeData } from '../logic/Geometry'
import type { InteractionMode } from '../types/editor'

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
  showDebug,
}: {
  edge: EdgeData;
  nodesMap: Record<string, NodeData>;
  allEdges: EdgeData[]; // NEW: full edge list so we can find neighbors
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onSceneClick: (p: THREE.Vector3, nodeId?: string, edgeId?: string) => void;
  interactionMode: InteractionMode;
  showDebug?: boolean;
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

  const roadGeometry = useMemo(() => {
    // 1. Gerar o caminho completo do Bézier
    const pathPoints = RoadGeometry.generateBezierPath(n1, n2, edge.id, resolution, edge);

    // 2. Calcular os parâmetros de recorte (trimming) baseados em colisões
    const trim = RoadGeometry.calculateTrim(edge, allEdges, nodesMap);

    // 3. Gerar as arestas finais apenas para a janela visível [tStart, tEnd]
    const activeEdges = RoadGeometry.calculateAllEdges(pathPoints, trim.tStart, trim.tEnd);
    
    // 4. Gerar arestas fantasma (trimmed parts)
    const ghostStartEdges = trim.tStart > 0.001 ? RoadGeometry.calculateAllEdges(pathPoints, 0, trim.tStart) : [];
    const ghostEndEdges = trim.tEnd < 0.999 ? RoadGeometry.calculateAllEdges(pathPoints, trim.tEnd, 1) : [];

    const createParts = (edgesArr: any[], isGhost: boolean) => {
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

        let colorLaneStr = isSelected ? "#add8e6" : (trim.error ? "#ffcccc" : "#ccc");
        let colorSWStr = isSelected ? "#c0e8f0" : (trim.error ? "#ffe0e0" : "#ddd");

        if (isGhost) {
          colorLaneStr = "#3366ff"; // Azulado para fantasmas
          colorSWStr = "#6699ff";
        }

        addQ(e1.center, e1.l_lane, e2.l_lane, e2.center, parts.laneL, new THREE.Color(colorLaneStr), shading);
        addQ(e1.center, e2.center, e2.r_lane, e1.r_lane, parts.laneR, new THREE.Color(colorLaneStr), shading);
        addQ(e1.l_lane, e1.l_sw, e2.l_sw, e2.l_lane, parts.swL, new THREE.Color(colorSWStr), shading);
        addQ(e1.r_lane, e2.r_lane, e2.r_sw, e1.r_sw, parts.swR, new THREE.Color(colorSWStr), shading);
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
        swR: createG(parts.swR.v, parts.swR.i, parts.swR.li, parts.swR.c),
      };
    };

    return { 
      active: createParts(activeEdges, false),
      ghostStart: ghostStartEdges.length > 0 ? createParts(ghostStartEdges, true) : null,
      ghostEnd: ghostEndEdges.length > 0 ? createParts(ghostEndEdges, true) : null,
      trimError: trim.error,
      collisionPoints: [trim.startPoint, trim.endPoint].filter(Boolean) as THREE.Vector3[],
      debugRails: trim.debugRails || []
    };
  }, [
    n1.pos, n2.pos, n1.handles, n2.handles,
    n1.lane_l, n1.lane_r, n1.sw_l, n1.sw_r,
    n2.lane_l, n2.lane_r, n2.sw_l, n2.sw_r,
    edge.id, resolution, edge.resMode, edge.resValue, isSelected,
    allEdges, nodesMap
  ]);

  return (
    <group renderOrder={5} userData={{ edgeId: edge.id }}>
      {/* Indicador de Erro Geométrico */}
      {roadGeometry.trimError && (
        <Html position={n1.pos.clone().lerp(n2.pos, 0.5)}>
          <div style={{ background: 'red', color: 'white', padding: '4px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
            ⚠️ {roadGeometry.trimError}
          </div>
        </Html>
      )}

      {/* Pontos de Colisão Debug (Yellow Spheres) */}
      {showDebug && roadGeometry.collisionPoints.map((p, idx) => (
        <mesh key={idx} position={p.clone().add(new THREE.Vector3(0, 0, 0.2))}>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshBasicMaterial color="yellow" depthTest={false} transparent opacity={0.9} />
        </mesh>
      ))}

      {/* Trilhos de Colisão Debug (Thin Red Lines) */}
      {showDebug && roadGeometry.debugRails.map((rail, rIdx) => (
        <Line key={rIdx} points={rail.map(p => p.clone().add(new THREE.Vector3(0,0,0.15)))} color="red" lineWidth={1.5} transparent opacity={0.6} depthTest={false} />
      ))}

      <mesh position={n1.pos.clone().lerp(n2.pos, 0.5)} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), n2.pos.clone().sub(n1.pos).normalize())} 
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
        }}>
        <cylinderGeometry args={[0.8, 0.8, n1.pos.distanceTo(n2.pos) * 0.9, 8]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>

      <Line points={[n1.pos, n2.pos]} color={isHovered ? "orange" : "#999"} lineWidth={isHovered ? 4 : 2} transparent opacity={0.3} depthTest={false} />
      <Line points={points} color={isSelected ? "#00ffff" : "#444"} lineWidth={isSelected ? 5 : 2} depthTest={false} />
      
      {/* Renderização da Estrada Ativa */}
      {[
        { data: roadGeometry.active.laneL, offset: 1 },
        { data: roadGeometry.active.laneR, offset: 1 },
        { data: roadGeometry.active.swL, offset: 2 },
        { data: roadGeometry.active.swR, offset: 2 }
      ].map((part, idx) => (
        <group key={`active-${idx}`}>
          <mesh geometry={part.data.fill} castShadow>
            <meshLambertMaterial vertexColors side={THREE.DoubleSide} polygonOffset={true} polygonOffsetFactor={part.offset} polygonOffsetUnits={part.offset} />
          </mesh>
          <lineSegments geometry={part.data.wire}>
            <lineBasicMaterial color={isSelected ? "#005577" : "#777"} transparent opacity={0.8} depthTest={true} />
          </lineSegments>
        </group>
      ))}

      {/* Renderização das Partes Fantasmas (Ghosts) */}
      {showDebug && [roadGeometry.ghostStart, roadGeometry.ghostEnd].filter(Boolean).map((ghost, gIdx) => (
        <group key={`ghost-${gIdx}`}>
          {[ghost!.laneL, ghost!.laneR, ghost!.swL, ghost!.swR].map((data, pIdx) => (
            <mesh key={`p-${pIdx}`} geometry={data.fill}>
              <meshLambertMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.3} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
      
      {(isSelected || isHovered) && (
        <Html position={n1.pos.clone().lerp(n2.pos, 0.5)}>
          <div style={{ background: 'rgba(0,0,0,0.7)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {length.toFixed(2)}m | {angle.toFixed(1)}°
          </div>
        </Html>
      )}
    </group>
  );
}
