/**
 * Whether Orbis may hand a file to the computer to open.
 *
 * A download's name and its ending are chosen by the web page, not by Orbis. "Download finished" offers an **Open**
 * button, and handing that file straight to the system means a page can get `invoice.pdf.exe` run with one click on a
 * notification -- the user believing they are opening an invoice. The rest of Orbis already refuses this: opening a
 * saved page checks the ending before it opens anything.
 *
 * So: a file that would *run* is never opened. It is shown in its folder instead, which is the useful thing and also
 * the honest one -- the file is still there, and opening it is then a deliberate act in the user's own file manager.
 *
 * The list is of things Windows, macOS and Linux will execute or interpret, including the quiet ones: `.lnk` and
 * `.url` point somewhere else, `.scr` and `.msc` look like data, `.iso` and `.vhd` mount as a drive, and `.scf`,
 * `.library-ms` and `.settingcontent-ms` have all been used in the wild to run a command from a double-click.
 */

/** Endings Orbis will not open. Lower case, without the dot. */
export const RUNNABLE_ENDINGS: readonly string[] = [
  // Windows programs and installers
  'exe', 'com', 'scr', 'pif', 'cpl', 'msc', 'msi', 'msp', 'mst', 'msix', 'appx', 'dll', 'ocx', 'sys', 'drv', 'efi',
  // Windows scripts
  'bat', 'cmd', 'vb', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ws', 'ps1', 'ps1xml', 'ps2', 'psc1', 'psc2', 'psd1', 'psm1', 'hta', 'reg', 'inf', 'scf', 'job',
  // Points somewhere else, or opens something that does
  'lnk', 'url', 'website', 'library-ms', 'settingcontent-ms', 'search-ms', 'appref-ms', 'desktop',
  // Mounts as a drive, so what is inside is one click further on
  'iso', 'img', 'vhd', 'vhdx', 'dmg',
  // Other platforms
  'app', 'command', 'workflow', 'action', 'osascript', 'scpt', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'bin', 'out', 'appimage', 'deb', 'rpm', 'pkg', 'elf', 'so',
  // Runtimes that will happily run what is handed to them
  'jar', 'jnlp', 'py', 'pyc', 'pyw', 'rb', 'pl', 'php', 'lua', 'mjs', 'cjs', 'wsc', 'cgi',
  // Documents that carry code
  'docm', 'xlsm', 'xlsb', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppam', 'sldm', 'ade', 'adp', 'mdb', 'mde', 'accdb', 'accde', 'ahk', 'chm', 'hlp', 'crt', 'cer', 'pfx', 'p12', 'gadget', 'theme', 'prf', 'its', 'mad', 'maf', 'mag', 'mam', 'maq', 'mar', 'mas', 'mat', 'mau', 'mav', 'maw'
]

const RUNNABLE = new Set(RUNNABLE_ENDINGS)

/** The ending of a name, lower case and without the dot. Empty when there is none. */
export function endingOf(path: string): string {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  // A leading dot is the whole name (".gitignore"), not an ending.
  if (dot <= 0) return ''
  return name
    .slice(dot + 1)
    .toLowerCase()
    .trim()
}

/**
 * Why this file must not be opened, in words to show somebody. Null when opening it is fine.
 *
 * A name with no ending at all is refused too: on Windows that is often a file whose real ending was hidden, and
 * there is nothing to check.
 */
export function whyNotOpenable(path: string): string | null {
  if (typeof path !== 'string' || path.trim() === '') return 'There is no file to open.'
  // A trailing space or dot is stripped by Windows when it opens the file, so "thing.exe." is "thing.exe".
  const tidy = path.replace(/[. ]+$/, '')
  const ending = endingOf(tidy)
  if (ending === '') return 'Orbis will not open a file with no file type, because there is no way to tell what it would do. It has been shown in its folder instead.'
  if (RUNNABLE.has(ending)) return `Orbis will not open a .${ending} file, because opening it would run it. It has been shown in its folder instead.`
  return null
}

/** The plain question, for anywhere that only needs yes or no. */
export const mayOpen = (path: string): boolean => whyNotOpenable(path) === null
