import { createStore } from './store';

/**
 * What the window currently shows after fitting the layout to its size
 * (shared/customization/layout.ts). The saved layout is never changed by
 * fitting; panels the user shows explicitly in a small window are kept.
 */
export const fitState = createStore<{ adjustments: string[]; hidden: { sidebar: boolean; details: boolean }; arrangement?: string }>({ adjustments: [], hidden: { sidebar: false, details: false } });
