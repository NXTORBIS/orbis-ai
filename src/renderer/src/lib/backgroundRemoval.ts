import type { InferenceSession, Tensor } from 'onnxruntime-web'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import modelUrl from '../assets/models/u2netp.onnx?url'

type Ort = typeof import('onnxruntime-web/wasm')

// U²-Net (u2netp) expects 320×320 RGB scaled to 0–1, then ImageNet-normalised.
const SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let loading: Promise<{ ort: Ort; session: InferenceSession }> | null = null

/** Loads the runtime and model on first use so they never slow down app start-up. */
function load(): Promise<{ ort: Ort; session: InferenceSession }> {
  if (!loading) {
    loading = (async () => {
      const ort = await import('onnxruntime-web/wasm')
      ort.env.wasm.numThreads = 1
      ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, document.baseURI).href }
      const model = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer())
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      return { ort, session }
    })()
    // A failed load (e.g. a transient error) shouldn't poison later attempts.
    loading.catch(() => (loading = null))
  }
  return loading
}

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  return { canvas, ctx }
}

/** Makes the background of `image` transparent in place. Returns the share of pixels removed (0–1). */
export async function cutOutSubject(image: ImageData): Promise<number> {
  const { ort, session } = await load()
  const { width: w, height: h, data } = image

  const full = canvas2d(w, h)
  full.ctx.putImageData(image, 0, 0)
  const small = canvas2d(SIZE, SIZE)
  small.ctx.imageSmoothingQuality = 'high'
  small.ctx.drawImage(full.canvas, 0, 0, SIZE, SIZE)
  const rgba = small.ctx.getImageData(0, 0, SIZE, SIZE).data

  let max = 1e-6
  for (let i = 0; i < rgba.length; i += 4) max = Math.max(max, rgba[i], rgba[i + 1], rgba[i + 2])
  const plane = SIZE * SIZE
  const input = new Float32Array(3 * plane)
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) input[c * plane + p] = (rgba[p * 4 + c] / max - MEAN[c]) / STD[c]
  }

  const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) })
  const prediction = (outputs[session.outputNames[0]] as Tensor).data as Float32Array
  let lo = Infinity
  let hi = -Infinity
  for (let p = 0; p < plane; p++) {
    lo = Math.min(lo, prediction[p])
    hi = Math.max(hi, prediction[p])
  }
  const range = hi - lo || 1

  // Scale the 320×320 mask up to the image with canvas smoothing, which keeps edges soft.
  const maskSmall = small.ctx.createImageData(SIZE, SIZE)
  for (let p = 0; p < plane; p++) {
    const v = Math.round(((prediction[p] - lo) / range) * 255)
    maskSmall.data[p * 4] = v
    maskSmall.data[p * 4 + 3] = 255
  }
  small.ctx.putImageData(maskSmall, 0, 0)
  full.ctx.clearRect(0, 0, w, h)
  full.ctx.imageSmoothingQuality = 'high'
  full.ctx.drawImage(small.canvas, 0, 0, w, h)
  const mask = full.ctx.getImageData(0, 0, w, h).data

  let removed = 0
  for (let p = 0; p < w * h; p++) {
    const alpha = Math.round((data[p * 4 + 3] * mask[p * 4]) / 255)
    data[p * 4 + 3] = alpha
    if (alpha < 13) removed++
  }
  return removed / (w * h)
}
