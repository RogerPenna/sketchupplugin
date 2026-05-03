import { useMemo } from 'react'
import * as THREE from 'three'
import { RoadGeometry } from '../logic/Geometry'
import type { NodeData, EdgeData } from '../logic/Geometry'

export function EditorJunction({
  node,
  allEdges,
  nodesMap,
  showDebug,
}: {
  node: NodeData;
  allEdges: EdgeData[];
  nodesMap: Record<string, NodeData>;
  showDebug?: boolean;
}) {
  const junctionData = useMemo(() => {
    const connectedEdges = allEdges.filter(e => e.n1 === node.id || e.n2 === node.id);
    if (connectedEdges.length < 2) return null;

    interface RoadSlice {
      edgeId: string;
      l_sw: THREE.Vector3;
      l_lane: THREE.Vector3;
      r_lane: THREE.Vector3;
      r_sw: THREE.Vector3;
      angle: number;
    }

    const slices: RoadSlice[] = [];

    connectedEdges.forEach(edge => {
      const isStart = edge.n1 === node.id;
      const trim = RoadGeometry.calculateTrim(edge, allEdges, nodesMap);
      
      const n1 = nodesMap[edge.n1], n2 = nodesMap[edge.n2];
      const pathPoints = RoadGeometry.generateBezierPath(n1, n2, edge.id, 24, edge);
      const t = isStart ? trim.tStart : trim.tEnd;
      const allEdgesData = RoadGeometry.calculateAllEdges(pathPoints, n1, n2, edge.id, t, t);
      
      if (allEdgesData.length > 0) {
        const s = allEdgesData[0];
        // Calcular ângulo médio da estrada para ordenação radial
        const dir = isStart 
          ? nodesMap[edge.n2].pos.clone().sub(node.pos).normalize()
          : nodesMap[edge.n1].pos.clone().sub(node.pos).normalize();
        const angle = Math.atan2(dir.y, dir.x);

        slices.push({
          edgeId: edge.id,
          l_sw: s.l_sw,
          l_lane: s.l_lane,
          r_lane: s.r_lane,
          r_sw: s.r_sw,
          angle: angle
        });
      }
    });

    if (slices.length === 0) return null;

    // Ordenar estradas circularmente (sentido horário)
    slices.sort((a, b) => a.angle - b.angle);

    const laneVertices: number[] = [];
    const laneIndices: number[] = [];
    const swVertices: number[] = [];
    const swIndices: number[] = [];

    const center = node.pos.clone();
    laneVertices.push(center.x, center.y, center.z); // Center point at index 0

    // 1. Gerar Pista Central (Lanes)
    // Conecta todos os l_lane e r_lane de todas as estradas ao centro do nó
    let vIdx = 1;
    slices.forEach((s) => {
      // Adicionar r_lane e l_lane (nessa ordem para manter orientação horária/anti-horária consistente)
      laneVertices.push(s.r_lane.x, s.r_lane.y, s.r_lane.z);
      laneVertices.push(s.l_lane.x, s.l_lane.y, s.l_lane.z);
      
      laneIndices.push(0, vIdx, vIdx + 1);
      vIdx += 2;
    });

    // Fechar os triângulos entre as estradas (pistas)
    for (let i = 0; i < slices.length; i++) {
      const currL = (i * 2) + 2;
      const nextR = ((i + 1) % slices.length) * 2 + 1;
      laneIndices.push(0, currL, nextR);
    }

    // 2. Gerar "Cunhas" de Calçada (Sidewalk Wedges)
    // Preenche o espaço entre o l_sw de uma estrada e o r_sw da próxima
    slices.forEach((s, i) => {
      const nextS = slices[(i + 1) % slices.length];
      
      const off = swVertices.length / 3;
      // Quadrilátero/Triângulo que fecha a calçada: [l_lane, l_sw, next.r_sw, next.r_lane]
      swVertices.push(s.l_lane.x, s.l_lane.y, s.l_lane.z);
      swVertices.push(s.l_sw.x, s.l_sw.y, s.l_sw.z);
      swVertices.push(nextS.r_sw.x, nextS.r_sw.y, nextS.r_sw.z);
      swVertices.push(nextS.r_lane.x, nextS.r_lane.y, nextS.r_lane.z);

      // Dois triângulos para o quad
      swIndices.push(off, off + 1, off + 2);
      swIndices.push(off, off + 2, off + 3);
    });

    const createG = (v: number[], idx: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };

    return {
      lane: createG(laneVertices, laneIndices),
      sw: createG(swVertices, swIndices)
    };
  }, [node, allEdges, nodesMap]);

  if (!junctionData) return null;

  return (
    <group renderOrder={4}>
      {/* Pista Central */}
      <mesh geometry={junctionData.lane}>
        <meshLambertMaterial color="#ccc" side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={3} />
      </mesh>
      
      {/* Calçadas de Conexão */}
      <mesh geometry={junctionData.sw}>
        <meshLambertMaterial color="#ddd" side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={3.1} />
      </mesh>

      {/* Wireframe de Debug */}
      {showDebug && (
        <lineSegments>
          <edgesGeometry attach="geometry" args={[junctionData.lane]} />
          <lineBasicMaterial color="#999" transparent opacity={0.2} />
        </lineSegments>
      )}
    </group>
  );
}
