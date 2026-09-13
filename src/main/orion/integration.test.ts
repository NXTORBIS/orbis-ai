/** Integration test for Orbis ↔ ORION communication. */

import { OrionClient } from './client'
import { waitForReady } from './health'

/**
 * Test that ORION is running and responsive.
 * Run this from Orbis main process to validate integration.
 */
export async function testOrionIntegration(): Promise<{ ok: boolean; message: string }> {
  const client = new OrionClient()

  try {
    // Test 1: Health check
    console.log('[TEST] Checking ORION health...')
    const health = await client.health()
    if (health.status !== 'ok') {
      return { ok: false, message: `Health check failed: ${JSON.stringify(health)}` }
    }
    console.log('[TEST] ✓ Health check passed')

    // Test 2: Models endpoint
    console.log('[TEST] Listing available models...')
    const models = await client.models()
    console.log('[TEST] ✓ Models:', models.data?.map((m) => m.id).join(', '))

    // Test 3: Chat request
    console.log('[TEST] Sending test chat message...')
    const chatResp = await client.chat({
      messages: [{ role: 'user', content: 'Say "Hello from ORION"' }],
      session: 'test-session',
    })
    if (!chatResp.choices?.[0]?.message?.content) {
      return { ok: false, message: `Chat request failed: ${JSON.stringify(chatResp)}` }
    }
    console.log('[TEST] ✓ Chat response:', chatResp.choices[0].message.content)

    return { ok: true, message: 'ORION integration test passed' }
  } catch (err) {
    return {
      ok: false,
      message: `Integration test failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Wait for ORION to be ready before starting Orbis UI.
 */
export async function ensureOrionReady(timeoutMs: number = 60_000): Promise<boolean> {
  const client = new OrionClient()
  return waitForReady(client, { timeout: timeoutMs, onProgress: (msg) => console.log(`[ORION] ${msg}`) })
}
