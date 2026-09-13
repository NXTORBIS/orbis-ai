/** Phase 5: Chat integration - route ORION requests through existing UI. */

import { ipcMain, BrowserWindow } from 'electron'
import { OrionClient } from './client'
import { OrionManager } from './manager'
import type { ChatMessage, StreamEvent } from '../../shared/types'

export class ChatIntegration {
  private client: OrionClient
  private manager: OrionManager
  private activeStreams: Map<string, AbortController> = new Map()

  constructor(client: OrionClient, manager: OrionManager) {
    this.client = client
    this.manager = manager
  }

  /**
   * Register chat handlers that route through ORION for local models.
   * Called once during app initialization.
   */
  registerHandlers(_mainWindow: BrowserWindow | null): void {
    ipcMain.handle(
      'chat:sendToOrion',
      async (
        _event,
        requestId: string,
        conversationId: string,
        messages: ChatMessage[],
        systemPrompt: string,
      ) => {
        const sender = _event.sender
        const streamId = requestId

        const emit = (event: StreamEvent): void => {
          if (!sender.isDestroyed()) {
            sender.send('chat:event', requestId, event)
          }
        }

        // Check if ORION is ready
        if (!(await this.manager.isReady())) {
          return emit({ type: 'error', message: 'ORION is not ready. Please wait for startup.' })
        }

        const controller = new AbortController()
        this.activeStreams.set(streamId, controller)

        try {
          // Stream ORION response
          emit({ type: 'start', model: 'orion-local' })

          const apiMessages = this.toApiMessages(messages, systemPrompt)
          const response = await this.client.chat({
            messages: apiMessages,
            session: conversationId,
            max_tokens: 2048,
          })

          const choice = response.choices?.[0]?.message?.content
          if (!choice) {
            return emit({ type: 'error', message: 'ORION returned empty response' })
          }

          // Emit the full response as a single delta (ORION doesn't stream)
          emit({
            type: 'delta',
            content: choice,
            reasoning: response.orion?.intent ? `[${response.orion.intent}]` : undefined,
          })

          emit({
            type: 'done',
            model: 'orion-local',
            truncated: response.choices?.[0]?.finish_reason === 'length',
          })
        } catch (err) {
          if ((err as any)?.code !== 'ABORT_ERR') {
            emit({
              type: 'error',
              message: err instanceof Error ? err.message : 'ORION request failed',
            })
          }
        } finally {
          this.activeStreams.delete(streamId)
        }
      },
    )

    ipcMain.handle('chat:abort', (_event, requestId: string) => {
      const controller = this.activeStreams.get(requestId)
      if (controller) {
        controller.abort()
        this.activeStreams.delete(requestId)
      }
    })
  }

  /**
   * Convert chat messages to ORION API format.
   */
  private toApiMessages(messages: ChatMessage[], _systemPrompt: string): ChatMessage[] {
    const out: ChatMessage[] = []

    // System prompt is handled separately by ORION API
    for (const m of messages) {
      out.push(m)
    }

    return out
  }
}
