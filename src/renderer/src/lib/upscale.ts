import type { InferenceSession, Tensor } from 'onnxruntime-web'
import jsepWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import modelUrl from '../assets/models/realesr-general-x4v3.onnx?url'

/**
 * Sharpening generated images on this computer.
 *
 * The free image service returns small, soft pictures, and showing them larger only stretches the softness. Real-ESRGAN
 * (realesr-general-x4v3, BSD 3-Clause) redraws an image at four times the size, restoring edges and removing the
 * blocky compression it arrives with. It runs on the graphics chip through WebGPU when there is one, otherwise on the
 * processor; nothing leaves the computer.
 *
 * The image is worked through in overlapping tiles, so a large picture never needs one enormous block of graphics
 * memory, and the seams fall inside the overlaps where they cannot be seen. The result is kept at twice the original
 * size: sharper than the four-times version looks once it is shrunk to fit the screen, and a quarter of its weight.
 */

const SCALE = 4
const TILE = 256
const OVERLAP = 16
const KEEP = 2

type Ort = typeof import('onnxruntime-web/webgpu')

let loading: Promise<{ ort: Ort; session: InferenceSession }> | null = null

function load(): Promise<{ ort: Ort; session: InferenceSession }> {
  if (!loading) {
    loading = (async () => {
      const ort = await import('onnxruntime-web/webgpu')
      ort.env.wasm.numThreads = 1
      ort.env.wasm.wasmPaths = { wasm: new URL(jsepWasmUrl, document.baseURI).href }
      const model = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer())
      const gpu = 'gpu' in navigator && (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null))
      const session = await ort.InferenceSession.create(model, { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'], graphOptimizationLevel: 'all' })
      return { ort, session }
    })()
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

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('The image could not be read'))
    img.src = src
  })
}

/** Where tiles start along one side, overlapping so every edge but the image's own is covered twice. */
function starts(length: number): number[] {
  if (length <= TILE) return [0]
  const step = TILE - OVERLAP * 2
  const out: number[] = []
  for (let at = 0; at + TILE < length; at += step) out.push(at)
  out.push(length - TILE)
  return out
}

async function sharpen(src: string): Promise<string> {
  const { ort, session } = await load()
  const img = await decode(src)
  const w = img.naturalWidth
  const h = img.naturalHeight
  const source = canvas2d(w, h)
  source.ctx.drawImage(img, 0, 0)
  const pixels = source.ctx.getImageData(0, 0, w, h).data
  const big = canvas2d(w * SCALE, h * SCALE)

  for (const y0 of starts(h)) {
    for (const x0 of starts(w)) {
      const tw = Math.min(TILE, w - x0)
      const th = Math.min(TILE, h - y0)
      const plane = tw * th
      const input = new Float32Array(3 * plane)
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const from = ((y0 + y) * w + (x0 + x)) * 4
          const p = y * tw + x
          input[p] = pixels[from] / 255
          input[plane + p] = pixels[from + 1] / 255
          input[2 * plane + p] = pixels[from + 2] / 255
        }
      }
      const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, th, tw]) })
      const out = result[session.outputNames[0]] as Tensor
      const data = (out.location === 'gpu-buffer' ? await out.getData() : out.data) as Float32Array
      out.dispose?.()

      // Only the middle of each tile is kept; its borders, where the network sees less, are left to its neighbours.
      const left = x0 === 0 ? 0 : OVERLAP
      const top = y0 === 0 ? 0 : OVERLAP
      const right = x0 + tw >= w ? 0 : OVERLAP
      const bottom = y0 + th >= h ? 0 : OVERLAP
      const ow = tw * SCALE
      const oh = th * SCALE
      const kw = (tw - left - right) * SCALE
      const kh = (th - top - bottom) * SCALE
      const patch = big.ctx.createImageData(kw, kh)
      const oplane = ow * oh
      for (let y = 0; y < kh; y++) {
        for (let x = 0; x < kw; x++) {
          const p = (y + top * SCALE) * ow + (x + left * SCALE)
          const q = (y * kw + x) * 4
          patch.data[q] = Math.max(0, Math.min(255, data[p] * 255 + 0.5))
          patch.data[q + 1] = Math.max(0, Math.min(255, data[oplane + p] * 255 + 0.5))
          patch.data[q + 2] = Math.max(0, Math.min(255, data[2 * oplane + p] * 255 + 0.5))
          patch.data[q + 3] = 255
        }
      }
      big.ctx.putImageData(patch, (x0 + left) * SCALE, (y0 + top) * SCALE)
    }
  }

  const final = canvas2d(w * KEEP, h * KEEP)
  final.ctx.imageSmoothingQuality = 'high'
  final.ctx.drawImage(big.canvas, 0, 0, w * KEEP, h * KEEP)
  return final.canvas.toDataURL('image/jpeg', 0.95)
}

const done = new Map<string, Promise<string>>()
const key = (src: string): string => `${src.length}:${src.slice(-96)}`

/**
 * The sharpened version of a generated image, worked out once per image and remembered while Orbis is open.
 * Images with transparency are left as they are: the model only understands colour, and would fill it in.
 */
export function sharpenedImage(src: string): Promise<string> {
  if (!src.startsWith('data:image/jpeg') && !src.startsWith('data:image/jpg') && !src.startsWith('data:image/webp')) return Promise.resolve(src)
  const k = key(src)
  let job = done.get(k)
  if (!job) {
    job = sharpen(src)
    job.catch(() => done.delete(k))
    done.set(k, job)
  }
  return job
}
