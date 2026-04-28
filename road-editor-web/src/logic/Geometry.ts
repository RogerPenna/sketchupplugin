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
  resolution?: number; // Deprecated but kept for compatibility
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
    
    const mode = edge?.resMode || 'FIXED';
    const val = edge?.resValue || (edge?.resolution || segments);

    const createPP = (t: number): PathPoint => ({
      pos: curve.getPoint(t),
      ll: n1.lane_l + (n2.lane_l - n1.lane_l) * t,
      lr: n1.lane_r + (n2.lane_r - n1.lane_r) * t,
      sl: n1.sw_l + (n2.sw_l - n1.sw_l) * t,
      sr: n1.sw_r + (n2.sw_r - n1.sw_r) * t
    });

    if (mode === 'ANGLE') {
      // ADAPTIVE ANGLE SAMPLING
      points.push(createPP(0));
      let lastTangent = curve.getTangent(0).normalize();
      const samples = 200; // High resolution sampling to find inflection points
      const threshold = val || 10;
      
      let accumulatedAngle = 0;
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const currentTangent = curve.getTangent(t).normalize();
        const deltaAngle = lastTangent.angleTo(currentTangent) * (180 / Math.PI);
        accumulatedAngle += deltaAngle;

        if (accumulatedAngle >= threshold || i === samples) {
          points.push(createPP(t));
          lastTangent = currentTangent;
          accumulatedAngle = 0;
        }
      }
    } else {
      // UNIFORM DISTANCE SAMPLING for FIXED and LENGTH
      const divisionCount = mode === 'LENGTH' 
        ? Math.max(1, Math.ceil(curve.getLength() / (val || 1)))
        : Math.round(val || 24);

      for (let i = 0; i <= divisionCount; i++) {
        const u = i / divisionCount;
        const t = curve.getUtoTmapping(u);
        points.push(createPP(t));
      }
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
