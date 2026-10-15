// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useEffect, useRef, useState, useCallback } from 'react';
import { call } from '../../api';
import { Icon } from '../../ui/Icon';
import { IconButton, Loading } from '../../ui/components';
import { useStore } from '../../state/store';
import {
  modelViewer, closeModel, toggleModelWireframe, toggleModelGrid,
  toggleModelAxes, setModelColor,
} from '../../state/viewers';
import type { Model3DFormat } from '../../../shared/viewers';

// three.js is loaded dynamically to avoid bundling it when not needed
let THREE: typeof import('three') | null = null;
let OrbitControlsModule: unknown = null;

async function loadThree(): Promise<typeof import('three')> {
  if (THREE) return THREE;
  THREE = await import('three');
  try {
    OrbitControlsModule = await import('three/examples/jsm/controls/OrbitControls.js');
  } catch {
    // OrbitControls may not be available in all setups
  }
  return THREE;
}

export function ModelViewer() {
  const state = useStore(modelViewer, (s) => s.open);
  if (!state) return null;
  return <ModelViewerInner key={state.path} />;
}

function ModelViewerInner() {
  const state = useStore(modelViewer, (s) => s.open)!;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rendererRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sceneRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meshRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gridRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const axesRef = useRef<any>(null);
  const frameRef = useRef<number>(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string>('');

  const initScene = useCallback(async () => {
    if (!containerRef.current) return;
    setLoading(true);
    setError(null);

    try {
      const T = await loadThree();

      // Load model data
      const data = await call<Uint8Array>('model3d:load', { path: state.path });
      const buffer = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : (data as ArrayBuffer);

      // Scene setup
      const scene = new T.Scene();
      sceneRef.current = scene;

      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const camera = new T.PerspectiveCamera(60, width / height, 0.01, 10000);
      cameraRef.current = camera;

      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(new T.Color(state.bgColor), 1);
      rendererRef.current = renderer;

      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(renderer.domElement);

      // Lighting
      const ambient = new T.AmbientLight(0xffffff, 0.6);
      scene.add(ambient);
      const dir1 = new T.DirectionalLight(0xffffff, 0.8);
      dir1.position.set(5, 10, 7.5);
      scene.add(dir1);
      const dir2 = new T.DirectionalLight(0xffffff, 0.3);
      dir2.position.set(-5, -3, -5);
      scene.add(dir2);

      // Parse model
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let geometry: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let object: any;
      let _hasOwnMaterials = false;

      if (state.info.format === 'stl') {
        geometry = parseSTL(T, buffer);
        const material = new T.MeshStandardMaterial({ color: new T.Color(state.color), roughness: 0.5, metalness: 0.3, flatShading: true });
        object = new T.Mesh(geometry, material);
      } else if (state.info.format === 'obj') {
        const result = parseOBJ(T, buffer);
        geometry = result.geometry;
        const material = new T.MeshStandardMaterial({ color: new T.Color(state.color), roughness: 0.5, metalness: 0.3, flatShading: false });
        object = new T.Mesh(geometry, material);
      } else if (state.info.format === 'ply') {
        geometry = parsePLY(T, buffer);
        const hasColors = geometry.hasAttribute('color');
        const material = hasColors
          ? new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 })
          : new T.MeshStandardMaterial({ color: new T.Color(state.color), roughness: 0.5, metalness: 0.3 });
        object = new T.Mesh(geometry, material);
      } else if (state.info.format === 'gltf' || state.info.format === 'glb') {
        object = await parseGLTF(T, buffer, state.info.format);
        _hasOwnMaterials = true;
      }

      if (!object) throw new Error('Failed to parse 3D model.');

      meshRef.current = object;
      scene.add(object);

      // Compute bounding box and center the model
      const box = new T.Box3().setFromObject(object);
      const center = box.getCenter(new T.Vector3());
      const size = box.getSize(new T.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      // Center the object
      object.position.sub(center);

      // Set camera position
      const dist = maxDim * 2;
      camera.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
      camera.lookAt(0, 0, 0);
      camera.near = maxDim * 0.001;
      camera.far = maxDim * 100;
      camera.updateProjectionMatrix();

      // Grid
      const gridSize = maxDim * 4;
      const grid = new T.GridHelper(gridSize, 40, 0x444444, 0x333333);
      grid.position.y = box.min.y - center.y;
      grid.visible = state.showGrid;
      gridRef.current = grid;
      scene.add(grid);

      // Axes
      const axes = new T.AxesHelper(maxDim);
      axes.visible = state.showAxes;
      axesRef.current = axes;
      scene.add(axes);

      // OrbitControls
      if (OrbitControlsModule) {
        const controls = new (OrbitControlsModule as Record<string, unknown> & { OrbitControls: new (...args: unknown[]) => { enableDamping: boolean; dampingFactor: number } }).OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controlsRef.current = controls;
      }

      // Info
      let vertCount = 0;
      let faceCount = 0;
      if (geometry) {
        vertCount = geometry.getAttribute('position')?.count ?? 0;
        faceCount = geometry.index ? geometry.index.count / 3 : vertCount / 3;
      } else {
        // For glTF, traverse meshes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        object.traverse?.((child: any) => {
          if (child.geometry) {
            const g = child.geometry;
            vertCount += g.getAttribute('position')?.count ?? 0;
            faceCount += g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
          }
        });
      }
      setInfo(`${Math.round(vertCount).toLocaleString()} vertices, ${Math.round(faceCount).toLocaleString()} faces`);

      // Animation loop
      const animate = () => {
        frameRef.current = requestAnimationFrame(animate);
        controlsRef.current?.update();
        renderer.render(scene, camera);
      };
      animate();

      setLoading(false);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }, [state.path, state.info.format, state.bgColor, state.color, state.showGrid, state.showAxes]);

  useEffect(() => {
    void initScene();
    return () => {
      cancelAnimationFrame(frameRef.current);
      rendererRef.current?.dispose();
      controlsRef.current?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.path]); // Only re-init on path change

  // Update wireframe, grid, axes, color, bgColor when state changes
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const setWireframe = (obj: any) => {
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          obj.material.forEach((m: any) => { m.wireframe = state.wireframe; });
        } else {
          obj.material.wireframe = state.wireframe;
        }
      }
      obj.children?.forEach(setWireframe);
    };
    setWireframe(mesh);
  }, [state.wireframe]);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = state.showGrid;
  }, [state.showGrid]);

  useEffect(() => {
    if (axesRef.current) axesRef.current.visible = state.showAxes;
  }, [state.showAxes]);

  // Update model color reactively
  useEffect(() => {
    if (!THREE || !meshRef.current) return;
    const T = THREE;
    const newColor = new T.Color(state.color);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateColor = (obj: any) => {
      if (obj.material && !obj.material.vertexColors) {
        if (Array.isArray(obj.material)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          obj.material.forEach((m: any) => { if (!m.vertexColors) m.color.set(newColor); });
        } else {
          obj.material.color.set(newColor);
        }
      }
      obj.children?.forEach(updateColor);
    };
    updateColor(meshRef.current);
  }, [state.color]);

  // Update background color reactively
  useEffect(() => {
    if (!THREE || !rendererRef.current) return;
    rendererRef.current.setClearColor(new THREE.Color(state.bgColor), 1);
  }, [state.bgColor]);

  // Resize handler
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      rendererRef.current.setSize(w, h);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const zoomToFit = useCallback(() => {
    if (!meshRef.current || !cameraRef.current || !THREE) return;
    const T = THREE;
    const box = new T.Box3().setFromObject(meshRef.current);
    const size = box.getSize(new T.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2;
    cameraRef.current.position.set(dist * 0.7, dist * 0.5, dist * 0.7);
    cameraRef.current.lookAt(0, 0, 0);
    controlsRef.current?.reset();
  }, []);

  return (
    <div className="model-viewer">
      <div className="model-toolbar">
        <div className="model-toolbar-left">
          <IconButton icon="x" label="Close" onClick={closeModel} />
          <span className="muted small ellipsis">{state.info.format.toUpperCase()} model</span>
        </div>
        <div className="model-toolbar-right">
          <IconButton icon="maximize" label="Zoom to fit" onClick={zoomToFit} />
          <IconButton icon="grid" label="Grid" onClick={toggleModelGrid} active={state.showGrid} />
          <IconButton icon="navigation" label="Axes" onClick={toggleModelAxes} active={state.showAxes} />
          <button type="button" className={`btn btn-ghost btn-sm ${state.wireframe ? 'is-active' : ''}`} onClick={toggleModelWireframe}>
            Wireframe
          </button>
          <label className="model-color-label">
            <input type="color" value={state.color} onChange={(e) => setModelColor(e.target.value)} className="model-color-input" />
          </label>
          {info && <span className="muted tabular small">{info}</span>}
        </div>
      </div>
      <div className="model-canvas" ref={containerRef}>
        {loading && <div className="model-loading"><Loading label="Loading model…" /></div>}
        {error && <div className="model-error"><Icon name="alert" size={20} /><span>{error}</span></div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Parsers */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSTL(T: typeof import('three'), buffer: ArrayBuffer): any {
  const view = new DataView(buffer);

  // Check for ASCII STL
  const header = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength)));
  if (header.trimStart().startsWith('solid') && !isBinarySTL(buffer)) {
    return parseSTLAscii(T, buffer);
  }

  // Binary STL
  const triangleCount = view.getUint32(80, true);
  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const nx = view.getFloat32(offset, true); offset += 4;
    const ny = view.getFloat32(offset, true); offset += 4;
    const nz = view.getFloat32(offset, true); offset += 4;

    for (let v = 0; v < 3; v++) {
      const idx = i * 9 + v * 3;
      positions[idx] = view.getFloat32(offset, true); offset += 4;
      positions[idx + 1] = view.getFloat32(offset, true); offset += 4;
      positions[idx + 2] = view.getFloat32(offset, true); offset += 4;
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
    }
    offset += 2; // attribute byte count
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
  return geometry;
}

function isBinarySTL(buffer: ArrayBuffer): boolean {
  // Binary STL: 80 bytes header + 4 bytes triangle count + triangles
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  const expected = 84 + triangles * 50;
  return Math.abs(buffer.byteLength - expected) < 10;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSTLAscii(T: typeof import('three'), buffer: ArrayBuffer): any {
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const positions: number[] = [];
  const normals: number[] = [];

  const normalRe = /facet\s+normal\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;
  const vertexRe = /vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;

  let nm;
  while ((nm = normalRe.exec(text)) !== null) {
    const nx = parseFloat(nm[1]!);
    const ny = parseFloat(nm[2]!);
    const nz = parseFloat(nm[3]!);

    // Read 3 vertices for this facet
    for (let v = 0; v < 3; v++) {
      const vm = vertexRe.exec(text);
      if (vm) {
        positions.push(parseFloat(vm[1]!), parseFloat(vm[2]!), parseFloat(vm[3]!));
        normals.push(nx, ny, nz);
      }
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  return geometry;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseOBJ(T: typeof import('three'), buffer: ArrayBuffer): { geometry: any } {
  const text = new TextDecoder().decode(new Uint8Array(buffer));
  const vertices: number[] = [];
  const vertexNormals: number[] = [];
  const positions: number[] = [];
  const normals: number[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
      const parts = trimmed.split(/\s+/);
      vertices.push(parseFloat(parts[1]!), parseFloat(parts[2]!), parseFloat(parts[3]!));
    } else if (trimmed.startsWith('vn ')) {
      const parts = trimmed.split(/\s+/);
      vertexNormals.push(parseFloat(parts[1]!), parseFloat(parts[2]!), parseFloat(parts[3]!));
    } else if (trimmed.startsWith('f ')) {
      const parts = trimmed.split(/\s+/).slice(1);
      // Triangulate faces (fan triangulation)
      for (let i = 1; i < parts.length - 1; i++) {
        const indices = [parts[0]!, parts[i]!, parts[i + 1]!];
        for (const idx of indices) {
          const split = idx.split('/');
          const vi = parseInt(split[0]!, 10) - 1;
          const ni = split[2] ? parseInt(split[2], 10) - 1 : -1;
          if (vi >= 0 && vi * 3 + 2 < vertices.length) {
            positions.push(vertices[vi * 3]!, vertices[vi * 3 + 1]!, vertices[vi * 3 + 2]!);
          }
          if (ni >= 0 && ni * 3 + 2 < vertexNormals.length) {
            normals.push(vertexNormals[ni * 3]!, vertexNormals[ni * 3 + 1]!, vertexNormals[ni * 3 + 2]!);
          }
        }
      }
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  return { geometry };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePLY(T: typeof import('three'), buffer: ArrayBuffer): any {
  const text = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength)));
  const headerEnd = text.indexOf('end_header');
  if (headerEnd < 0) throw new Error('Invalid PLY file: no end_header found.');

  const header = text.substring(0, headerEnd);
  const isBinary = header.includes('format binary');
  const vertexCountMatch = header.match(/element vertex (\d+)/);
  const faceCountMatch = header.match(/element face (\d+)/);
  const vertexCount = vertexCountMatch ? parseInt(vertexCountMatch[1]!, 10) : 0;
  const faceCount = faceCountMatch ? parseInt(faceCountMatch[1]!, 10) : 0;

  // Check for color properties
  const hasColor = header.includes('property uchar red') || header.includes('property float red');

  if (isBinary) {
    return parsePLYBinary(T, buffer, headerEnd + 'end_header\n'.length, vertexCount, faceCount, hasColor, header);
  }

  // ASCII PLY
  const bodyText = new TextDecoder().decode(new Uint8Array(buffer)).substring(headerEnd + 'end_header\n'.length);
  const lines = bodyText.trim().split('\n');

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Parse vertices
  for (let i = 0; i < vertexCount && i < lines.length; i++) {
    const parts = lines[i]!.trim().split(/\s+/);
    positions.push(parseFloat(parts[0]!), parseFloat(parts[1]!), parseFloat(parts[2]!));
    if (hasColor && parts.length >= 6) {
      colors.push(parseFloat(parts[3]!) / 255, parseFloat(parts[4]!) / 255, parseFloat(parts[5]!) / 255);
    }
  }

  // Parse faces
  for (let i = vertexCount; i < vertexCount + faceCount && i < lines.length; i++) {
    const parts = lines[i]!.trim().split(/\s+/);
    const count = parseInt(parts[0]!, 10);
    if (count >= 3) {
      // Fan triangulate
      for (let j = 1; j < count - 1; j++) {
        indices.push(parseInt(parts[1]!, 10), parseInt(parts[1 + j]!, 10), parseInt(parts[2 + j]!, 10));
      }
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  if (colors.length === positions.length) {
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  }
  if (indices.length) {
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePLYBinary(T: typeof import('three'), buffer: ArrayBuffer, dataStart: number, vertexCount: number, faceCount: number, hasColor: boolean, header: string): any {
  const isLE = header.includes('binary_little_endian');
  const view = new DataView(buffer);
  let offset = dataStart;

  const positions = new Float32Array(vertexCount * 3);
  const colors = hasColor ? new Float32Array(vertexCount * 3) : null;

  // Determine vertex properties and their sizes
  const _propLines = header.split('\n').filter((l) => l.startsWith('property '));
  const vertexProps: Array<{ name: string; type: string }> = [];
  let inVertex = false;
  for (const line of header.split('\n')) {
    if (line.startsWith('element vertex')) inVertex = true;
    else if (line.startsWith('element ')) inVertex = false;
    else if (inVertex && line.startsWith('property ')) {
      const parts = line.trim().split(/\s+/);
      vertexProps.push({ type: parts[1]!, name: parts[2]! });
    }
  }

  const propSize = (type: string): number => {
    switch (type) {
      case 'float': case 'float32': case 'int': case 'int32': case 'uint': case 'uint32': return 4;
      case 'double': case 'float64': return 8;
      case 'short': case 'int16': case 'uint16': case 'ushort': return 2;
      case 'char': case 'int8': case 'uint8': case 'uchar': return 1;
      default: return 4;
    }
  };

  for (let i = 0; i < vertexCount; i++) {
    let localOffset = offset;
    let x = 0, y = 0, z = 0, r = 0, g = 0, b = 0;
    for (const prop of vertexProps) {
      const size = propSize(prop.type);
      const val = prop.type === 'float' || prop.type === 'float32'
        ? view.getFloat32(localOffset, isLE)
        : prop.type === 'uchar' || prop.type === 'uint8'
          ? view.getUint8(localOffset)
          : view.getFloat32(localOffset, isLE);
      if (prop.name === 'x') x = val;
      else if (prop.name === 'y') y = val;
      else if (prop.name === 'z') z = val;
      else if (prop.name === 'red') r = prop.type.includes('char') ? val / 255 : val;
      else if (prop.name === 'green') g = prop.type.includes('char') ? val / 255 : val;
      else if (prop.name === 'blue') b = prop.type.includes('char') ? val / 255 : val;
      localOffset += size;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    if (colors) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    offset = localOffset;
  }

  // Parse faces
  const indices: number[] = [];
  for (let i = 0; i < faceCount; i++) {
    const count = view.getUint8(offset); offset += 1;
    const faceIndices: number[] = [];
    for (let j = 0; j < count; j++) {
      faceIndices.push(view.getInt32(offset, isLE));
      offset += 4;
    }
    for (let j = 1; j < count - 1; j++) {
      indices.push(faceIndices[0]!, faceIndices[j]!, faceIndices[j + 1]!);
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  if (indices.length) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseGLTF(T: typeof import('three'), buffer: ArrayBuffer, format: Model3DFormat): Promise<any> {
  // Use three.js GLTFLoader
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const blob = new Blob([buffer], { type: format === 'glb' ? 'model/gltf-binary' : 'model/gltf+json' });
    const url = URL.createObjectURL(blob);

    loader.load(
      url,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (gltf: any) => {
        URL.revokeObjectURL(url);
        resolve(gltf.scene);
      },
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err: any) => {
        URL.revokeObjectURL(url);
        reject(new Error(`glTF parse error: ${err?.message ?? 'unknown'}`));
      },
    );
  });
}
