import { useMemo } from 'react'
import * as THREE from 'three'
import { RoadGeometry } from '../logic/Geometry'
import type { NodeData, EdgeData } from '../logic/Geometry'

interface RoadProps {
  nodes: NodeData[];
}

export function Road({ nodes }: RoadProps) {
  const { roadMesh, swMesh } = useMemo(() => {
    if (nodes.length < 2) return { roadMesh: null, swMesh: null };

    const allData = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const segment = RoadGeometry.generateBezierPath(nodes[i], nodes[i + 1], 24);
      // Remove last point to avoid duplicates, except for the last segment
      if (i < nodes.length - 2) {
        allData.push(...segment.slice(0, -1));
      } else {
        allData.push(...segment);
      }
    }

    const edges = RoadGeometry.calculateAllEdges(allData);
    
    const roadVertices: number[] = [];
    const roadIndices: number[] = [];
    const swVertices: number[] = [];
    const swIndices: number[] = [];

    for (let i = 0; i < edges.length - 1; i++) {
      const e1 = edges[i];
      const e2 = edges[i + 1];

      // Helper to add quad (2 triangles)
      const addQuad = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3, targetVerts: number[], targetIndices: number[]) => {
        const offset = targetVerts.length / 3;
        targetVerts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
        targetIndices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      };

      // Road Lanes (Left and Right)
      addQuad(e1.center, e1.l_lane, e2.l_lane, e2.center, roadVertices, roadIndices);
      addQuad(e1.center, e2.center, e2.r_lane, e1.r_lane, roadVertices, roadIndices);

      // Sidewalks
      addQuad(e1.l_lane, e1.l_sw, e2.l_sw, e2.l_lane, swVertices, swIndices);
      addQuad(e1.r_lane, e2.r_lane, e2.r_sw, e1.r_sw, swVertices, swIndices);
    }

    const createBufferGeo = (verts: number[], indices: number[]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    return {
      roadMesh: createBufferGeo(roadVertices, roadIndices),
      swMesh: createBufferGeo(swVertices, swIndices)
    };
  }, [nodes]);

  if (!roadMesh || !swMesh) return null;

  return (
    <group>
      <mesh geometry={roadMesh}>
        <meshStandardMaterial color="#bbb" side={THREE.DoubleSide} polygonOffset depthTest />
      </mesh>
      <mesh geometry={swMesh}>
        <meshStandardMaterial color="#ddd" side={THREE.DoubleSide} polygonOffset depthTest />
      </mesh>
    </group>
  );
}
