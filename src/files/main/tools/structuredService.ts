import fsp from 'node:fs/promises';
import path from 'node:path';
import { looksBinary } from '../fs/FileSystemService';
import { makeError } from '../../shared/errors';
import type { NodeType, TreeNode, StructuredParseResult } from '../../shared/structured';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_NODES = 50_000;

function nodeType(v: unknown): NodeType {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'object': return 'object';
    default: return 'string';
  }
}

function countDescendants(node: TreeNode): number {
  if (!node.children) return 0;
  let c = node.children.length;
  for (const ch of node.children) c += countDescendants(ch);
  return c;
}

let nodeCount = 0;

function buildTree(key: string, pathPrefix: string, value: unknown): TreeNode {
  nodeCount++;
  if (nodeCount > MAX_NODES) {
    return { key, path: pathPrefix, type: 'string', value: '[truncated]' };
  }
  const t = nodeType(value);
  const node: TreeNode = { key, path: pathPrefix, type: t };

  if (t === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    node.children = Object.keys(obj).map((k) => {
      const childPath = pathPrefix ? `${pathPrefix}.${k}` : k;
      return buildTree(k, childPath, obj[k]);
    });
    node.childCount = countDescendants(node);
  } else if (t === 'array' && Array.isArray(value)) {
    node.children = value.map((item, i) => {
      const childPath = `${pathPrefix}[${i}]`;
      return buildTree(String(i), childPath, item);
    });
    node.childCount = countDescendants(node);
  } else {
    node.value = value as string | number | boolean | null;
  }
  return node;
}

function parseJson(text: string): { root: TreeNode; truncated: boolean } {
  const parsed = JSON.parse(text) as unknown;
  nodeCount = 0;
  const root = buildTree('root', '', parsed);
  return { root, truncated: nodeCount > MAX_NODES };
}

function parseYaml(text: string): { root: TreeNode; truncated: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('js-yaml') as { load: (s: string) => unknown };
  const parsed = yaml.load(text) as unknown;
  nodeCount = 0;
  const root = buildTree('root', '', parsed ?? null);
  return { root, truncated: nodeCount > MAX_NODES };
}

/* ---- Minimal XML parser (no dependencies) ---- */

interface XmlEl {
  tag: string;
  attrs: Record<string, string>;
  children: Array<XmlEl | string>;
}

function parseXmlDoc(xml: string): XmlEl {
  // Strip XML declaration and comments
  const s = xml.replace(/<\?xml[^?]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const stack: XmlEl[] = [];
  let current: XmlEl = { tag: 'document', attrs: {}, children: [] };

  const tagRe = /<\/?([a-zA-Z_][\w.:_-]*)([^>]*?)(\/?)\s*>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(s))) {
    // Text before this tag
    if (m.index > last) {
      const txt = s.slice(last, m.index).trim();
      if (txt) current.children.push(txt);
    }
    last = tagRe.lastIndex;

    const isClose = s[m.index + 1] === '/';
    const selfClose = m[3] === '/';
    const tag = m[1]!;

    if (isClose) {
      // closing tag: pop
      if (stack.length > 0) {
        current = stack.pop()!;
      }
    } else {
      // Parse attributes
      const attrs: Record<string, string> = {};
      const attrRe = /([a-zA-Z_][\w.:_-]*)=(?:"([^"]*)"|'([^']*)')/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(m[2]!))) {
        attrs[am[1]!] = am[2] ?? am[3] ?? '';
      }
      const el: XmlEl = { tag, attrs, children: [] };
      current.children.push(el);
      if (!selfClose) {
        stack.push(current);
        current = el;
      }
    }
  }
  // Trailing text
  if (last < s.length) {
    const txt = s.slice(last).trim();
    if (txt) current.children.push(txt);
  }
  return current;
}

function xmlToTree(el: XmlEl | string, key: string, pathPrefix: string): TreeNode {
  nodeCount++;
  if (nodeCount > MAX_NODES) {
    return { key, path: pathPrefix, type: 'string', value: '[truncated]' };
  }
  if (typeof el === 'string') {
    return { key, path: pathPrefix, type: 'string', value: el };
  }
  const node: TreeNode = { key: el.tag, path: pathPrefix || el.tag, type: 'object' };
  const children: TreeNode[] = [];

  // Attributes as children
  for (const [ak, av] of Object.entries(el.attrs)) {
    nodeCount++;
    children.push({ key: `@${ak}`, path: `${node.path}.@${ak}`, type: 'string', value: av });
  }

  // Child elements
  const tagCounts: Record<string, number> = {};
  for (const ch of el.children) {
    if (typeof ch === 'string') {
      if (el.children.length === 1 && Object.keys(el.attrs).length === 0) {
        // Single text child with no attrs: make this a leaf
        node.type = 'string';
        node.value = ch;
        return node;
      }
      children.push(xmlToTree(ch, '#text', `${node.path}.#text`));
    } else {
      const idx = tagCounts[ch.tag] ?? 0;
      tagCounts[ch.tag] = idx + 1;
      const childPath = `${node.path}.${ch.tag}[${idx}]`;
      children.push(xmlToTree(ch, ch.tag, childPath));
    }
  }

  if (children.length > 0) {
    node.children = children;
    node.childCount = countDescendants(node);
  }
  return node;
}

function parseXml(text: string): { root: TreeNode; truncated: boolean } {
  const doc = parseXmlDoc(text);
  nodeCount = 0;
  const first = doc.children[0];
  const root = doc.children.length === 1 && first !== undefined && typeof first !== 'string'
    ? xmlToTree(first, first.tag, first.tag)
    : xmlToTree(doc, 'document', 'document');
  return { root, truncated: nodeCount > MAX_NODES };
}

/* ---- Minimal TOML parser ---- */

function parseToml(text: string): { root: TreeNode; truncated: boolean } {
  const result: Record<string, unknown> = {};
  let current: Record<string, unknown> = result;
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Table header
    const tableMatch = /^\[([^\]]+)\]$/.exec(line);
    if (tableMatch) {
      const keys = tableMatch[1]!.split('.').map((k) => k.trim().replace(/^["']|["']$/g, ''));
      current = result;
      for (const k of keys) {
        if (!(k in current) || typeof current[k] !== 'object' || current[k] === null) {
          (current as Record<string, unknown>)[k] = {};
        }
        current = current[k] as Record<string, unknown>;
      }
      continue;
    }

    // Array of tables
    const arrayMatch = /^\[\[([^\]]+)\]\]$/.exec(line);
    if (arrayMatch) {
      const keys = arrayMatch[1]!.split('.').map((k) => k.trim().replace(/^["']|["']$/g, ''));
      let target: Record<string, unknown> = result;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]!;
        if (!(k in target)) (target as Record<string, unknown>)[k] = {};
        target = target[k] as Record<string, unknown>;
      }
      const lastKey = keys[keys.length - 1]!;
      if (!Array.isArray(target[lastKey])) target[lastKey] = [];
      const arr = target[lastKey] as Record<string, unknown>[];
      const newObj: Record<string, unknown> = {};
      arr.push(newObj);
      current = newObj;
      continue;
    }

    // Key-value pair
    const kvMatch = /^([^=]+?)\s*=\s*(.+)$/.exec(line);
    if (kvMatch) {
      const k = kvMatch[1]!.trim().replace(/^["']|["']$/g, '');
      const rawVal = kvMatch[2]!.trim();
      current[k] = parseTomlValue(rawVal);
    }
  }

  nodeCount = 0;
  const root = buildTree('root', '', result);
  return { root, truncated: nodeCount > MAX_NODES };
}

function parseTomlValue(val: string): unknown {
  // Strings
  if (/^"""/.test(val)) return val.slice(3, val.lastIndexOf('"""'));
  if (/^"/.test(val)) return val.slice(1, val.lastIndexOf('"'));
  if (/^'''/.test(val)) return val.slice(3, val.lastIndexOf("'''"));
  if (/^'/.test(val)) return val.slice(1, val.lastIndexOf("'"));
  // Booleans
  if (val === 'true') return true;
  if (val === 'false') return false;
  // Numbers
  if (/^[+-]?\d[\d_]*$/.test(val)) return parseInt(val.replace(/_/g, ''), 10);
  if (/^[+-]?\d[\d_]*\.[\d_]*([eE][+-]?\d+)?$/.test(val)) return parseFloat(val.replace(/_/g, ''));
  if (val === 'inf' || val === '+inf') return Infinity;
  if (val === '-inf') return -Infinity;
  if (val === 'nan' || val === '+nan' || val === '-nan') return NaN;
  // Inline array
  if (val.startsWith('[')) {
    try {
      return JSON.parse(val.replace(/'/g, '"')) as unknown;
    } catch {
      return val;
    }
  }
  // Inline table
  if (val.startsWith('{')) {
    try {
      // Simple conversion: {k = v, ...} -> JSON
      const json = val.replace(/(\w+)\s*=/g, '"$1":').replace(/'/g, '"');
      return JSON.parse(json) as unknown;
    } catch {
      return val;
    }
  }
  // Date/datetime
  return val;
}

function detectFormat(filePath: string): 'json' | 'yaml' | 'xml' | 'toml' {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (ext === 'json' || ext === 'jsonc' || ext === 'json5') return 'json';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'xml' || ext === 'svg' || ext === 'plist' || ext === 'xhtml' || ext === 'html' || ext === 'htm') return 'xml';
  if (ext === 'toml') return 'toml';
  return 'json'; // fallback
}

export async function parseStructured(filePath: string): Promise<StructuredParseResult> {
  const stat = await fsp.stat(filePath).catch((err) => {
    throw makeError('not_found', 'structured.parse', { target: filePath, message: (err as Error).message });
  });

  if (!stat.isFile()) throw makeError('is_a_directory', 'structured.parse', { target: filePath });

  const bytesToRead = Math.min(stat.size, MAX_BYTES);
  const buf = Buffer.alloc(bytesToRead);
  const fh = await fsp.open(filePath, 'r');
  try {
    await fh.read(buf, 0, bytesToRead, 0);
  } finally {
    await fh.close();
  }

  if (looksBinary(buf)) {
    throw makeError('validation', 'structured.parse', { message: 'File appears to be binary.' });
  }

  const text = buf.toString('utf8');
  const format = detectFormat(filePath);
  const truncatedInput = stat.size > MAX_BYTES;

  try {
    let result: { root: TreeNode; truncated: boolean };
    switch (format) {
      case 'json':
        result = parseJson(text);
        break;
      case 'yaml':
        result = parseYaml(text);
        break;
      case 'xml':
        result = parseXml(text);
        break;
      case 'toml':
        result = parseToml(text);
        break;
    }
    return {
      format,
      root: result.root,
      truncated: truncatedInput || result.truncated,
      bytesRead: bytesToRead,
    };
  } catch (err) {
    // Return partial result with error
    return {
      format,
      root: { key: 'root', path: '', type: 'object', children: [] },
      truncated: truncatedInput,
      bytesRead: bytesToRead,
      error: (err as Error).message,
    };
  }
}
