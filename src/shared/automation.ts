import type { AutomationState } from './types'

/** Real progress in words, e.g. "17/50 results processed", or the stop condition before anything is done. */
export function automationProgress(a: AutomationState): string {
  const unit = (count: number): string => (count === 1 ? a.unit.replace(/s$/i, '') : a.unit)
  if (a.total) return `${Math.min(a.completed, a.total)}/${a.total} ${unit(a.total)} processed`
  if (a.completed > 0) return `${a.completed} ${unit(a.completed)} processed`
  return `stops ${a.stopWhen}`
}

export function automationActive(a: AutomationState | undefined): boolean {
  return a?.status === 'running' || a?.status === 'waiting-approval'
}
