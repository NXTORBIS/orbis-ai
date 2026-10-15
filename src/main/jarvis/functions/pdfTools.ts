// @ts-nocheck -- ported unchanged from the Jarvis project's backend function of the same name; only the import line differs.
import { createClientFromRequest } from './local'
import { PDFDocument, degrees } from 'pdf-lib';

const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const decode = (dataUrl: string) => {
  const match = /^data:application\/pdf(?:;[^,]*)?;base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!match) return null;
  const binary = atob(match[1].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const parseRange = (spec: unknown, total: number) => {
  const text = String(spec ?? '').trim();
  if (!text) return Array.from({ length: total }, (_, i) => i);
  const picked: number[] = [];
  const bound = (value: string, fallback: number) => {
    if (value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  for (const raw of text.split(',')) {
    const piece = raw.trim();
    if (!piece) continue;
    if (piece.includes('-')) {
      const [a, b] = piece.split('-');
      const start = Math.max(1, bound(a, 1));
      const end = Math.min(total, bound(b, total));
      for (let page = start; page <= end; page += 1) picked.push(page - 1);
    } else {
      const page = Number(piece);
      if (Number.isFinite(page) && page >= 1 && page <= total) picked.push(page - 1);
    }
  }
  return [...new Set(picked)].filter((i) => i >= 0 && i < total).sort((x, y) => x - y);
};

const loadDocument = async (dataUrl: string) => {
  const bytes = decode(dataUrl);
  if (!bytes) throw new Error('One of the files was not a readable PDF.');
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return { doc, bytes };
  } catch (error) {
    const message = String(error?.message ?? '');
    if (message.toLowerCase().includes('encrypt') || message.toLowerCase().includes('password')) {
      throw new Error('That PDF is password-protected — unlock it first, then merge.');
    }
    throw new Error('One of the files could not be read as a PDF.');
  }
};

const respondWithPdf = (bytes: Uint8Array, pages: number, fileName: string, note: string) => {
  const pdfBase64 = toBase64(bytes);
  return Response.json({ ok: true, fileName, pages, bytes: bytes.length, pdfBase64, note });
};

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const operation = String(body?.operation ?? '').trim();
    const files = Array.isArray(body?.files) ? body.files : [];

    if (operation === 'selftest') {
      const first = await PDFDocument.create();
      first.addPage([200, 200]);
      first.addPage([200, 200]);
      const second = await PDFDocument.create();
      second.addPage([300, 300]);

      const merged = await PDFDocument.create();
      for (const bytes of [await first.save(), await second.save()]) {
        const doc = await PDFDocument.load(bytes);
        const copied = await merged.copyPages(doc, doc.getPageIndices());
        copied.forEach((page) => merged.addPage(page));
      }
      const mergedBytes = await merged.save();
      const mergedDoc = await PDFDocument.load(mergedBytes);

      const extracted = await PDFDocument.create();
      const taken = await extracted.copyPages(mergedDoc, parseRange('1-2', mergedDoc.getPageCount()));
      taken.forEach((page) => extracted.addPage(page));
      const extractedBytes = await extracted.save();

      const rotated = await PDFDocument.load(mergedBytes);
      rotated.getPage(0).setRotation(degrees(90));
      const rotatedBytes = await rotated.save();
      const rotatedCheck = await PDFDocument.load(rotatedBytes);

      return Response.json({
        ok: true,
        operation,
        merge: { pages: mergedDoc.getPageCount(), bytes: mergedBytes.length },
        extract: { pages: (await PDFDocument.load(extractedBytes)).getPageCount() },
        rotate: {
          angle: rotatedCheck.getPage(0).getRotation().angle,
          bytes: rotatedBytes.length,
        },
      });
    }

    if (!files.length) return Response.json({ error: 'Add at least one PDF first.' }, { status: 400 });
    if (files.length > 12) return Response.json({ error: 'Please work with up to 12 files at a time.' }, { status: 400 });

    const totalBytes = files.reduce((sum, file) => sum + Math.round(String(file?.dataUrl ?? '').length * 0.75), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return Response.json({ error: 'Those files add up to more than 20 MB — split the job into smaller batches.' }, { status: 413 });
    }

    if (operation === 'info') {
      const details = [];
      for (const file of files) {
        try {
          const { doc, bytes } = await loadDocument(file.dataUrl);
          details.push({ name: file.name ?? 'document.pdf', pages: doc.getPageCount(), bytes: bytes.length, title: doc.getTitle() ?? '' });
        } catch (error) {
          details.push({ name: file.name ?? 'document.pdf', pages: 0, bytes: 0, error: error?.message ?? 'Could not read this file' });
        }
      }
      return Response.json({ ok: true, operation, files: details });
    }

    if (operation === 'merge') {
      const merged = await PDFDocument.create();
      for (const file of files) {
        const { doc } = await loadDocument(file.dataUrl);
        const copied = await merged.copyPages(doc, doc.getPageIndices());
        copied.forEach((page) => merged.addPage(page));
      }
      const bytes = await merged.save();
      return respondWithPdf(bytes, merged.getPageCount(), 'merged.pdf', `Combined ${files.length} files`);
    }

    const index = Number.isFinite(Number(body?.index)) ? Number(body.index) : 0;
    const target = files[index] ?? files[0];

    if (operation === 'extract') {
      const { doc } = await loadDocument(target.dataUrl);
      const indices = parseRange(body?.pages, doc.getPageCount());
      if (!indices.length) return Response.json({ error: 'That page range does not match the document.' }, { status: 400 });
      const out = await PDFDocument.create();
      const copied = await out.copyPages(doc, indices);
      copied.forEach((page) => out.addPage(page));
      const bytes = await out.save();
      return respondWithPdf(bytes, out.getPageCount(), 'extracted.pdf', `Pages ${indices.map((i) => i + 1).join(', ')}`);
    }

    if (operation === 'rotate') {
      const angle = [90, 180, 270].includes(Number(body?.angle)) ? Number(body.angle) : 90;
      const { doc } = await loadDocument(target.dataUrl);
      const indices = parseRange(body?.pages, doc.getPageCount());
      if (!indices.length) return Response.json({ error: 'That page range does not match the document.' }, { status: 400 });
      indices.forEach((i) => {
        const page = doc.getPage(i);
        const current = page.getRotation().angle ?? 0;
        page.setRotation(degrees(((current + angle) % 360 + 360) % 360));
      });
      const bytes = await doc.save();
      return respondWithPdf(bytes, doc.getPageCount(), 'rotated.pdf', `Turned ${indices.length} page${indices.length === 1 ? '' : 's'} by ${angle}°`);
    }

    return Response.json({ error: 'Unknown operation.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error?.message ?? 'The PDF job failed.' }, { status: 500 });
  }
}