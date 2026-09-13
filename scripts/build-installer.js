#!/usr/bin/env node
/**
 * Phase 18: Build Windows installer
 * Orchestrates Orbis + ORION packaging
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.dirname(__dirname)
const ORION_ROOT = path.join(ROOT, '..', 'orion')
const DIST_DIR = path.join(ROOT, 'dist')

console.log('[Installer] Starting build...')

try {
  // Step 1: Build Orbis Electron app
  console.log('[Installer] Building Orbis app...')
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })

  // Step 2: Build ORION Python executable
  console.log('[Installer] Building ORION runtime...')
  execSync('pyinstaller orion.spec', { cwd: ORION_ROOT, stdio: 'inherit' })

  // Step 3: Prepare runtime bundle
  console.log('[Installer] Preparing runtime bundle...')
  const runtimeDir = path.join(ROOT, 'orion-runtime')
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true })
  }

  // Copy ORION executable
  const orionExe = path.join(ORION_ROOT, 'dist', 'orion-api-server', 'orion-api-server.exe')
  if (fs.existsSync(orionExe)) {
    fs.cpSync(orionExe, path.join(runtimeDir, 'orion-api-server.exe'))
  }

  // Copy ORION configs and models (reference only, not bundled due to size)
  const configsDir = path.join(ORION_ROOT, 'configs')
  if (fs.existsSync(configsDir)) {
    fs.cpSync(configsDir, path.join(runtimeDir, 'configs'), { recursive: true })
  }

  // Step 4: Build NSIS installer
  console.log('[Installer] Building NSIS installer...')
  const nsis = 'C:\\Program Files (x86)\\NSIS\\makensis.exe'
  if (fs.existsSync(nsis)) {
    execSync(`"${nsis}" /DOUTDIR="${DIST_DIR}" build\\orbis-installer.nsi`, {
      cwd: ROOT,
      stdio: 'inherit',
    })
  } else {
    console.warn('[Installer] NSIS not found - installer not created')
    console.log('[Installer] Install NSIS from: https://nsis.sourceforge.io/')
  }

  console.log('[Installer] Build complete!')
  console.log(`[Installer] Output: ${DIST_DIR}`)
} catch (err) {
  console.error('[Installer] Build failed:', err.message)
  process.exit(1)
}
