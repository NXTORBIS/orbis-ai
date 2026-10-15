
import { call } from '../api';
import { closeDialog, toastError } from '../state/app';
import { openAnnotator } from '../state/screenshot';
import { Dialog } from '../ui/components';
import type { CaptureResult, CaptureSource } from '../../shared/screenshot';

/**
 * Lets the user pick a window to capture. Shown by the 'screenshot.window'
 * command after it lists available sources through 'screenshot:sources'.
 */
export function ScreenshotSourcePickerDialog({ sources }: { sources: CaptureSource[] }) {
  const pick = async (source: CaptureSource) => {
    closeDialog();
    try {
      const result = await call<CaptureResult>('screenshot:capture', { mode: 'window', sourceId: source.id });
      openAnnotator(result);
    } catch (err) {
      toastError(err, 'Screenshot');
    }
  };

  return (
    <Dialog title="Choose a window to capture" width={520} onClose={closeDialog}>
      <div className="choice-list">
        {sources.map((s) => (
          <button key={s.id} type="button" className="choice" onClick={() => void pick(s)}>
            {s.thumbnail && <img src={s.thumbnail} alt="" style={{ width: 48, height: 36, objectFit: 'contain', borderRadius: 4, marginRight: 8 }} />}
            <strong>{s.name}</strong>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
