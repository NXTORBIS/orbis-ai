/** Phase 14: Version management and compatibility checking. */

export interface VersionInfo {
  orbis: string
  orion: string
  api: string
  model: string
}

export interface VersionCheckResult {
  isCompatible: boolean
  message: string
  updateAvailable: boolean
  updateUrl?: string
}

const CURRENT_VERSIONS: VersionInfo = {
  orbis: '1.0.0',
  orion: '1.0.0',
  api: 'v1',
  model: '1.0.0', // Qwen3-14B-Q4_K_M
}

/**
 * Get current application versions.
 */
export function getVersions(): VersionInfo {
  return { ...CURRENT_VERSIONS }
}

/**
 * Check version compatibility.
 */
export function checkCompatibility(orionVersion: string, apiVersion: string): VersionCheckResult {
  // Simple compatibility check: same major version
  const orionMinor = parseInt(orionVersion.split('.')[1])

  if (CURRENT_VERSIONS.api !== apiVersion) {
    return {
      isCompatible: false,
      message: `API version mismatch: Orbis expects ${CURRENT_VERSIONS.api}, ORION is ${apiVersion}`,
      updateAvailable: true,
      updateUrl: 'https://github.com/nxtorbis/orbis/releases',
    }
  }

  if (orionMinor < 0) {
    return {
      isCompatible: false,
      message: `ORION version ${orionVersion} is too old (requires >= 1.0.0)`,
      updateAvailable: true,
      updateUrl: 'https://github.com/nxtorbis/orion/releases',
    }
  }

  return {
    isCompatible: true,
    message: 'All versions compatible',
    updateAvailable: false,
  }
}

/**
 * Format version for display.
 */
export function formatVersion(version: string): string {
  return `v${version}`
}
