/** Phase 15: Security hardening - input validation, safe IPC. */

/**
 * Validate that URL is localhost-only.
 */
export function validateLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * Sanitize user input to prevent injection attacks.
 */
export function sanitizeInput(input: unknown): string {
  if (typeof input !== 'string') return ''

  return input
    .slice(0, 10000) // Limit length
    .replace(/[<>\"'&]/g, (c) => {
      const map: Record<string, string> = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }
      return map[c] || c
    })
}

/**
 * Validate file path is within expected directory.
 */
export function validatePath(filePath: string, allowedDir: string): boolean {
  const path = require('path')
  const resolved = path.resolve(filePath)
  const allowed = path.resolve(allowedDir)
  return resolved.startsWith(allowed)
}

/**
 * Security checklist for production.
 */
export function runSecurityChecklist(): { passed: boolean; issues: string[] } {
  const issues: string[] = []

  // Check ORION binding
  const ORION_BASE_URL = process.env.ORBIS_ORION_BASE_URL ?? 'http://127.0.0.1:8765/v1'
  if (!validateLocalhostUrl(ORION_BASE_URL)) {
    issues.push('ORION is not bound to localhost - security risk')
  }

  // Check no hardcoded secrets
  if (process.env.ORION_API_KEY || process.env.DEBUG_TOKEN) {
    issues.push('Hardcoded secrets found in environment')
  }

  return {
    passed: issues.length === 0,
    issues,
  }
}
