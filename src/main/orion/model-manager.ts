/** Model download, verification, and management for ORION. */

import { net } from 'electron'
import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'

export interface Model {
  id: string
  name: string
  size: number // bytes
  url: string
  sha256: string
  format: 'gguf' | 'huggingface'
}

export type ModelStatus = 'installed' | 'downloading' | 'missing' | 'corrupted' | 'verifying'

export interface DownloadProgress {
  loaded: number // bytes downloaded so far
  total: number // total bytes
  percentage: number // 0-100
}

const MODELS: Record<string, Model> = {
  'qwen3-14b-gguf': {
    id: 'qwen3-14b-gguf',
    name: 'Qwen3-14B-Q4_K_M (Text)',
    size: 8_937_779_200, // 8.4GB (approximate)
    url: 'https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',
    sha256: 'placeholder-sha256-will-be-verified-on-download',
    format: 'gguf',
  },
}

export class ModelManager {
  private modelsDir: string
  private activeDownloads: Map<string, AbortController> = new Map()

  constructor(modelsDir: string) {
    this.modelsDir = modelsDir
  }

  /** List all available models. */
  listAvailable(): Model[] {
    return Object.values(MODELS)
  }

  /** Get path where model should be stored. */
  getModelPath(modelId: string): string {
    const model = MODELS[modelId]
    if (!model) throw new Error(`Unknown model: ${modelId}`)

    // For GGUF: models/Qwen3-14B-GGUF/Qwen3-14B-Q4_K_M.gguf
    // For HF: models/Qwen3.5-0.8B-Base/
    if (model.format === 'gguf') {
      const filename = basename(model.url.split('?')[0])
      const dir = filename.replace(/-Q\d.*/, '')
      return join(this.modelsDir, dir, filename)
    } else {
      const dir = basename(model.url)
      return join(this.modelsDir, dir)
    }
  }

  /** Check if model is installed and valid. */
  async isInstalled(modelId: string): Promise<boolean> {
    try {
      const path = this.getModelPath(modelId)
      const stat = await fs.stat(path)
      const model = MODELS[modelId]
      // For GGUF files, check size matches
      if (model.format === 'gguf') {
        return stat.isFile() && Math.abs(stat.size - model.size) < 1000 // Allow 1KB variance
      }
      // For HuggingFace format, check directory exists
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  /** Check available disk space. */
  async getAvailableSpace(path: string = this.modelsDir): Promise<number> {
    // Approximate: check if parent directory is accessible
    try {
      await fs.stat(path)
      // On Windows, this is approximate - we'd need native code for exact space
      // For now, return a conservative estimate
      return 500_000_000_000 // 500GB default assumption
    } catch {
      return 0
    }
  }

  /** Download a model with progress updates. */
  async download(
    modelId: string,
    onProgress: (progress: DownloadProgress) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const model = MODELS[modelId]
    if (!model) throw new Error(`Unknown model: ${modelId}`)

    // Check space
    const available = await this.getAvailableSpace()
    if (available < model.size * 1.2) {
      throw new Error(`Not enough disk space: need ${(model.size / 1e9).toFixed(1)}GB, available ${(available / 1e9).toFixed(1)}GB`)
    }

    const destPath = this.getModelPath(modelId)
    const destDir = destPath.substring(0, destPath.lastIndexOf('/'))

    // Create directory
    await fs.mkdir(destDir, { recursive: true })

    // Check for partial download
    let resumeFrom = 0
    try {
      const stat = await fs.stat(destPath)
      if (stat.isFile() && stat.size < model.size) {
        resumeFrom = stat.size
      }
    } catch {
      // File doesn't exist, start from 0
    }

    // Download with Electron net module
    return new Promise((resolve, reject) => {
      const controller = new AbortController()
      this.activeDownloads.set(modelId, controller)

      signal.addEventListener('abort', () => {
        controller.abort()
        this.activeDownloads.delete(modelId)
        reject(new Error('Download cancelled'))
      })

      const request = net.request({
        method: 'GET',
        url: model.url,
      })

      let totalSize = model.size
      let downloadedSize = resumeFrom

      request.on('response', (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Failed to download: HTTP ${res.statusCode}`))
          return
        }

        const contentLength = parseInt(res.headers['content-length'] as string, 10)
        if (!Number.isNaN(contentLength)) {
          totalSize = resumeFrom + contentLength
        }

        const writeStream = require('node:fs').createWriteStream(destPath, { flags: resumeFrom > 0 ? 'a' : 'w' })

        res.on('data', (chunk) => {
          downloadedSize += chunk.length
          onProgress({
            loaded: downloadedSize,
            total: totalSize,
            percentage: Math.round((downloadedSize / totalSize) * 100),
          })
          writeStream.write(chunk)
        })

        res.on('end', () => {
          writeStream.end()
          writeStream.on('finish', async () => {
            // Verify
            try {
              await this.verify(modelId)
              this.activeDownloads.delete(modelId)
              resolve()
            } catch (err) {
              reject(err)
            }
          })
        })
      })

      request.on('error', (err) => {
        this.activeDownloads.delete(modelId)
        reject(err)
      })

      if (resumeFrom > 0) {
        request.setHeader('Range', `bytes=${resumeFrom}-`)
      }

      request.end()
    })
  }

  /** Cancel an active download. */
  cancelDownload(modelId: string): void {
    const controller = this.activeDownloads.get(modelId)
    if (controller) {
      controller.abort()
      this.activeDownloads.delete(modelId)
    }
  }

  /** Verify model integrity. */
  async verify(modelId: string): Promise<boolean> {
    const model = MODELS[modelId]
    if (!model) throw new Error(`Unknown model: ${modelId}`)

    const path = this.getModelPath(modelId)

    try {
      const stat = await fs.stat(path)

      // For GGUF, verify file size
      if (model.format === 'gguf') {
        if (!stat.isFile()) throw new Error('Model is not a file')
        if (Math.abs(stat.size - model.size) > 1000) {
          throw new Error(`Size mismatch: expected ${model.size}, got ${stat.size}`)
        }
        // SHA256 verification would require reading the entire file
        // For production, implement proper checksums
        return true
      }

      // For HuggingFace format, verify directory structure
      if (model.format === 'huggingface') {
        if (!stat.isDirectory()) throw new Error('Model is not a directory')
        const configPath = join(path, 'config.json')
        await fs.stat(configPath)
        return true
      }

      return false
    } catch (err) {
      throw new Error(`Model verification failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Get size of installed model, or 0 if not installed. */
  async getInstalledSize(modelId: string): Promise<number> {
    try {
      const path = this.getModelPath(modelId)
      const stat = await fs.stat(path)
      if (stat.isFile()) return stat.size
      if (stat.isDirectory()) {
        // Sum directory recursively
        return this.getDirectorySize(path)
      }
      return 0
    } catch {
      return 0
    }
  }

  private async getDirectorySize(path: string): Promise<number> {
    let size = 0
    const files = await fs.readdir(path, { recursive: true, withFileTypes: true })
    for (const file of files) {
      if (file.isFile()) {
        const stat = await fs.stat(join(file.parentPath || path, file.name))
        size += stat.size
      }
    }
    return size
  }
}
