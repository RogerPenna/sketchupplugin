import * as THREE from 'three';

export type ResolutionMode = 'FIXED' | 'LENGTH' | 'ANGLE' | 'ERROR';

export interface NodeData {
  id: string;
  pos: THREE.Vector3;
  handles: Record<string, THREE.Vector3>; // Mapeado por ID da estrada (Edge ID)
  lane_l: number;
  lane_r: number;
  sw_l: number;
  sw_r: number;
}

export type Alignment = 'CENTER' | 'LEFT' | 'RIGHT';

export interface EdgeData {
  id: string;
  n1: string; // ID do nó inicial
  n2: string; // ID do nó final
  resMode?: ResolutionMode;
  resValue?: number;
  resolution?: number; // Deprecated
  tightTurnMode?: 'APEX' | 'CLEAN';
  alignment?: Alignment;
  n1Anchor?: Alignment;
  n2Anchor?: Alignment;
}

export interface PathPoint {
  pos: THREE.Vector3;
  ll: number;
  lr: number;
  sl: number;
  sr: number;
  tightTurnMode?: 'APEX' | 'CLEAN';
  alignment?: 'CENTER' | 'LEFT' | 'RIGHT';
}

export class RoadGeometry {
  static getBezierNodePoint(node: NodeData, edgeId: string, isStart: boolean, edge?: EdgeData): THREE.Vector3 {
    const align = edge?.alignment || 'CENTER';
    const anchor = (isStart ? edge?.n1Anchor : edge?.n2Anchor) || align;
    
    if (anchor === align && anchor === 'CENTER') return node.pos.clone();

    // To calculate perp, we need the direction. We use the handle.
    const handle = node.handles[edgeId];
    if (!handle) return node.pos.clone();

    const dir = isStart 
      ? handle.clone().sub(node.pos).normalize() 
      : node.pos.clone().sub(handle).normalize();
    
    const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
    
    const wl = node.lane_l + node.sw_l;
    const wr = node.lane_r + node.sw_r;
    
    let shift = 0;
    if (align === 'LEFT') shift = -wl;
    else if (align === 'RIGHT') shift = wr;

    let anchorShift = shift;
    if (anchor === 'LEFT') anchorShift = shift + wl;
    else if (anchor === 'RIGHT') anchorShift = shift - wr;
    else anchorShift = shift; // anchor === 'CENTER' is the baseline for shift

    // We want the point on the road corresponding to 'anchor' to be at node.pos.
    // AnchorPoint = BezierPoint + perp * anchorShift
    // So BezierPoint = node.pos - perp * anchorShift
    return node.pos.clone().sub(perp.multiplyScalar(anchorShift));
  }

  static generateBezierPath(n1: NodeData, n2: NodeData, edgeId: string, segments: number, edge?: EdgeData): PathPoint[] {
    const points: PathPoint[] = [];
    
    const p1 = this.getBezierNodePoint(n1, edgeId, true, edge);
    const p2 = this.getBezierNodePoint(n2, edgeId, false, edge);
    
    const h1 = n1.handles[edgeId] || n1.pos.clone().add(n2.pos.clone().sub(n1.pos).multiplyScalar(0.33));
    const h2 = n2.handles[edgeId] || n1.pos.clone().add(p2.clone().sub(p1).multiplyScalar(0.66));

    const curve = new THREE.CubicBezierCurve3(p1, h1, h2, p2);
    
    const mode = edge?.resMode || 'FIXED';
    const val = edge?.resValue || (edge?.resolution || segments);

    const createPP = (t: number): PathPoint => ({
      pos: curve.getPoint(t),
      ll: n1.lane_l + (n2.lane_l - n1.lane_l) * t,
      lr: n1.lane_r + (n2.lane_r - n1.lane_r) * t,
      sl: n1.sw_l + (n2.sw_l - n1.sw_l) * t,
      sr: n1.sw_r + (n2.sw_r - n1.sw_r) * t,
      tightTurnMode: edge?.tightTurnMode || 'APEX',
      alignment: edge?.alignment || 'CENTER'
    });

    if (mode === 'ANGLE') {
      points.push(createPP(0));
      let lastTangent = curve.getTangent(0).normalize();
      const samples = 200;
      const threshold = val || 10;
      let accumulatedAngle = 0;
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const currentTangent = curve.getTangent(t).normalize();
        accumulatedAngle += lastTangent.angleTo(currentTangent) * (180 / Math.PI);
        if (accumulatedAngle >= threshold || i === samples) {
          points.push(createPP(t));
          lastTangent = currentTangent;
          accumulatedAngle = 0;
        }
      }
    } else if (mode === 'ERROR') {
      points.push(createPP(0));
      const threshold = val || 0.01;
      const adaptive = (t1: number, t2: number) => {
        const p1 = curve.getPoint(t1);
        const p2 = curve.getPoint(t2);
        const midT = (t1 + t2) / 2;
        const pMid = curve.getPoint(midT);
        const line = new THREE.Line3(p1, p2);
        const closestPoint = new THREE.Vector3();
        line.closestPointToPoint(pMid, true, closestPoint);
        const dist = pMid.distanceTo(closestPoint);
        if (dist > threshold && (t2 - t1) > 0.001) {
          adaptive(t1, midT);
          adaptive(midT, t2);
        } else {
          points.push(createPP(t2));
        }
      };
      adaptive(0, 1);
    } else {
      const divisionCount = mode === 'LENGTH' 
        ? Math.max(1, Math.ceil(curve.getLength() / (val || 1)))
        : Math.round(val || 24);
      const length = curve.getLength();
      for (let i = 0; i <= divisionCount; i++) {
        const u = i / divisionCount;
        const t = curve.getUtoTmapping(u, u * length);
        points.push(createPP(t));
      }
    }
    return points;
  }

  static calculateAllEdges(allData: PathPoint[]): any[] {
    const rawEdges: any[] = [];
    const n = allData.length;
    
    // 1. Calculate ideal shifts and perps for all points
    const idealShifts = new Array(n);
    const perps = new Array(n);
    
    for (let i = 0; i < n; i++) {
      const d = allData[i];
      const v1 = i > 0 ? d.pos.clone().sub(allData[i - 1].pos).normalize() : null;
      const v2 = i < n - 1 ? allData[i + 1].pos.clone().sub(d.pos).normalize() : null;
      let dir = v1 && v2 ? v1.clone().add(v2).normalize() : (v1 || v2);
      if (!dir) {
        perps[i] = new THREE.Vector3(1, 0, 0);
        idealShifts[i] = 0;
        continue;
      }
      const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
      if (perp.length() < 0.001) perp.set(1, 0, 0);
      perps[i] = perp;

      const align = d.alignment || 'CENTER';
      if (align === 'LEFT') {
        idealShifts[i] = -(d.ll + d.sl);
      } else if (align === 'RIGHT') {
        idealShifts[i] = (d.lr + d.sr);
      } else {
        idealShifts[i] = 0;
      }
    }

    // 2. Smooth the shifts to ensure perfect connections at nodes
    // and smooth transitions between different alignments.
    const smoothedShifts = new Array(n);
    const windowSize = 2; // Smooth over 5 points (i-2 to i+2)
    for (let i = 0; i < n; i++) {
      let sum = 0, count = 0;
      for (let k = -windowSize; k <= windowSize; k++) {
        const idx = i + k;
        if (idx >= 0 && idx < n) {
          sum += idealShifts[idx];
          count++;
        }
      }
      smoothedShifts[i] = sum / count;
    }

    // 3. Generate raw edges using smoothed shifts
    for (let i = 0; i < n; i++) {
      const d = allData[i];
      const perp = perps[i];
      const shift = smoothedShifts[i];
      
      const centerPos = d.pos.clone().add(perp.clone().multiplyScalar(shift));

      rawEdges.push({
        center: centerPos.clone(),
        l_lane: centerPos.clone().add(perp.clone().multiplyScalar(d.ll)),
        r_lane: centerPos.clone().add(perp.clone().multiplyScalar(-d.lr)),
        l_sw: centerPos.clone().add(perp.clone().multiplyScalar(d.ll + d.sl)),
        r_sw: centerPos.clone().add(perp.clone().multiplyScalar(-(d.lr + d.sr))),
        tightTurnMode: d.tightTurnMode || 'APEX'
      });
    }

    const getIntersection = (p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2, p4: THREE.Vector2) => {
      const den = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
      if (Math.abs(den) < 0.00001) return null;
      const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / den;
      const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / den;
      if (ua > 0.01 && ua < 0.99 && ub > 0.01 && ub < 0.99) {
        return new THREE.Vector2(p1.x + ua * (p2.x - p1.x), p1.y + ua * (p2.y - p1.y));
      }
      return null;
    };

    const finalEdges = rawEdges.map(e => ({...e}));
    const rails = ['center', 'l_lane', 'r_lane', 'l_sw', 'r_sw'];
    
    rails.forEach(rail => {
      for (let i = 0; i < finalEdges.length - 2; i++) {
        for (let j = finalEdges.length - 2; j > i + 1; j--) {
          const p1 = new THREE.Vector2((finalEdges[i] as any)[rail].x, (finalEdges[i] as any)[rail].y);
          const p2 = new THREE.Vector2((finalEdges[i+1] as any)[rail].x, (finalEdges[i+1] as any)[rail].y);
          const p3 = new THREE.Vector2((finalEdges[j] as any)[rail].x, (finalEdges[j] as any)[rail].y);
          const p4 = new THREE.Vector2((finalEdges[j+1] as any)[rail].x, (finalEdges[j+1] as any)[rail].y);
          
          const intersect = getIntersection(p1, p2, p3, p4);
          if (intersect) {
            const mode = (finalEdges[i] as any).tightTurnMode;
            const z = ((finalEdges[i] as any)[rail].z + (finalEdges[j] as any)[rail].z) / 2;
            const P = new THREE.Vector3(intersect.x, intersect.y, z);
            
            if (mode === 'CLEAN') {
              // Create a smooth rounding using a Quadratic Bezier curve
              const startP = (finalEdges[i] as any)[rail].clone();
              const endP = (finalEdges[j + 1] as any)[rail].clone();
              const curve = new THREE.QuadraticBezierCurve3(startP, P, endP);
              const count = j - i;
              for (let k = 1; k <= count; k++) {
                const t = k / (count + 1);
                const newPos = curve.getPoint(t);
                // CRITICAL: Keep the Z in sync with the center rail at this index
                // to avoid vertical cliffs on ramps.
                newPos.z = (finalEdges[i + k] as any).center.z;
                (finalEdges[i + k] as any)[rail].copy(newPos);
              }
            } else {
              // APEX Mode: Traditional collapse
              for (let k = i + 1; k <= j; k++) {
                const targetZ = (finalEdges[k] as any).center.z;
                (finalEdges[k] as any)[rail].set(P.x, P.y, targetZ);
              }
            }
            i = j; // Skip processed part of this rail
            break;
          }
        }
      }
    });

    return finalEdges;
  }
}
