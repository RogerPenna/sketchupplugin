import * as THREE from 'three';

export type ResolutionMode = 'FIXED' | 'LENGTH' | 'ANGLE';

export interface NodeData {
  id: string;
  pos: THREE.Vector3;
  handles: Record<string, THREE.Vector3>; // Mapeado por ID da estrada (Edge ID)
  lane_l: number;
  lane_r: number;
  sw_l: number;
  sw_r: number;
}

export interface EdgeData {
  id: string;
  n1: string; // ID do nó inicial
  n2: string; // ID do nó final
  resMode?: ResolutionMode;
  resValue?: number;
  resolution?: number; // Deprecated but kept for compatibility during migration
}

export interface PathPoint {
  pos: THREE.Vector3;
  ll: number;
  lr: number;
  sl: number;
  sr: number;
}

export class RoadGeometry {
  static generateBezierPath(n1: NodeData, n2: NodeData, edgeId: string, segments: number, edge?: EdgeData): PathPoint[] {
    const points: PathPoint[] = [];
    const dir = n2.pos.clone().sub(n1.pos);
    const h1 = n1.handles[edgeId] || n1.pos.clone().add(dir.clone().multiplyScalar(0.33));
    const h2 = n2.handles[edgeId] || n1.pos.clone().add(dir.clone().multiplyScalar(0.66));

    const curve = new THREE.CubicBezierCurve3(n1.pos, h1, h2, n2.pos);
    
    let divisionCount = segments;
    const mode = edge?.resMode || 'FIXED';
    const val = edge?.resValue || (edge?.resolution || segments);

    if (mode === 'FIXED') {
      divisionCount = val;
    } else if (mode === 'LENGTH') {
      const length = curve.getLength();
      divisionCount = Math.max(1, Math.ceil(length / (val || 1)));
    } else if (mode === 'ANGLE') {
      // Sample the curve to check angular changes
      const samples = 100;
      let totalAngle = 0;
      let lastDir = curve.getTangent(0).normalize();
      for (let i = 1; i <= samples; i++) {
        const currentDir = curve.getTangent(i / samples).normalize();
        totalAngle += lastDir.angleTo(currentDir);
        lastDir = currentDir;
      }
      const totalDegrees = totalAngle * (180 / Math.PI);
      divisionCount = Math.max(1, Math.ceil(totalDegrees / (val || 10)));
    }

    for (let i = 0; i <= divisionCount; i++) {
      const t = i / divisionCount;
      const p = curve.getPoint(t);

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

  static calculateAllEdges(allData: PathPoint[]): any[] {
    const edges: any[] = [];
    for (let i = 0; i < allData.length; i++) {
      const d = allData[i];
      const v1 = i > 0 ? d.pos.clone().sub(allData[i - 1].pos).normalize() : null;
      const v2 = i < allData.length - 1 ? allData[i + 1].pos.clone().sub(d.pos).normalize() : null;
      let dir = v1 && v2 ? v1.clone().add(v2).normalize() : (v1 || v2);
      if (!dir) continue;
      const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
      if (perp.length() < 0.001) perp.set(1, 0, 0);
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
