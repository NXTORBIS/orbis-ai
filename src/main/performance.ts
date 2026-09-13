/** Phase 16: Performance measurement and metrics. */

export interface PerformanceMetrics {
  orbisStartupTime: number // ms
  orionStartupTime: number // ms
  modelLoadTime: number // ms
  firstTokenLatency: number // ms
  generationThroughput: number // tokens/sec
  ramUsage: number // bytes
  cpuUsage: number // percent
}

export class PerformanceMonitor {
  private startTimes: Map<string, number> = new Map()
  private metrics: Partial<PerformanceMetrics> = {}

  /**
   * Mark the start of an operation.
   */
  startTimer(label: string): void {
    this.startTimes.set(label, Date.now())
  }

  /**
   * End a timer and record the duration.
   */
  endTimer(label: string): number {
    const start = this.startTimes.get(label)
    if (!start) return 0

    const duration = Date.now() - start
    this.startTimes.delete(label)

    switch (label) {
      case 'orbis-startup':
        this.metrics.orbisStartupTime = duration
        break
      case 'orion-startup':
        this.metrics.orionStartupTime = duration
        break
      case 'model-load':
        this.metrics.modelLoadTime = duration
        break
      case 'first-token':
        this.metrics.firstTokenLatency = duration
        break
    }

    return duration
  }

  /**
   * Record throughput metric.
   */
  recordThroughput(tokensGenerated: number, durationSec: number): void {
    this.metrics.generationThroughput = tokensGenerated / durationSec
  }

  /**
   * Get all metrics.
   */
  getMetrics(): Partial<PerformanceMetrics> {
    return { ...this.metrics }
  }

  /**
   * Get formatted performance report.
   */
  getReport(): string {
    const m = this.metrics
    const lines = [
      '=== Performance Metrics ===',
      `Orbis startup: ${m.orbisStartupTime || '?'}ms`,
      `ORION startup: ${m.orionStartupTime || '?'}ms`,
      `Model load: ${m.modelLoadTime || '?'}ms`,
      `First token latency: ${m.firstTokenLatency || '?'}ms`,
      `Generation throughput: ${m.generationThroughput?.toFixed(2) || '?'} tokens/sec`,
    ]
    return lines.join('\n')
  }
}
