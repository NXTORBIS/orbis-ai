/**
 * A small, strict XML parser for WebDAV responses (PROPFIND multistatus).
 *
 * Safe by construction: document type declarations are refused outright, so
 * no entity can ever be declared or expanded (no "billion laughs", no
 * external entities, no network or file access). Only the five predefined
 * entities and numeric character references are decoded. Input size,
 * element count and nesting depth are limited. Namespaces are resolved, so
 * `<D:href>`, `<d:href>` and `<href xmlns="DAV:">` are the same element.
 */

export interface XmlElement {
  /** Local name (without prefix). */
  name: string;
  /** Namespace URI ('' when none). */
  ns: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated text directly inside this element (CDATA included). */
  text: string;
}

export class XmlError extends Error {}

export const XML_MAX_BYTES = 16 * 1024 * 1024;
const MAX_ELEMENTS = 500_000;
const MAX_DEPTH = 64;

const PREDEFINED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);?/g, (m, ref: string) => {
    if (!m.endsWith(';')) throw new XmlError('Malformed character reference.');
    if (ref.startsWith('#x')) return codePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return codePoint(parseInt(ref.slice(1), 10));
    const v = PREDEFINED[ref];
    if (v === undefined) throw new XmlError(`Undeclared entity “&${ref};” (entities are not accepted).`);
    return v;
  });
}

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new XmlError('Invalid character reference.');
  return String.fromCodePoint(n);
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;

export function parseXml(input: string): XmlElement {
  if (input.length > XML_MAX_BYTES) throw new XmlError('The response is too large.');
  if (/<!DOCTYPE/i.test(input) || /<!ENTITY/i.test(input)) throw new XmlError('The response declares a document type or entities, which are not accepted.');
  let i = 0;
  let count = 0;
  type Frame = { el: XmlElement; qname: string; scope: Map<string, string> };
  const stack: Frame[] = [];
  let root: XmlElement | undefined;
  const rootScope = new Map<string, string>([['xml', 'http://www.w3.org/XML/1998/namespace']]);

  const pushText = (t: string) => {
    const top = stack[stack.length - 1];
    if (top) top.el.text += t;
    else if (t.trim()) throw new XmlError('Text outside the root element.');
  };

  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt < 0) {
      pushText(decodeEntities(input.slice(i)));
      break;
    }
    if (lt > i) pushText(decodeEntities(input.slice(i, lt)));
    if (input.startsWith('<?', lt)) {
      const end = input.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('Unterminated processing instruction.');
      i = end + 2;
      continue;
    }
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('Unterminated comment.');
      i = end + 3;
      continue;
    }
    if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('Unterminated CDATA section.');
      pushText(input.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (input.startsWith('<!', lt)) throw new XmlError('Markup declarations are not accepted.');
    const gt = findTagEnd(input, lt + 1);
    const raw = input.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      const qname = raw.slice(1).trim();
      const top = stack.pop();
      if (!top || top.qname !== qname) throw new XmlError(`Mismatched closing tag </${qname}>.`);
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m || !NAME.test(m[1]!)) throw new XmlError('Malformed tag.');
    const qname = m[1]!;
    const attrsRaw = parseAttributes(body.slice(qname.length));
    if (++count > MAX_ELEMENTS) throw new XmlError('The response has too many elements.');
    if (stack.length >= MAX_DEPTH) throw new XmlError('The response is nested too deeply.');
    const parentScope = stack[stack.length - 1]?.scope ?? rootScope;
    let scope = parentScope;
    const attrs: Record<string, string> = {};
    for (const [k, v] of attrsRaw) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) {
        if (scope === parentScope) scope = new Map(parentScope);
        scope.set(k === 'xmlns' ? '' : k.slice(6), v);
      } else attrs[k] = v;
    }
    const colon = qname.indexOf(':');
    const prefix = colon >= 0 ? qname.slice(0, colon) : '';
    const name = colon >= 0 ? qname.slice(colon + 1) : qname;
    const ns = scope.get(prefix);
    if (prefix && ns === undefined) throw new XmlError(`Undeclared namespace prefix “${prefix}”.`);
    const el: XmlElement = { name, ns: ns ?? '', attrs, children: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent) parent.el.children.push(el);
    else if (root) throw new XmlError('More than one root element.');
    else root = el;
    if (!selfClosing) stack.push({ el, qname, scope });
  }
  if (stack.length) throw new XmlError('The response ended inside an element.');
  if (!root) throw new XmlError('The response is empty.');
  return root;
}

function findTagEnd(s: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < s.length; j++) {
    const c = s[j]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return j;
    else if (c === '<') throw new XmlError('Malformed tag.');
  }
  throw new XmlError('Unterminated tag.');
}

function parseAttributes(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /\s*([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let pos = 0;
  while (pos < s.length) {
    if (/^\s*$/.test(s.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) throw new XmlError('Malformed attribute.');
    if (!NAME.test(m[1]!)) throw new XmlError('Malformed attribute name.');
    out.push([m[1]!, decodeEntities(m[3] ?? m[4] ?? '')]);
    pos = re.lastIndex;
  }
  return out;
}

export function childrenNamed(el: XmlElement, name: string, ns = 'DAV:'): XmlElement[] {
  return el.children.filter((c) => c.name === name && c.ns === ns);
}

export function firstChild(el: XmlElement | undefined, name: string, ns = 'DAV:'): XmlElement | undefined {
  return el?.children.find((c) => c.name === name && c.ns === ns);
}

/** All text below an element (for values such as href that may be split around comments or CDATA). */
export function textOf(el: XmlElement | undefined): string {
  if (!el) return '';
  return el.text + el.children.map(textOf).join('');
}
