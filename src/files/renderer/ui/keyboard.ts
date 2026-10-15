/**
 * Keyboard helpers shared by components. Pure functions are kept separate from
 * the DOM wiring so they can be tested without a browser.
 */

/** The radio a key moves to in a group of `count` enabled radios (WAI-ARIA radio group), or -1. */
export function nextRadioIndex(key: string, index: number, count: number): number {
  if (count <= 0 || index < 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}

const SELF_ACTIVATING_ROLES = new Set(['button', 'link', 'switch', 'radio', 'checkbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab']);

/**
 * True when a focused control activates itself with this key (Enter or Space on a button,
 * link, switch, radio, tab…), so global single-key shortcuts such as Enter = Open must leave
 * the key alone. Otherwise the shortcut's preventDefault swallows the button press.
 */
export function controlHandlesKey(key: string, el: { tagName: string; getAttribute(name: string): string | null } | null): boolean {
  if (!el || !['Enter', 'Shift+Enter', 'Space'].includes(key)) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'SUMMARY' || (tag === 'A' && el.getAttribute('href') !== null)) return true;
  return SELF_ACTIVATING_ROLES.has(el.getAttribute('role') ?? '');
}

/**
 * Keys a shortcut-capture field leaves to the browser: plain Tab and Shift+Tab move focus
 * (on to the Add button, or back), so a shortcut can be assigned with the keyboard alone.
 * Ctrl+Tab and other modified Tabs are still captured as shortcuts.
 */
export function passesThroughCapture(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey;
}

/**
 * Arrow keys for every radio group built from buttons (segmented controls, preset and
 * template pickers): Left/Up and Right/Down select the previous/next enabled option,
 * Home/End the first/last, and focus follows the selection. Installed once per window.
 */
export function installRadioGroupKeys(target: Document = document): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target as HTMLElement | null;
    if (!t || t.tagName !== 'BUTTON' || t.getAttribute('role') !== 'radio') return;
    const group = t.closest('[role="radiogroup"]');
    if (!group) return;
    const radios = [...group.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].filter((r) => !r.disabled && r.closest('[role="radiogroup"]') === group);
    const next = nextRadioIndex(e.key, radios.indexOf(t as HTMLButtonElement), radios.length);
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = radios[next]!;
    r.focus();
    if (r.getAttribute('aria-checked') !== 'true') r.click();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
