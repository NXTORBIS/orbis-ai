/** HTTP client for ORION API. */

import { net } from 'electron'
import type {
  ChatRequest,
  ChatResponse,
  GenerateRequest,
  GenerateResponse,
  HealthResponse,
  ModelsResponse,
  OrionError,
  VisionRequest,
  VisionResponse,
} from './types'

export class OrionClient {
  private baseUrl: string
  private timeout: number

  constructor(baseUrl: string = 'http://127.0.0.1:8765', timeoutMs: number = 600_000) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.timeout = timeoutMs
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${path}`
      const bodyStr = body ? JSON.stringify(body) : undefined

      const req = net.request({
        method,
        url,
      })

      const timer = setTimeout(() => {
        req.abort()
        reject(new Error(`Request timeout after ${this.timeout}ms`))
      }, this.timeout)

      req.on('response', (res) => {
        clearTimeout(timer)
        let data = ''

        res.on('data', (chunk) => {
          data += chunk.toString('utf8')
        })

        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              const err: OrionError = new Error(`ORION API error: ${res.statusCode}`)
              err.statusCode = res.statusCode
              err.path = path
              try {
                const parsed = JSON.parse(data)
                err.message = `ORION API error: ${parsed.error || res.statusCode}`
              } catch {
                // Keep default message
              }
              reject(err)
            } else {
              resolve(JSON.parse(data))
            }
          } catch (e) {
            reject(e)
          }
        })
      })

      req.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })

      if (bodyStr) {
        req.setHeader('Content-Type', 'application/json')
        req.write(bodyStr)
      }

      req.end()
    })
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health')
  }

  async models(): Promise<ModelsResponse> {
    return this.request<ModelsResponse>('GET', '/v1/models')
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('POST', '/v1/chat/completions', req)
  }

  async vision(req: VisionRequest): Promise<VisionResponse> {
    return this.request<VisionResponse>('POST', '/v1/vision', req)
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    return this.request<GenerateResponse>('POST', '/v1/generate', req)
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  setTimeout(ms: number): void {
    this.timeout = ms
  }
}
