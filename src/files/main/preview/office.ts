import path from 'node:path';
import { decodeXml, readZipEntries } from '../media/metadata';

/**
 * Read-only text previews of Office Open XML and OpenDocument files. Only the
 * text, headings, tables, sheet cells and slide text are extracted — layout,
 * images and formatting are not rendered, and the preview says so. Nothing in
 * the document is executed (macros are never read).
 */

export type OfficeBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'para'; text: string }
  | { type: 'table'; rows: string[][] };

export interface OfficePreview {
  format: string;
  blocks?: OfficeBlock[];
  sheets?: Array<{ name: string; rows: string[][]; truncated: boolean }>;
  slides?: Array<{ index: number; paragraphs: string[] }>;
  truncated: boolean;
  note: string;
}

const MAX_BLOCKS = 2000;
const MAX_ROWS = 200;
const MAX_COLS = 40;

const text = (xml: string) => decodeXml(xml.replace(/<w:tab\/>|<text:tab\/>/g, '\t').replace(/<w:br\/>|<text:line-break\/>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+$/g, '');

function docxBlocks(xml: string): { blocks: OfficeBlock[]; truncated: boolean } {
  const blocks: OfficeBlock[] = [];
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && blocks.length < MAX_BLOCKS) {
    const chunk = m[0];
    if (chunk.startsWith('<w:tbl>')) {
      const rows = [...chunk.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].slice(0, MAX_ROWS).map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].slice(0, MAX_COLS).map((c) => [...c[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => decodeXml(t[1]!)).join('')));
      blocks.push({ type: 'table', rows });
      continue;
    }
    const t = [...chunk.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((x) => (x[0] === '<w:tab/>' ? '\t' : x[0] === '<w:br/>' ? '\n' : decodeXml(x[1]!))).join('');
    const style = /<w:pStyle w:val="([^"]+)"/.exec(chunk)?.[1] ?? '';
    const h = /^(?:Heading|heading|Titre|berschrift)\s?(\d)$/.exec(style) ?? (style === 'Title' ? ['', '1'] : null);
    if (!t.trim()) continue;
    blocks.push(h ? { type: 'heading', level: Number(h[1]), text: t } : { type: 'para', text: t });
  }
  return { blocks, truncated: blocks.length >= MAX_BLOCKS };
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function xlsx(p: string): Promise<OfficePreview> {
  const files = await readZipEntries(p, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n), 16 * 1024 * 1024);
  const wb = files.get('xl/workbook.xml') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels') ?? '';
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!)).join(''));
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  const sheets: NonNullable<OfficePreview['sheets']> = [];
  for (const s of [...wb.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]+)"/g)].slice(0, 10)) {
    const t = (target.get(s[2]!) ?? '').replace(/^\/?xl\//, '');
    const xml = files.get(`xl/${t}`);
    if (!xml) continue;
    const rows: string[][] = [];
    const rowMatches = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
    for (const r of rowMatches.slice(0, MAX_ROWS)) {
      const row: string[] = [];
      for (const c of r[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!;
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
        const type = /\bt="(\w+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
        const inl = /<is>([\s\S]*?)<\/is>/.exec(c[2] ?? '')?.[1];
        const value = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? text(inl ?? '') : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : decodeXml(v ?? '');
        const idx = ref ? colIndex(ref) : row.length;
        if (idx >= MAX_COLS) continue;
        while (row.length < idx) row.push('');
        row[idx] = value;
      }
      rows.push(row);
    }
    sheets.push({ name: decodeXml(s[1]!), rows, truncated: rowMatches.length > MAX_ROWS });
  }
  return { format: 'Excel workbook', sheets, truncated: sheets.some((s) => s.truncated), note: 'Cell values only (formulas show their last calculated result). Formatting, charts and images are not shown.' };
}

async function pptx(p: string): Promise<OfficePreview> {
  const files = await readZipEntries(p, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const slides = [...files.entries()]
    .map(([name, xml]) => ({ index: Number(/slide(\d+)\.xml$/.exec(name)![1]), paragraphs: [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => [...m[1]!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1]!)).join('')).filter((x) => x.trim()) }))
    .sort((a, b) => a.index - b.index);
  return { format: 'PowerPoint presentation', slides: slides.slice(0, 300), truncated: slides.length > 300, note: 'Slide text only. Layout, images and animations are not shown.' };
}

async function odf(p: string, ext: string): Promise<OfficePreview> {
  const files = await readZipEntries(p, new Set(['content.xml']), 32 * 1024 * 1024);
  const xml = files.get('content.xml') ?? '';
  const format = ext === 'odt' ? 'OpenDocument text' : ext === 'ods' ? 'OpenDocument spreadsheet' : 'OpenDocument presentation';
  if (ext === 'ods') {
    const sheets = [...xml.matchAll(/<table:table\b[^>]*table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/g)].slice(0, 10).map((t) => {
      const rowsAll = [...t[2]!.matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)];
      const rows = rowsAll.slice(0, MAX_ROWS).map((r) => {
        const out: string[] = [];
        for (const c of r[1]!.matchAll(/<table:table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)) {
          const rep = Math.min(Number(/table:number-columns-repeated="(\d+)"/.exec(c[1]!)?.[1] ?? 1), MAX_COLS);
          const v = [...(c[2] ?? '').matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((x) => text(x[1]!)).join('\n');
          for (let i = 0; i < rep && out.length < MAX_COLS; i++) out.push(v);
        }
        while (out.length && !out[out.length - 1]) out.pop();
        return out;
      });
      while (rows.length && !rows[rows.length - 1]!.length) rows.pop();
      return { name: decodeXml(t[1]!), rows, truncated: rowsAll.length > MAX_ROWS };
    });
    return { format, sheets, truncated: sheets.some((s) => s.truncated), note: 'Cell values only. Formatting and charts are not shown.' };
  }
  if (ext === 'odp') {
    const slides = [...xml.matchAll(/<draw:page\b[\s\S]*?<\/draw:page>/g)].map((m, i) => ({ index: i + 1, paragraphs: [...m[0].matchAll(/<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/g)].map((x) => text(x[1]!)).filter((x) => x.trim()) }));
    return { format, slides: slides.slice(0, 300), truncated: slides.length > 300, note: 'Slide text only. Layout and images are not shown.' };
  }
  const blocks: OfficeBlock[] = [];
  for (const m of xml.matchAll(/<text:h(\b[^>]*)>([\s\S]*?)<\/text:h>|<text:p\b[^>]*>([\s\S]*?)<\/text:p>|<table:table\b[\s\S]*?<\/table:table>/g)) {
    if (blocks.length >= MAX_BLOCKS) break;
    if (m[0].startsWith('<table:table')) {
      const rows = [...m[0].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)].slice(0, MAX_ROWS).map((r) => [...r[1]!.matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)].slice(0, MAX_COLS).map((c) => text(c[1]!)));
      blocks.push({ type: 'table', rows });
    } else if (m[2] !== undefined) blocks.push({ type: 'heading', level: Number(/text:outline-level="(\d)"/.exec(m[1] ?? '')?.[1] ?? 1), text: text(m[2]) });
    else if (m[3] !== undefined && text(m[3]).trim()) blocks.push({ type: 'para', text: text(m[3]) });
  }
  return { format, blocks, truncated: blocks.length >= MAX_BLOCKS, note: 'Text, headings and tables only. Layout and images are not shown.' };
}

export async function officePreview(p: string): Promise<OfficePreview> {
  const ext = path.extname(p).slice(1).toLowerCase();
  if (ext === 'docx' || ext === 'docm') {
    const files = await readZipEntries(p, new Set(['word/document.xml']), 32 * 1024 * 1024);
    const xml = files.get('word/document.xml');
    if (!xml) throw new Error('This file does not contain a Word document body.');
    const { blocks, truncated } = docxBlocks(xml);
    return { format: 'Word document', blocks, truncated, note: 'Text, headings and tables only. Layout, images and tracked changes are not shown.' };
  }
  if (ext === 'xlsx' || ext === 'xlsm') return xlsx(p);
  if (ext === 'pptx' || ext === 'pptm') return pptx(p);
  if (ext === 'odt' || ext === 'ods' || ext === 'odp') return odf(p, ext);
  throw new Error('Not a supported document format.');
}
