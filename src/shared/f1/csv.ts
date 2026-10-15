/**
 * Tables to CSV text, with the quoting that makes the file readable by a spreadsheet.
 * Missing values are written as empty cells, never as 0.
 */
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const cell = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  // A leading BOM so spreadsheets read UTF-8 names (accents) correctly.
  return '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** A file name safe on every system: letters, digits, dot, dash and underscore only. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned.slice(0, 80) || 'export'
}
