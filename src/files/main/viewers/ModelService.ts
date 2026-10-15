/**
 * 3D model service. Reads model files (STL, OBJ, PLY, glTF, GLB) and
 * provides their raw bytes to the renderer where three.js handles the
 * actual parsing and display.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError } from '../../shared/errors';
import type { Model3DFormat, Model3DInfo } from '../../shared/viewers';

/** Maximum model file size (200 MB). */
const MAX_MODEL_BYTES = 200 * 1024 * 1024;

const FORMAT_MAP: Record<string, Model3DFormat> = {
  '.stl': 'stl',
  '.obj': 'obj',
  '.ply': 'ply',
  '.gltf': 'gltf',
  '.glb': 'glb',
};

export async function modelInfo(filePath: string): Promise<Model3DInfo> {
  const st = await fsp.stat(filePath).catch(() => {
    throw makeError('not_found', 'model3d.info', { target: filePath });
  });

  if (!st.isFile()) {
    throw makeError('unsupported', 'model3d.info', { message: 'Not a file.' });
  }

  if (st.size > MAX_MODEL_BYTES) {
    throw makeError('unsupported', 'model3d.info', { message: 'This 3D model is too large (over 200 MB).' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const format = FORMAT_MAP[ext];
  if (!format) {
    throw makeError('unsupported', 'model3d.info', { message: `Unsupported 3D format: ${ext}` });
  }

  // Detect whether the file is binary
  let binary = false;
  if (format === 'stl') {
    // STL: binary files start with an 80-byte header then a uint32 triangle count
    // ASCII files start with "solid"
    const head = await readHead(filePath, 80);
    binary = !head.toString('ascii').trimStart().startsWith('solid');
  } else if (format === 'glb') {
    binary = true;
  } else if (format === 'gltf') {
    binary = false; // JSON-based
  } else {
    // OBJ and PLY are text-based (though PLY can be binary)
    const head = await readHead(filePath, 256);
    const text = head.toString('ascii');
    if (format === 'ply' && text.includes('format binary')) {
      binary = true;
    }
  }

  return {
    format,
    fileSize: st.size,
    binary,
  };
}

export async function loadModel(filePath: string): Promise<Uint8Array> {
  const st = await fsp.stat(filePath).catch(() => {
    throw makeError('not_found', 'model3d.load', { target: filePath });
  });

  if (st.size > MAX_MODEL_BYTES) {
    throw makeError('unsupported', 'model3d.load', { message: 'This 3D model is too large (over 200 MB).' });
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!FORMAT_MAP[ext]) {
    throw makeError('unsupported', 'model3d.load', { message: `Unsupported 3D format: ${ext}` });
  }

  const buf = await fsp.readFile(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function readHead(filePath: string, bytes: number): Promise<Buffer> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
