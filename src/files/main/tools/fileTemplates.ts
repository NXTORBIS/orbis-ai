import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { FileTemplate } from '../../shared/templates';

/** Variable substitution in template content. */
function expand(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

const BUILT_IN_TEMPLATES: FileTemplate[] = [
  {
    id: 'html-page', name: 'HTML Page', ext: 'html', category: 'web',
    description: 'A basic HTML5 page with a viewport meta tag.',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{name}}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; }
  </style>
</head>
<body>
  <h1>{{name}}</h1>
</body>
</html>`,
  },
  {
    id: 'react-component', name: 'React Component', ext: 'tsx', category: 'code',
    description: 'A React functional component with TypeScript.',
    content: `import React from 'react';

interface {{name}}Props {
  // props
}

export function {{name}}({ }: {{name}}Props) {
  return (
    <div>
      <h1>{{name}}</h1>
    </div>
  );
}
`,
  },
  {
    id: 'ts-module', name: 'TypeScript Module', ext: 'ts', category: 'code',
    description: 'An empty TypeScript module with an export.',
    content: `/**
 * {{name}} module.
 * Created {{date}}
 */

export function main(): void {
  // TODO: implement
}
`,
  },
  {
    id: 'python-script', name: 'Python Script', ext: 'py', category: 'code',
    description: 'A Python script with a main guard.',
    content: `#!/usr/bin/env python3
"""{{name}} — created {{date}}."""


def main():
    pass


if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'css-file', name: 'CSS Stylesheet', ext: 'css', category: 'web',
    description: 'A CSS file with a reset and base styles.',
    content: `/* {{name}} — created {{date}} */

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}
`,
  },
  {
    id: 'json-config', name: 'JSON Config', ext: 'json', category: 'config',
    description: 'An empty JSON configuration file.',
    content: `{
  "name": "{{name}}",
  "version": "1.0.0"
}
`,
  },
  {
    id: 'yaml-config', name: 'YAML Config', ext: 'yaml', category: 'config',
    description: 'A YAML configuration file.',
    content: `# {{name}} — created {{date}}

name: {{name}}
version: "1.0.0"

settings:
  enabled: true
`,
  },
  {
    id: 'markdown-doc', name: 'Markdown Document', ext: 'md', category: 'document',
    description: 'A Markdown document with a title and sections.',
    content: `# {{name}}

> Created {{date}} by {{author}}

## Overview

## Details

## References
`,
  },
  {
    id: 'gitignore', name: '.gitignore', ext: '', category: 'config',
    description: 'A .gitignore with common patterns.',
    content: `# Dependencies
node_modules/
vendor/

# Build
dist/
build/
*.o
*.pyc
__pycache__/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local
`,
  },
  {
    id: 'dockerfile', name: 'Dockerfile', ext: '', category: 'config',
    description: 'A multi-stage Dockerfile template.',
    content: `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/index.js"]
`,
  },
  {
    id: 'shell-script', name: 'Shell Script', ext: 'sh', category: 'code',
    description: 'A Bash script with error handling.',
    content: `#!/usr/bin/env bash
set -euo pipefail

# {{name}} — created {{date}}

main() {
  echo "Hello from {{name}}"
}

main "$@"
`,
  },
  {
    id: 'sql-file', name: 'SQL File', ext: 'sql', category: 'data',
    description: 'A SQL file with a CREATE TABLE example.',
    content: `-- {{name}} — created {{date}}

CREATE TABLE IF NOT EXISTS example (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`,
  },
  {
    id: 'csv-headers', name: 'CSV with Headers', ext: 'csv', category: 'data',
    description: 'A CSV file with sample column headers.',
    content: `id,name,email,created_date
`,
  },
  {
    id: 'package-json', name: 'package.json', ext: 'json', category: 'config',
    description: 'A Node.js package.json with basic fields.',
    content: `{
  "name": "{{name}}",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "echo \\"Error: no test specified\\" && exit 1"
  },
  "keywords": [],
  "author": "{{author}}",
  "license": "MIT"
}
`,
  },
];

export interface TemplateCatalog {
  getKv<T>(key: string, fallback: T): T;
  setKv(key: string, value: unknown): void;
}

/** List all templates (built-in + user-created). */
export function listTemplates(catalog: TemplateCatalog): FileTemplate[] {
  const custom = catalog.getKv<FileTemplate[]>('file-templates', []);
  return [...BUILT_IN_TEMPLATES, ...custom.map((t) => ({ ...t, custom: true }))];
}

/** Create a file from a template. */
export async function createFromTemplateById(
  dir: string,
  templateId: string,
  fileName: string,
  catalog: TemplateCatalog,
): Promise<string> {
  const all = listTemplates(catalog);
  const tpl = all.find((t) => t.id === templateId);
  if (!tpl) throw makeError('not_found', 'template.create', { message: `Template "${templateId}" not found.` });

  const now = new Date();
  const vars: Record<string, string> = {
    name: path.parse(fileName).name,
    date: now.toISOString().slice(0, 10),
    author: process.env.USER ?? process.env.USERNAME ?? 'User',
    year: String(now.getFullYear()),
  };

  const content = expand(tpl.content, vars);
  const target = path.join(dir, fileName);

  // Check for existing file
  try {
    await fsp.access(target);
    throw makeError('already_exists', 'template.create', { target, message: `"${fileName}" already exists.` });
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT' && (err as { shape?: unknown }).shape) throw err;
  }

  await fsp.writeFile(target, content, { flag: 'wx' }).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'template.create', target, 'no'));
  });
  return target;
}

/** Save a custom template to KV store. */
export function saveCustomTemplate(catalog: TemplateCatalog, template: Omit<FileTemplate, 'custom'>): FileTemplate {
  const custom = catalog.getKv<FileTemplate[]>('file-templates', []);
  const existing = custom.findIndex((t) => t.id === template.id);
  const entry = { ...template, custom: true as const };
  if (existing >= 0) {
    custom[existing] = entry;
  } else {
    custom.push(entry);
  }
  catalog.setKv('file-templates', custom);
  return entry;
}

/** Delete a custom template. */
export function deleteCustomTemplate(catalog: TemplateCatalog, id: string): boolean {
  const custom = catalog.getKv<FileTemplate[]>('file-templates', []);
  const idx = custom.findIndex((t) => t.id === id);
  if (idx < 0) return false;
  custom.splice(idx, 1);
  catalog.setKv('file-templates', custom);
  return true;
}
