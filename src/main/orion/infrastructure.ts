/** Phases 8-11: Memory, Files, Feedback, Hardware - consolidated implementation. */

import os from 'node:os'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** Phase 8: Local session memory. */
export class SessionMemory {
  private memory: Map<string, string[]> = new Map()

  remember(sessionId: string, fact: string): void {
    if (!this.memory.has(sessionId)) {
      this.memory.set(sessionId, [])
    }
    this.memory.get(sessionId)!.push(fact)
  }

  recall(sessionId: string): string[] {
    return this.memory.get(sessionId) ?? []
  }

  clear(sessionId: string): void {
    this.memory.delete(sessionId)
  }
}

/** Phase 9: File management. */
export class FileManager {
  private workspaceDir: string

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir
  }

  async saveFile(name: string, content: string): Promise<void> {
    const path = join(this.workspaceDir, name)
    await fs.mkdir(this.workspaceDir, { recursive: true })
    await fs.writeFile(path, content, 'utf8')
  }

  async readFile(name: string): Promise<string> {
    const path = join(this.workspaceDir, name)
    return fs.readFile(path, 'utf8')
  }

  async listFiles(): Promise<string[]> {
    try {
      return await fs.readdir(this.workspaceDir)
    } catch {
      return []
    }
  }
}

/** Phase 10: Feedback collection. */
export interface Feedback {
  messageId: string
  rating: 'up' | 'down'
  comment?: string
  timestamp: number
}

export class FeedbackCollector {
  private feedbacks: Feedback[] = []

  addFeedback(messageId: string, rating: 'up' | 'down', comment?: string): void {
    this.feedbacks.push({
      messageId,
      rating,
      comment,
      timestamp: Date.now(),
    })
  }

  getFeedback(): Feedback[] {
    return [...this.feedbacks]
  }

  clearFeedback(): void {
    this.feedbacks = []
  }
}

/** Phase 11: Hardware detection. */
export interface HardwareInfo {
  cpuCores: number
  totalMemory: number
  availableMemory: number
  platform: string
  arch: string
  gpuAvailable: boolean
}

export function detectHardware(): HardwareInfo {
  const cpus = os.cpus()
  return {
    cpuCores: cpus.length,
    totalMemory: os.totalmem(),
    availableMemory: os.freemem(),
    platform: os.platform(),
    arch: os.arch(),
    gpuAvailable: false, // Would require native code to detect
  }
}

export function recommendConfig(hardware: HardwareInfo): {
  threads: number
  maxContextLength: number
  recommended: string
} {
  const cores = hardware.cpuCores
  const memoryGb = hardware.totalMemory / 1e9

  if (memoryGb < 8) {
    return {
      threads: Math.max(2, cores - 1),
      maxContextLength: 4096,
      recommended: 'Low-resource (laptop)',
    }
  }
  if (memoryGb < 16) {
    return {
      threads: Math.max(4, cores - 1),
      maxContextLength: 8192,
      recommended: 'Balanced (medium system)',
    }
  }
  return {
    threads: cores,
    maxContextLength: 16384,
    recommended: 'High-performance',
  }
}
