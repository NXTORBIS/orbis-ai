/** Health checking and readiness logic for ORION. */

import type { OrionClient } from './client'

export interface WaitForReadyOptions {
  timeout?: number // milliseconds
  pollInterval?: number // milliseconds
  onProgress?: (message: string) => void
}

/**
 * Poll ORION's /health endpoint until it's ready or timeout.
 * Resolves true if ready, false if timeout/error.
 */
export async function waitForReady(
  client: OrionClient,
  options: WaitForReadyOptions = {},
): Promise<boolean> {
  const { timeout = 60_000, pollInterval = 2_000, onProgress } = options

  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const health = await client.health()
      if (health.status === 'ok') {
        onProgress?.('Orion is ready')
        return true
      }
      onProgress?.('Orion is starting...')
    } catch (err) {
      onProgress?.(`Waiting for Orion to start... (${Math.round((Date.now() - startTime) / 1000)}s)`)
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  return false
}

/**
 * Check if ORION is responsive (quick health check).
 */
export async function isHealthy(client: OrionClient, timeoutMs: number = 5_000): Promise<boolean> {
  try {
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), timeoutMs)
    const result = await client.health()
    clearTimeout(timer)
    return result.status === 'ok'
  } catch {
    return false
  }
}

/**
 * Get detailed backend availability from ORION.
 */
export async function getBackendStatus(
  client: OrionClient,
): Promise<Record<string, 'ready' | 'loading' | 'error' | 'unavailable'>> {
  try {
    const health = await client.health()
    return health.backends || {}
  } catch {
    return {}
  }
}

/**
 * Poll for a specific backend to become ready.
 */
export async function waitForBackend(
  client: OrionClient,
  backend: string,
  options: WaitForReadyOptions = {},
): Promise<boolean> {
  const { timeout = 30_000, pollInterval = 2_000 } = options

  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const status = await getBackendStatus(client)
      if (status[backend] === 'ready') {
        return true
      }
    } catch {
      // Continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  return false
}
