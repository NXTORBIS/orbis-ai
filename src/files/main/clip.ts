import { clipboard, nativeImage, type NativeImage } from 'electron';

/** Electron 44 made the main-process clipboard asynchronous; these keep the call sites readable. */
export async function clipText(): Promise<string> {
  return (await clipboard.readText().catch(() => '')) || '';
}

export async function clipFormats(): Promise<string[]> {
  try {
    return [...new Set((await clipboard.read()).flatMap((i) => i.types))];
  } catch {
    return [];
  }
}

export async function clipImage(): Promise<NativeImage> {
  try {
    for (const item of await clipboard.read()) {
      if (!item.types.includes('image/png')) continue;
      const blob = (await item.getType('image/png')) as Blob;
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    }
  } catch {
    /* treated as no image */
  }
  return nativeImage.createEmpty();
}

/** The raw bytes of one clipboard format, or null when the clipboard does not offer it. */
export async function clipFormat(format: string): Promise<Buffer | null> {
  try {
    for (const item of await clipboard.read()) {
      if (!item.types.includes(format)) continue;
      const blob = (await item.getType(format)) as Blob;
      return Buffer.from(await blob.arrayBuffer());
    }
  } catch {
    /* not offered */
  }
  return null;
}

export async function writeClipText(text: string): Promise<void> {
  await clipboard.writeText(text);
}

export async function writeClipImage(img: NativeImage): Promise<void> {
  const ClipItem = (globalThis as unknown as { ClipboardItem: new (d: Record<string, Blob>) => Electron.ClipboardItem }).ClipboardItem;
  await clipboard.write([new ClipItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]);
}
