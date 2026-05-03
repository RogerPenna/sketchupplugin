import * as THREE from 'three';

export type ResolutionMode = 'FIXED' | 'LENGTH' | 'ANGLE' | 'ERROR';

export interface NodeData {
  id: string;
  pos: THREE.Vector3;
  handles: Record<string, THREE.Vector3>; 
  lane_l: number;
  lane_r: number;
  sw_l: number;
  sw_r: number;
}

export type Alignment = 'CENTER' | 'LEFT' | 'RIGHT';

export interface EdgeData {
  id: string;
  n1: string;
  n2: string;
  resMode?: ResolutionMode;
  resValue?: number;
  resolution?: number;
  tightTurnMode?: 'APEX' | 'CLEAN';
  alignment?: Alignment;
  n1Anchor?: Alignment;
  n2Anchor?: Alignment;
}

export interface PathPoint {
  pos: THREE.Vector3;
  perp: THREE.Vector3;
  ll: number;
  lr: number;
  sl: number;
  sr: number;
  alignment: Alignment;
  t: number;
}

export interface TrimResult {
  tStart: number;
  tEnd: number;
  startPoint?: THREE.Vector3;
  endPoint?: THREE.Vector3;
  debugRails?: THREE.Vector3[][];
  error?: string;
}

export class RoadGeometry {
  static getBezierNodePoint(node: NodeData, edgeId: string, isStart: boolean, edge?: EdgeData): THREE.Vector3 {
    const align = edge?.alignment || 'CENTER';
    const anchor = (isStart ? edge?.n1Anchor : edge?.n2Anchor) || align;
    if (anchor === align && anchor === 'CENTER') return node.pos.clone();
    const handle = node.handles[edgeId];
    if (!handle) return node.pos.clone();
    const dir = isStart ? handle.clone().sub(node.pos).normalize() : node.pos.clone().sub(handle).normalize();
    const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,0,1)).normalize();
    const wl = node.lane_l + node.sw_l, wr = node.lane_r + node.sw_r;
    let shift = align === 'LEFT' ? -wl : (align === 'RIGHT' ? wr : 0);
    let anchorShift = anchor === 'LEFT' ? shift + wl : (anchor === 'RIGHT' ? shift - wr : shift);
    return node.pos.clone().sub(perp.multiplyScalar(anchorShift));
  }

  static generateBezierPath(n1: NodeData, n2: NodeData, edgeId: string, segments: number, edge?: EdgeData): PathPoint[] {
    const p1 = this.getBezierNodePoint(n1, edgeId, true, edge);
    const p2 = this.getBezierNodePoint(n2, edgeId, false, edge);
    const h1 = n1.handles[edgeId] || n1.pos.clone().add(n2.pos.clone().sub(n1.pos).multiplyScalar(0.33));
    const h2 = n2.handles[edgeId] || n2.pos.clone().add(p1.clone().sub(p2).multiplyScalar(0.33));
    const curve = new THREE.CubicBezierCurve3(p1, h1, h2, p2);
    
    const div = Math.round(edge?.resValue || edge?.resolution || segments || 24);
    const points: PathPoint[] = [];
    for (let i = 0; i <= div; i++) {
      const t = i / div;
      const tangent = curve.getTangent(t).normalize();
      points.push({
        pos: curve.getPoint(t),
        perp: new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 0, 1)).normalize(),
        ll: n1.lane_l + (n2.lane_l - n1.lane_l) * t,
        lr: n1.lane_r + (n2.lane_r - n1.lane_r) * t,
        sl: n1.sw_l + (n2.sw_l - n1.sw_l) * t,
        sr: n1.sw_r + (n2.sw_r - n1.sw_r) * t,
        alignment: edge?.alignment || 'CENTER',
        t
      });
    }
    return points;
  }

  static calculateTrim(edge: EdgeData, allEdges: EdgeData[], nodesMap: Record<string, NodeData>): TrimResult {
    const n1 = nodesMap[edge.n1], n2 = nodesMap[edge.n2];
    if (!n1 || !n2) return { tStart: 0, tEnd: 1, debugRails: [] };
    
    const fullPath = this.generateBezierPath(n1, n2, edge.id, 60, edge);
    const fullRails = this.calculateRawRails(fullPath);
    let tStart = 0, tEnd = 1, startPoint: THREE.Vector3|undefined, endPoint: THREE.Vector3|undefined;
    const debugRails: THREE.Vector3[][] = [fullRails.l_sw, fullRails.r_sw];

    const checkNode = (nodeId: string, isStart: boolean) => {
      const myNodePos = isStart ? n1.pos : n2.pos;
      const maxDist = (n1.lane_l + n1.lane_r + n1.sw_l + n1.sw_r) * 2.5; 
      allEdges.filter(e => e.id !== edge.id && (e.n1 === nodeId || e.n2 === nodeId)).forEach(nb => {
        const nbN1 = nodesMap[nb.n1], nbN2 = nodesMap[nb.n2];
        if (!nbN1 || !nbN2) return;
        const nbPath = this.generateBezierPath(nbN1, nbN2, nb.id, 40, nb);
        const nbRails = this.calculateRawRails(nbPath);
        debugRails.push(nbRails.l_sw, nbRails.r_sw);
        const combos = [{a: fullRails.l_sw, b: nbRails.l_sw}, {a: fullRails.l_sw, b: nbRails.r_sw}, {a: fullRails.r_sw, b: nbRails.l_sw}, {a: fullRails.r_sw, b: nbRails.r_sw}];
        combos.forEach(c => {
          const inter = this.findExtremeIntersection(c.a, c.b, isStart, myNodePos, maxDist);
          if (inter) {
            const t = this.findClosestT(fullRails.center, inter.point);
            if (isStart && t > tStart) { tStart = t; startPoint = inter.point.clone(); }
            else if (!isStart && t < tEnd) { tEnd = t; endPoint = inter.point.clone(); }
          }
        });
      });
    };
    checkNode(edge.n1, true); checkNode(edge.n2, false);
    return { tStart, tEnd, startPoint, endPoint, debugRails, error: tStart >= tEnd ? "Conflito Geométrico" : undefined };
  }

  private static calculateRawRails(path: PathPoint[]) {
    const center: THREE.Vector3[] = [], l_sw: THREE.Vector3[] = [], r_sw: THREE.Vector3[] = [];
    path.forEach(d => {
      const wl = d.ll + d.sl, wr = d.lr + d.sr;
      const shift = d.alignment === 'LEFT' ? -wl : (d.alignment === 'RIGHT' ? wr : 0);
      const toCenter = -shift; 
      const c = d.pos.clone().add(d.perp.clone().multiplyScalar(toCenter));
      center.push(c);
      l_sw.push(c.clone().add(d.perp.clone().multiplyScalar(d.ll + d.sl)));
      r_sw.push(c.clone().add(d.perp.clone().multiplyScalar(-(d.lr + d.sr))));
    });
    return { center, l_sw, r_sw };
  }

  private static findExtremeIntersection(polyA: THREE.Vector3[], polyB: THREE.Vector3[], fromStart: boolean, nodePos: THREE.Vector3, maxDist: number) {
    let bestT = fromStart ? -1 : 2, bestResult = null;
    for (let i = 0; i < polyA.length - 1; i++) {
      const tA = i / (polyA.length - 1);
      const d2 = new THREE.Vector2(polyA[i].x, polyA[i].y).distanceTo(new THREE.Vector2(nodePos.x, nodePos.y));
      if (d2 > maxDist) continue;
      for (let j = 0; j < polyB.length - 1; j++) {
        const d2b = new THREE.Vector2(polyB[j].x, polyB[j].y).distanceTo(new THREE.Vector2(nodePos.x, nodePos.y));
        if (d2b > maxDist) continue;
        const pt = this.intersectSegments2D(new THREE.Vector2(polyA[i].x, polyA[i].y), new THREE.Vector2(polyA[i+1].x, polyA[i+1].y), new THREE.Vector2(polyB[j].x, polyB[j].y), new THREE.Vector2(polyB[j+1].x, polyB[j+1].y));
        if (pt && ((fromStart && tA > bestT) || (!fromStart && tA < bestT))) {
          bestT = tA; bestResult = { point: new THREE.Vector3(pt.x, pt.y, polyA[i].z), tIndex: i };
        }
      }
    }
    return bestResult;
  }

  private static intersectSegments2D(p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2, p4: THREE.Vector2): THREE.Vector2 | null {
    const det = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(det) < 0.000001) return null;
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / det;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)) / det;
    return (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) ? new THREE.Vector2(p1.x + ua * (p2.x - p1.x), p1.y + ua * (p2.y - p1.y)) : null;
  }

  private static findClosestT(centerline: THREE.Vector3[], point: THREE.Vector3): number {
    let minDist = Infinity, closestT = 0, n = centerline.length;
    for (let i = 0; i < n - 1; i++) {
      const target = new THREE.Vector3();
      new THREE.Line3(centerline[i], centerline[i+1]).closestPointToPoint(point, true, target);
      const dist = target.distanceTo(point);
      if (dist < minDist) {
        minDist = dist;
        closestT = (i + centerline[i].distanceTo(target) / Math.max(0.001, centerline[i].distanceTo(centerline[i+1]))) / (n - 1);
      }
    }
    return closestT;
  }

  static calculateAllEdges(allData: PathPoint[], n1: NodeData, n2: NodeData, edgeId: string, tStart: number = 0, tEnd: number = 1): any[] {
    if (allData.length < 2 || tStart >= tEnd - 0.001) return [];
    const nFull = allData.length, finalPoints: PathPoint[] = [];
    const sIdx = Math.min(nFull - 2, Math.floor(tStart * (nFull - 1))), sFact = tStart * (nFull - 1) - sIdx;
    finalPoints.push(this.interpolatePP(allData[sIdx], allData[sIdx+1], sFact));
    for (let i = 0; i < nFull; i++) {
      const t = i / (nFull - 1);
      if (t > tStart + 0.00001 && t < tEnd - 0.00001) finalPoints.push(allData[i]);
    }
    const eIdx = Math.min(nFull - 2, Math.floor(tEnd * (nFull - 1))), eFact = tEnd * (nFull - 1) - eIdx;
    if (tEnd > tStart + 0.00001) finalPoints.push(this.interpolatePP(allData[eIdx], allData[eIdx+1], eFact));
    
    // Extract Bezier handle Zs for the remapped curve
    const h1z = n1.handles[edgeId]?.z ?? n1.pos.z;
    const h2z = n2.handles[edgeId]?.z ?? n2.pos.z;
    const zCurve = (u: number) => {
      const u1 = 1 - u;
      return u1*u1*u1 * n1.pos.z + 3*u1*u1*u * h1z + 3*u1*u*u * h2z + u*u*u * n2.pos.z;
    };

    return finalPoints.map(d => {
      const wl = d.ll + d.sl, wr = d.lr + d.sr;
      const shift = d.alignment === 'LEFT' ? -wl : (d.alignment === 'RIGHT' ? wr : 0);
      const toCenter = -shift;
      
      const u = (d.t - tStart) / Math.max(0.0001, (tEnd - tStart));
      const clampedU = Math.max(0, Math.min(1, u));
      const pos = d.pos.clone();
      pos.z = zCurve(clampedU);

      const c = pos.clone().add(d.perp.clone().multiplyScalar(toCenter));
      return { 
        center: c, 
        l_lane: c.clone().add(d.perp.clone().multiplyScalar(d.ll)), 
        r_lane: c.clone().add(d.perp.clone().multiplyScalar(-d.lr)), 
        l_sw: c.clone().add(d.perp.clone().multiplyScalar(d.ll + d.sl)), 
        r_sw: c.clone().add(d.perp.clone().multiplyScalar(-(d.lr + d.sr))) 
      };
    });
  }

  private static interpolatePP(p1: PathPoint, p2: PathPoint, f: number): PathPoint {
    return { 
      pos: new THREE.Vector3().lerpVectors(p1.pos, p2.pos, f), 
      perp: new THREE.Vector3().lerpVectors(p1.perp, p2.perp, f).normalize(), 
      ll: p1.ll + (p2.ll - p1.ll) * f, 
      lr: p1.lr + (p2.lr - p1.lr) * f, 
      sl: p1.sl + (p2.sl - p1.sl) * f, 
      sr: p1.sr + (p2.sr - p1.sr) * f, 
      alignment: p1.alignment,
      t: p1.t + (p2.t - p1.t) * f
    };
  }
}