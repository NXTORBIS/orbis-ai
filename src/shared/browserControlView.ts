/** A structured control-layer log entry as the window receives it (already redacted). */
export interface ControlLogEntryView {
  at: number
  phase: 'observation' | 'decision' | 'command' | 'execution' | 'result' | 'verification' | 'error' | 'recovery'
  capability: string
  source: 'user' | 'orion' | 'automation'
  runId?: string
  detail: unknown
}
