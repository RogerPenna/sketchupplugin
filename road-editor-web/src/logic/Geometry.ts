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
  perp: THREE.Vector3;
  ll: number;
  lr: number;
  sl: number;
  sr: number;
  tightTurnMode?: 'APEX' | 'CLEAN';
  alignment?: 'CENTER' | 'LEFT' | 'RIGHT';
}

export interface JunctionInfo {
  n1Neighbors: string[] | null; // IDs das estradas vizinhas no nó n1
  n2Neighbors: string[] | null; // IDs das estradas vizinhas no nó n2
}

export interface TrimResult {
  tStart: number;
  tEnd: number;
  startPoint?: THREE.Vector3; // Ponto exato da colisão no início
  endPoint?: THREE.Vector3;   // Ponto exato da colisão no fim
  debugRails?: THREE.Vector3[][]; // Trilhos usados para colisão (para debug)
  error?: string;
}

export class RoadGeometry {
  // ... (getBezierNodePoint permanece similar)
  static getBezierNodePoint(node: NodeData, edgeId: string, isStart: boolean, edge?: EdgeData): THREE.Vector3 {
    const align = edge?.alignment || 'CENTER';
    const anchor = (isStart ? edge?.n1Anchor : edge?.n2Anchor) || align;
    
    if (anchor === align && anchor === 'CENTER') return node.pos.clone();

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
    else anchorShift = shift;

    return node.pos.clone().sub(perp.multiplyScalar(anchorShift));
  }

  static generateBezierPath(n1: NodeData, n2: NodeData, edgeId: string, segments: number, edge?: EdgeData): PathPoint[] {
    const points: PathPoint[] = [];
    const p1 = this.getBezierNodePoint(n1, edgeId, true, edge);
    const p2 = this.getBezierNodePoint(n2, edgeId, false, edge);
    const h1 = n1.handles[edgeId] || n1.pos.clone().add(n2.pos.clone().sub(n1.pos).multiplyScalar(0.33));
    const h2 = n2.handles[edgeId] || n1.pos.clone().add(p2.clone().sub(p1).multiplyScalar(0.66));
    const curve = new THREE.CubicBezierCurve3(p1, h1, h2, p2);
    
    // Detecção rigorosa de linha reta
    const dir = p2.clone().sub(p1).normalize();
    const d1 = h1.clone().sub(p1).normalize();
    const d2 = p2.clone().sub(h2).normalize();
    const isStraight = d1.dot(dir) > 0.99999 && d2.dot(dir) > 0.99999;

    const mode = edge?.resMode || 'FIXED';
    let val = edge?.resValue || (edge?.resolution || segments);
    
    // Se for reta e o usuário não forçou uma resolução, usa 1 segmento
    if (isStraight && mode === 'FIXED' && !edge?.resValue && !edge?.resolution) {
      val = 1;
    }

    const createPP = (t: number): PathPoint => {
      const tangent = curve.getTangent(t).normalize();
      return {
        pos: curve.getPoint(t),
        perp: new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 0, 1)).normalize(),
        ll: n1.lane_l + (n2.lane_l - n1.lane_l) * t,
        lr: n1.lane_r + (n2.lane_r - n1.lane_r) * t,
        sl: n1.sw_l + (n2.sw_l - n1.sw_l) * t,
        sr: n1.sw_r + (n2.sw_r - n1.sw_r) * t,
        tightTurnMode: edge?.tightTurnMode || 'APEX',
        alignment: edge?.alignment || 'CENTER'
      };
    };

    const divisionCount = mode === 'LENGTH' 
      ? Math.max(1, Math.ceil(curve.getLength() / (val || 1)))
      : Math.round(val || 24);
    
    for (let i = 0; i <= divisionCount; i++) {
      points.push(createPP(i / divisionCount));
    }
    return points;
  }

  /**
   * Calcula o tStart e tEnd de uma estrada baseado nas colisões das fronteiras externas.
   */
  static calculateTrim(edge: EdgeData, allEdges: EdgeData[], nodesMap: Record<string, NodeData>): TrimResult {
    const n1 = nodesMap[edge.n1];
    const n2 = nodesMap[edge.n2];
    if (!n1 || !n2) return { tStart: 0, tEnd: 1 };

    // 1. Gerar geometria de alta resolução para colisão
    const fullPath = this.generateBezierPath(n1, n2, edge.id, 100, edge);
    const fullRails = this.calculateRawRails(fullPath);
    
    let tStart = 0;
    let tEnd = 1;
    let startPoint: THREE.Vector3 | undefined;
    let endPoint: THREE.Vector3 | undefined;
    const debugRails: THREE.Vector3[][] = [fullRails.l_sw, fullRails.r_sw];

    // Distância máxima de busca: 3x a largura total da estrada
    const maxSearchDist = (n1.lane_l + n1.lane_r + n1.sw_l + n1.sw_r) * 3.0;

    const checkNode = (nodeId: string, isStart: boolean) => {
      const neighbors = allEdges.filter(e => e.id !== edge.id && (e.n1 === nodeId || e.n2 === nodeId));
      const myNodePos = isStart ? n1.pos : n2.pos;
      
      neighbors.forEach(nb => {
        const nbN1 = nodesMap[nb.n1];
        const nbN2 = nodesMap[nb.n2];
        if (!nbN1 || !nbN2) return;

        const nbPath = this.generateBezierPath(nbN1, nbN2, nb.id, 100, nb);
        const nbRails = this.calculateRawRails(nbPath);
        debugRails.push(nbRails.l_sw, nbRails.r_sw);

        // Testar as 4 combinações de limites externos (L-L, L-R, R-L, R-R)
        const combinations = [
          { a: fullRails.l_sw, b: nbRails.l_sw },
          { a: fullRails.l_sw, b: nbRails.r_sw },
          { a: fullRails.r_sw, b: nbRails.l_sw },
          { a: fullRails.r_sw, b: nbRails.r_sw }
        ];

        combinations.forEach(combo => {
          const inter = this.findExtremeIntersection(combo.a, combo.b, isStart, myNodePos, maxSearchDist);
          if (inter) {
            const t = this.findClosestT(fullRails.center, inter.point);
            if (isStart) {
              if (t > tStart) {
                tStart = t;
                startPoint = inter.point.clone();
              }
            } else {
              if (t < tEnd) {
                tEnd = t;
                endPoint = inter.point.clone();
              }
            }
          }
        });
      });
    };

    checkNode(edge.n1, true);
    checkNode(edge.n2, false);

    return { 
      tStart, 
      tEnd, 
      startPoint, 
      endPoint,
      debugRails,
      error: tStart >= tEnd ? "Conflito Geométrico: Estradas sobrepostas" : undefined
    };
  }

  private static findExtremeIntersection(polyA: THREE.Vector3[], polyB: THREE.Vector3[], fromStart: boolean, nodePos: THREE.Vector3, maxDist: number) {
    let bestT = fromStart ? -1 : 2;
    let bestResult = null;
    const nA = polyA.length;
    const nB = polyB.length;

    for (let i = 0; i < nA - 1; i++) {
      const tA = i / (nA - 1);
      // Restrição na estrada principal
      if (polyA[i].distanceTo(nodePos) > maxDist) continue;

      const a1 = new THREE.Vector2(polyA[i].x, polyA[i].y);
      const a2 = new THREE.Vector2(polyA[i+1].x, polyA[i+1].y);

      for (let j = 0; j < nB - 1; j++) {
        // Restrição na estrada vizinha (bilateral)
        if (polyB[j].distanceTo(nodePos) > maxDist) continue;

        const b1 = new THREE.Vector2(polyB[j].x, polyB[j].y);
        const b2 = new THREE.Vector2(polyB[j+1].x, polyB[j+1].y);

        const pt = this.intersectSegments2D(a1, a2, b1, b2);
        if (pt) {
          if (fromStart) {
            if (tA > bestT) {
              bestT = tA;
              bestResult = { point: new THREE.Vector3(pt.x, pt.y, polyA[i].z), tIndex: i };
            }
          } else {
            if (tA < bestT) {
              bestT = tA;
              bestResult = { point: new THREE.Vector3(pt.x, pt.y, polyA[i].z), tIndex: i };
            }
          }
        }
      }
    }
    return bestResult;
  }

  private static intersectSegments2D(p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2, p4: THREE.Vector2): THREE.Vector2 | null {
    const det = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(det) < 0.000001) return null;
    const _ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / det;
    const _ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / det;
    if (_ua >= -0.001 && _ua <= 1.001 && _ub >= -0.001 && _ub <= 1.001) {
      return new THREE.Vector2(p1.x + _ua * (p2.x - p1.x), p1.y + _ua * (p2.y - p1.y));
    }
    return null;
  }

  private static findClosestT(centerline: THREE.Vector3[], point: THREE.Vector3): number {
    let minDist = Infinity;
    let closestT = 0;
    const n = centerline.length;
    for (let i = 0; i < n - 1; i++) {
      const a = centerline[i];
      const b = centerline[i+1];
      const line = new THREE.Line3(a, b);
      const target = new THREE.Vector3();
      line.closestPointToPoint(point, true, target);
      const dist = target.distanceTo(point);
      if (dist < minDist) {
        minDist = dist;
        const segmentLen = a.distanceTo(b);
        const distFromA = a.distanceTo(target);
        const segmentT = segmentLen > 0 ? distFromA / segmentLen : 0;
        closestT = (i + segmentT) / (n - 1);
      }
    }
    return closestT;
  }

  static calculateAllEdges(allData: PathPoint[], tStart: number = 0, tEnd: number = 1): any[] {
    if (allData.length < 2 || tStart >= tEnd - 0.001) return [];
    
    const nFull = allData.length;
    const finalPoints: PathPoint[] = [];

    // Add start interpolated point
    const exactStartIdx = tStart * (nFull - 1);
    const sIdx = Math.min(nFull - 2, Math.floor(exactStartIdx));
    const sFact = exactStartIdx - sIdx;
    finalPoints.push(this.interpolatePathPoint(allData[sIdx], allData[sIdx+1], sFact));

    // Add intermediate points that are strictly between tStart and tEnd
    for (let i = 0; i < nFull; i++) {
      const t = i / (nFull - 1);
      if (t > tStart + 0.00001 && t < tEnd - 0.00001) {
        finalPoints.push(allData[i]);
      }
    }

    // Add end interpolated point
    const exactEndIdx = tEnd * (nFull - 1);
    const eIdx = Math.min(nFull - 2, Math.floor(exactEndIdx));
    const eFact = exactEndIdx - eIdx;
    if (tEnd > tStart + 0.00001) {
      finalPoints.push(this.interpolatePathPoint(allData[eIdx], allData[eIdx+1], eFact));
    }

    const n = finalPoints.length;
    const rawEdges: any[] = [];
    
    for (let i = 0; i < n; i++) {
      const d = finalPoints[i];
      const perp = d.perp;

      let shift = 0;
      if (d.alignment === 'LEFT') shift = -(d.ll + d.sl);
      else if (d.alignment === 'RIGHT') shift = (d.lr + d.sr);
      
      const centerPos = d.pos.clone().add(perp.clone().multiplyScalar(shift));
      rawEdges.push({
        center: centerPos.clone(),
        l_lane: centerPos.clone().add(perp.clone().multiplyScalar(d.ll)),
        r_lane: centerPos.clone().add(perp.clone().multiplyScalar(-d.lr)),
        l_sw: centerPos.clone().add(perp.clone().multiplyScalar(d.ll + d.sl)),
        r_sw: centerPos.clone().add(perp.clone().multiplyScalar(-(d.lr + d.sr))),
      });
    }

    return rawEdges;
  }
}
