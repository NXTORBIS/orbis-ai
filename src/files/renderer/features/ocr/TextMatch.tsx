import { Icon } from '../../ui/Icon';
import type { FileEntry } from '../../../shared/model';

/** Search results found by the text recognized in an image: a "text in image" badge and the matching excerpt. */
export function TextMatch({ m, compact }: { m: NonNullable<FileEntry['textMatch']>; compact?: boolean }) {
  const tip = m.snippet ? `Text in image: “${m.snippet}”` : 'Found by the text in this image';
  return (
    <span className="text-match" title={tip}>
      <span className="text-match-badge"><Icon name="imageText" size={11} />{compact ? null : <span>text in image</span>}</span>
      {!compact && m.snippet && <span className="text-match-snippet">{m.snippet}</span>}
      {compact && <span className="sr-only">text in image: {m.snippet}</span>}
    </span>
  );
}
