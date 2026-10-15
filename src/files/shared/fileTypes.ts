/** Extension groups used by search filters, icons and storage categories. Extensions are display hints, not proof of content. */
export const TYPE_GROUPS: Record<string, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'heif', 'avif', 'ico', 'raw', 'cr2', 'nef', 'arw', 'dng'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'opus', 'wma', 'aiff', 'aif'],
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages', 'epub', 'tex'],
  spreadsheet: ['xls', 'xlsx', 'ods', 'csv', 'tsv', 'numbers'],
  presentation: ['ppt', 'pptx', 'odp', 'key'],
  archive: ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'tbz2', 'txz', 'tbz', 'tzst', 'bzip2', 'zstd'],
  code: ['js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'php', 'sh', 'html', 'css', 'scss', 'vue', 'svelte', 'sql', 'lua', 'r', 'dart', 'scala', 'm', 'zig'],
  text: ['txt', 'md', 'markdown', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'csv', 'tsv', 'env', 'rst'],
  ebook: ['epub'],
  comic: ['cbz', 'cbr', 'cb7', 'cbt'],
  model3d: ['stl', 'obj', 'ply', 'gltf', 'glb'],
  font: ['ttf', 'otf', 'woff', 'woff2'],
};

export const EBOOK_EXTS = TYPE_GROUPS.ebook!;
export const COMIC_EXTS = TYPE_GROUPS.comic!;
export const MODEL3D_EXTS = TYPE_GROUPS.model3d!;
export const FONT_EXTS = TYPE_GROUPS.font!;
