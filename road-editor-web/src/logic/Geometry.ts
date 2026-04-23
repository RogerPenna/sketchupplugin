import * as THREE from 'three';

export interface NodeData {
  pos: THREE.Vector3;
  left_h: THREE.Vector3;
  right_h: THREE.Vector3;
  lane_l: number;
  lane_r: number;
  sw_l: number;
  sw_r: number;
  isCurved?: boolean; // Defines the segment leading into this node (from index-1 to index)
}

export interface PathPoint {
  pos: THREE.Vector3;
  ll: number;
  lr: number;
  sl: number;
  sr: number;
}

export interface EdgeData {
  center: THREE.Vector3;
  l_lane: THREE.Vector3;
  r_lane: THREE.Vector3;
  l_sw: THREE.Vector3;
  r_sw: THREE.Vector3;
}

export class RoadGeometry {
  static generateBezierPath(n1: NodeData, n2: NodeData, segments: number): PathPoint[] {
    const points: PathPoint[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const inv = 1.0 - t;
      
      const p = new THREE.Vector3(
        Math.pow(inv, 3) * n1.pos.x + 3 * Math.pow(inv, 2) * t * n1.right_h.x + 3 * inv * Math.pow(t, 2) * n2.left_h.x + Math.pow(t, 3) * n2.pos.x,
        Math.pow(inv, 3) * n1.pos.y + 3 * Math.pow(inv, 2) * t * n1.right_h.y + 3 * inv * Math.pow(t, 2) * n2.left_h.y + Math.pow(t, 3) * n2.pos.y,
        Math.pow(inv, 3) * n1.pos.z + 3 * Math.pow(inv, 2) * t * n1.right_h.z + 3 * inv * Math.pow(t, 2) * n2.left_h.z + Math.pow(t, 3) * n2.pos.z
      );

      points.push({
        pos: p,
        ll: n1.lane_l + (n2.lane_l - n1.lane_l) * t,
        lr: n1.lane_r + (n2.lane_r - n1.lane_r) * t,
        sl: n1.sw_l + (n2.sw_l - n1.sw_l) * t,
        sr: n1.sw_r + (n2.sw_r - n1.sw_r) * t
      });
    }
    return points;
  }

  static calculateAllEdges(allData: PathPoint[]): EdgeData[] {
    const edges: EdgeData[] = [];
    for (let i = 0; i < allData.length; i++) {
      const d = allData[i];
      const v1 = i > 0 ? d.pos.clone().sub(allData[i - 1].pos).normalize() : null;
      const v2 = i < allData.length - 1 ? allData[i + 1].pos.clone().sub(d.pos).normalize() : null;
      
      let dir: THREE.Vector3 | null = null;
      if (v1 && v2) {
        dir = v1.clone().add(v2).normalize();
      } else {
        dir = v1 || v2;
      }

      if (!dir) continue;

      // Cálculo Robusto para Z-up:
      // O vetor lateral (perp) é o produto vetorial da direção com o eixo UP (0,0,1).
      const up = new THREE.Vector3(0, 0, 1);
      const perp = new THREE.Vector3().crossVectors(dir, up).normalize();
      
      // Caso o caminho seja vertical, usamos um vetor alternativo para evitar produto nulo
      if (perp.length() < 0.001) {
        perp.set(1, 0, 0);
      }
      
      edges.push({
        center: d.pos,
        l_lane: d.pos.clone().add(perp.clone().multiplyScalar(d.ll)),
        r_lane: d.pos.clone().add(perp.clone().multiplyScalar(-d.lr)),
        l_sw: d.pos.clone().add(perp.clone().multiplyScalar(d.ll + d.sl)),
        r_sw: d.pos.clone().add(perp.clone().multiplyScalar(-(d.lr + d.sr)))
      });
    }
    return edges;
  }
}
