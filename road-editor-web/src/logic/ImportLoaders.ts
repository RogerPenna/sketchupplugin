import * as THREE from 'three';
import DxfParser from 'dxf-parser';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface LayerData {
  id: string;
  name: string;
  type: 'pdf' | 'dxf';
  visible: boolean;
  position: THREE.Vector3;
  scale: number;
  rotation: number;
  content: THREE.Texture | THREE.Group;
  aspectRatio?: number; // for PDF
}

export class ImportLoaders {
  static async loadPDF(file: File): Promise<LayerData> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (!context) throw new Error("Could not create canvas context");
    
    await page.render({ canvasContext: context, viewport }).promise;
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    
    return {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: 'pdf',
      visible: true,
      position: new THREE.Vector3(0, 0, 0.002),
      scale: 1,
      rotation: 0,
      content: texture,
      aspectRatio: viewport.width / viewport.height
    };
  }

  static async loadDXF(file: File): Promise<LayerData> {
    const text = await file.text();
    const parser = new DxfParser();
    const dxf = parser.parseSync(text);
    
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({ color: 0x666666 });

    if (dxf && dxf.entities) {
      dxf.entities.forEach((entity: any) => {
        if (entity.type === 'LINE') {
          const points = [
            new THREE.Vector3(entity.vertices[0].x, entity.vertices[0].y, 0),
            new THREE.Vector3(entity.vertices[1].x, entity.vertices[1].y, 0)
          ];
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geometry, material);
          group.add(line);
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
          const points = entity.vertices.map((v: any) => new THREE.Vector3(v.x, v.y, 0));
          if (entity.shape) points.push(points[0]); // close loop
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geometry, material);
          group.add(line);
        } else if (entity.type === 'CIRCLE') {
          const curve = new THREE.EllipseCurve(entity.center.x, entity.center.y, entity.radius, entity.radius, 0, 2 * Math.PI, false, 0);
          const points = curve.getPoints(50).map(p => new THREE.Vector3(p.x, p.y, 0));
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geometry, material);
          group.add(line);
        } else if (entity.type === 'ARC') {
          const curve = new THREE.EllipseCurve(
            entity.center.x, entity.center.y, 
            entity.radius, entity.radius, 
            entity.startAngle, entity.endAngle, 
            false, 0
          );
          const points = curve.getPoints(50).map(p => new THREE.Vector3(p.x, p.y, 0));
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geometry, material);
          group.add(line);
        }
      });
    }

    return {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: 'dxf',
      visible: true,
      position: new THREE.Vector3(0, 0, 0.002),
      scale: 1,
      rotation: 0,
      content: group
    };
  }
}
