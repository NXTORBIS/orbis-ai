import { parentPort, workerData } from 'node:worker_threads';
import { exec7z, type SevenZipJob } from './sevenZipCore';

/** Worker thread entry: runs one 7-Zip command so long jobs never block the main process. */
const data = workerData as { wasm: Uint8Array; job: SevenZipJob };
exec7z(data.wasm, data.job, (line, stream) => parentPort!.postMessage({ type: 'line', line, stream }))
  .then((r) => parentPort!.postMessage({ type: 'done', result: r }))
  .catch((err: Error) => parentPort!.postMessage({ type: 'done', result: { code: 2, stdout: [], stderr: [String(err?.message ?? err)] } }));
