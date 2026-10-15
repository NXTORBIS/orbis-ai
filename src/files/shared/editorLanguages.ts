/**
 * Language modes of the built-in editor (shared by the window, the editor
 * bundle and tests). No dependencies, so the editor bundle stays small.
 */

export interface EditorLanguage { id: string; label: string; exts: string[]; names?: string[] }

/** Language modes, by extension or whole file name (lower-case). `plain` is the fallback. */
export const EDITOR_LANGUAGES: EditorLanguage[] = [
  { id: 'plain', label: 'Plain text', exts: ['txt', 'text', 'log', 'csv', 'tsv', 'srt', 'vtt', 'nfo'] },
  { id: 'markdown', label: 'Markdown', exts: ['md', 'markdown', 'mdown', 'mkd', 'mdx'] },
  { id: 'javascript', label: 'JavaScript', exts: ['js', 'mjs', 'cjs', 'jsx'] },
  { id: 'typescript', label: 'TypeScript', exts: ['ts', 'mts', 'cts', 'tsx'] },
  { id: 'json', label: 'JSON', exts: ['json', 'jsonc', 'json5', 'webmanifest', 'geojson', 'har'], names: ['.babelrc', '.eslintrc', '.prettierrc', 'tsconfig.json', 'package-lock.json'] },
  { id: 'css', label: 'CSS', exts: ['css', 'scss', 'less', 'pcss'] },
  { id: 'html', label: 'HTML', exts: ['html', 'htm', 'xhtml', 'vue', 'svelte'] },
  { id: 'xml', label: 'XML', exts: ['xml', 'svg', 'xsl', 'xslt', 'xsd', 'plist', 'csproj', 'vbproj', 'xaml', 'rss', 'atom', 'kml', 'gpx', 'opf', 'fodt'] },
  { id: 'python', label: 'Python', exts: ['py', 'pyw', 'pyi'] },
  { id: 'yaml', label: 'YAML', exts: ['yml', 'yaml'], names: ['.clang-format'] },
  { id: 'shell', label: 'Shell', exts: ['sh', 'bash', 'zsh', 'ksh', 'command'], names: ['.bashrc', '.bash_profile', '.profile', '.zshrc', '.zprofile', '.bash_aliases', '.envrc'] },
  { id: 'sql', label: 'SQL', exts: ['sql', 'psql', 'ddl'] },
  { id: 'rust', label: 'Rust', exts: ['rs'] },
  { id: 'go', label: 'Go', exts: ['go'] },
  { id: 'java', label: 'Java', exts: ['java'] },
  { id: 'cpp', label: 'C / C++', exts: ['c', 'h', 'cpp', 'cc', 'cxx', 'c++', 'hpp', 'hh', 'hxx', 'h++', 'ino', 'ipp', 'inl'] },
  { id: 'toml', label: 'TOML', exts: ['toml'], names: ['cargo.lock', 'pipfile'] },
  { id: 'ini', label: 'INI / properties', exts: ['ini', 'cfg', 'conf', 'properties', 'env', 'editorconfig', 'gitconfig', 'desktop', 'service'], names: ['.env', '.gitconfig', '.editorconfig', '.npmrc'] },
  { id: 'dockerfile', label: 'Dockerfile', exts: ['dockerfile'], names: ['dockerfile', 'containerfile'] },
  { id: 'diff', label: 'Diff / patch', exts: ['diff', 'patch'] },
];

export function languageById(id: string): EditorLanguage {
  return EDITOR_LANGUAGES.find((l) => l.id === id) ?? EDITOR_LANGUAGES[0]!;
}

/** The language mode for a file name (by its full name first, then its extension). */
export function languageForName(fileName: string): EditorLanguage {
  const name = fileName.toLowerCase();
  const byName = EDITOR_LANGUAGES.find((l) => l.names?.includes(name));
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : dot === 0 ? name.slice(1) : '';
  if (name.startsWith('dockerfile')) return languageById('dockerfile');
  return EDITOR_LANGUAGES.find((l) => l.exts.includes(ext)) ?? EDITOR_LANGUAGES[0]!;
}

/** Whether word counts are useful (prose rather than code). */
export const countsWords = (languageId: string): boolean => languageId === 'plain' || languageId === 'markdown';

