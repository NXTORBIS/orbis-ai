import { useId, useState } from 'react';
import { closeDialog } from '../../state/app';
import { useStore } from '../../state/store';
import { ocr, setRunOptions } from '../../state/ocr';
import { startOperation } from '../../actions';
import { runCommand } from '../../commands';
import { Button, Dialog, Segmented, TextField, Toggle } from '../../ui/components';
import { FolderPicker } from '../views/common';
import { DEFAULT_MARKDOWN_NAME, markdownOutputName, ocrKindOf, type OcrExtractParams } from '../../../shared/ocr';

/**
 * "Extract text to files": where the recognized text goes (a .txt next to each
 * file, or one Markdown file), searchable PDF copies, subfolders and languages.
 * The work is one 'ocr-extract' operation (pause, stop, undo to the Trash).
 */

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function OcrExtractDialog({ paths, dir, folders }: { paths: string[]; dir: string; folders: number }) {
  const options = useStore(ocr, (s) => s.options);
  const languages = useStore(ocr, (s) => s.languages);
  const [output, setOutput] = useState<'txt' | 'markdown'>('txt');
  const [mdName, setMdName] = useState(DEFAULT_MARKDOWN_NAME.replace(/\.md$/, ''));
  const [mdDir, setMdDir] = useState(dir);
  const [searchablePdf, setSearchablePdf] = useState(false);
  const [subfolders, setSubfolders] = useState(false);
  const [busy, setBusy] = useState(false);
  const langId = useId();
  const files = paths.length - folders;
  const pdfs = paths.filter((p) => ocrKindOf(base(p)) === 'pdf').length;
  const what = folders && !files
    ? folders === 1 ? `the images and PDFs in “${base(paths[0]!)}”` : `the images and PDFs in ${folders} folders`
    : `${files} ${files === 1 ? (pdfs === 1 ? 'PDF' : 'image') : 'files'}${folders ? ` and the images and PDFs in ${folders} folder${folders === 1 ? '' : 's'}` : ''}`;
  const name = markdownOutputName(mdName);
  const valid = output === 'txt' || name.ok;

  const start = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const params: OcrExtractParams = {
      output,
      markdownName: output === 'markdown' && name.ok ? name.name : undefined,
      searchablePdf,
      includeSubfolders: subfolders,
      options,
    };
    const rec = await startOperation({ type: 'ocr-extract', sources: paths, destination: output === 'markdown' ? mdDir : undefined, params, origin: 'ocr-extract' });
    setBusy(false);
    if (rec) closeDialog();
  };

  return (
    <Dialog
      title="Extract text to files"
      onClose={closeDialog}
      width={540}
      className="ocr-extract"
      footer={
        <>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="primary" icon="ocrExtract" disabled={!valid || busy} onClick={() => void start()}>Extract text</Button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <p className="ocr-dialog-lead">Recognizes the text of {what} on this computer.</p>
        <div className="field">
          <span className="field-label">Save the text as</span>
          <Segmented label="Save the text as" value={output} onChange={setOutput} options={[{ value: 'txt', label: 'A .txt next to each file' }, { value: 'markdown', label: 'One Markdown file' }]} />
        </div>
        {output === 'markdown' && (
          <div className="ocr-md">
            <TextField label="File name" value={mdName} onChange={(e) => setMdName(e.target.value)} error={name.ok ? undefined : name.error} hint={name.ok ? `${name.name}, with a heading per file` : undefined} spellCheck={false} />
            <FolderPicker label="Save in" value={mdDir} onChange={setMdDir} id="ocr-md-dir" />
          </div>
        )}
        <Toggle id="ocr-searchable" label="Also save searchable PDFs" description="For images and scanned PDFs: “name (OCR).pdf” with the recognized text as an invisible layer you can search, select and copy. PDFs that already have text are left as they are." checked={searchablePdf} onChange={setSearchablePdf} />
        {folders > 0 && <Toggle id="ocr-subfolders" label="Include subfolders" description="Also reads the images and PDFs in folders inside the chosen folders (hidden items and links are left out)." checked={subfolders} onChange={setSubfolders} />}
        <fieldset className="ocr-lang-list">
          <legend id={langId}>Languages</legend>
          {languages.map((l) => {
            const on = options.langs.includes(l.code);
            return (
              <label key={l.code} className="check">
                <input type="checkbox" checked={on} disabled={on && options.langs.length === 1} onChange={() => setRunOptions({ langs: on ? options.langs.filter((x) => x !== l.code) : [...options.langs, l.code].slice(0, 6) })} />
                <span>{l.name}</span>
              </label>
            );
          })}
          <button type="button" className="link-btn" onClick={() => { closeDialog(); void runCommand('ocr.settings'); }}>Add languages…</button>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={options.detectOrientation} onChange={(e) => setRunOptions({ detectOrientation: e.target.checked })} />
          <span>Turn upside-down or sideways pages (slower for poor scans)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={options.pdfTextPages === 'recognize'} onChange={(e) => setRunOptions({ pdfTextPages: e.target.checked ? 'recognize' : 'use-text' })} />
          <span>Recognize PDF pages that already have text (otherwise their text is used)</span>
        </label>
        <p className="ocr-dialog-note">Runs as an operation you can pause or stop. Existing files are never replaced: a taken name gets a number. Undo moves the new files to the Trash.</p>
      </form>
    </Dialog>
  );
}
