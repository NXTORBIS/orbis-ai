/** Home sections: which are switched off, and whether Home has anything to show below the hero. */

export const HOME_SECTION_LABELS = { quickAccess: 'Quick access', recent: 'Recent', drives: 'Drives', operations: 'Active operations', collections: 'Collections' } as const;
export type HomeSectionKey = keyof typeof HOME_SECTION_LABELS;
export const HOME_SECTION_KEYS = Object.keys(HOME_SECTION_LABELS) as HomeSectionKey[];

export interface HomeSectionState {
  /** Sections the user switched off. */
  hidden: HomeSectionKey[];
  /** True when at least one section is on and has something to show. */
  shown: boolean;
}

/**
 * Quick access, Recent and Drives always show (with an empty note when needed); Active
 * operations and Collections take no room while there is nothing in them. When nothing is
 * shown, Home must still offer a way back (an empty state), even if not every section is off.
 */
export function homeSectionState(sections: Record<HomeSectionKey, boolean>, activeOperations: number, collections: number): HomeSectionState {
  const hidden = HOME_SECTION_KEYS.filter((k) => !sections[k]);
  const shown = sections.quickAccess || sections.recent || sections.drives || (sections.operations && activeOperations > 0) || (sections.collections && collections > 0);
  return { hidden, shown };
}
