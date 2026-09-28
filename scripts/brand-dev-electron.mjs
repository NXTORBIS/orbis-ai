// Puts the Orbis logo on the Electron executable that `npm run dev` launches.
//
// A packaged Orbis gets its icon from its own executable, which electron-builder brands at build time. An unpackaged
// one runs node_modules/electron/dist/electron.exe, and Windows takes the taskbar and Alt-Tab icon from that file --
// not from the window -- so Orbis appeared as Electron's atom no matter what the window was given. This brands that
// executable the same way, from the same icon, and keeps the original beside it so it can always be put back.
//
// Safe to run repeatedly: the backup is only made once, and the icon is always written from the pristine copy.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit'

const EXE = 'node_modules/electron/dist/electron.exe'
const BACKUP = `${EXE}.orig`
const ICON = 'build/icon.ico'

if (!existsSync(EXE)) {
  console.log('no unpackaged electron here; nothing to brand')
  process.exit(0)
}
if (!existsSync(ICON)) throw new Error(`${ICON} is missing`)
if (!existsSync(BACKUP)) copyFileSync(EXE, BACKUP)

// Always from the untouched copy, so branding twice cannot compound.
const exe = NtExecutable.from(readFileSync(BACKUP))
const res = NtExecutableResource.from(exe)
const icon = Data.IconFile.from(readFileSync(ICON))
// Group 1, US English: the identifiers Windows looks under for an executable's main icon.
Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icon.icons.map((i) => i.data))
res.outputResource(exe)
writeFileSync(EXE, Buffer.from(exe.generate()))
console.log(`branded ${EXE} with ${ICON} (${icon.icons.length} sizes); original kept at ${BACKUP}`)
