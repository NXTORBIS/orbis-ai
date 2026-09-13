/** Phase 12: Process monitoring, crash detection, recovery. */

import { OrionManager } from './manager'
import { OrionClient } from './client'
import type { OrionState } from './types'

export class ProcessMonitor {
  private manager: OrionManager
  private client: OrionClient
  private healthCheckInterval: NodeJS.Timer | null = null
  private lastHealthy = true

  constructor(manager: OrionManager, client: OrionClient) {
    this.manager = manager
    this.client = client
  }

  /**
   * Start monitoring ORION health.
   * Detects crashes and auto-restarts if possible.
   */
  startMonitoring(intervalMs: number = 5000): void {
    if (this.healthCheckInterval) return

    this.healthCheckInterval = setInterval(async () => {
      try {
        const state = this.manager.getState()

        // If not running or crashed, check if we should restart
        if (state === 'crashed' || state === 'failed') {
          console.log('[ProcessMonitor] Detected crash/failure, attempting restart')
          try {
            await this.manager.restart()
          } catch (err) {
            console.error('[ProcessMonitor] Restart failed:', err)
          }
          return
        }

        // If running, verify health
        if (state === 'ready') {
          try {
            const health = await this.client.health()
            const healthy = health.status === 'ok'

            if (!healthy && this.lastHealthy) {
              console.warn('[ProcessMonitor] Health check failed')
              this.lastHealthy = false
            } else if (healthy && !this.lastHealthy) {
              console.log('[ProcessMonitor] Health recovered')
              this.lastHealthy = true
            }
          } catch (err) {
            if (this.lastHealthy) {
              console.warn('[ProcessMonitor] Health check error:', err)
              this.lastHealthy = false
            }
          }
        }
      } catch (err) {
        console.error('[ProcessMonitor] Monitoring error:', err)
      }
    }, intervalMs)
  }

  /**
   * Stop monitoring.
   */
  stopMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval as NodeJS.Timeout)
      this.healthCheckInterval = null
    }
  }

  /**
   * Get diagnostic info for troubleshooting.
   */
  getDiagnostics(): {
    state: OrionState
    isHealthy: boolean
    logs: string[]
    uptime: number
  } {
    return {
      state: this.manager.getState(),
      isHealthy: this.lastHealthy,
      logs: this.manager.getLogs(20),
      uptime: this.manager.getStatus().uptime,
    }
  }
}
