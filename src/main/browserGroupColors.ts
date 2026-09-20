/** Chromium's nine tab-group colors, and the hex value Orbis shows for each. Workspaces keep hex colors; the browser only has these names (`nearestGroupColor` in the Chromium capabilities maps the other way). */
export const GROUP_COLORS: Record<string, string> = {
  grey: '#9aa0a6',
  blue: '#60a5fa',
  red: '#ff4d6d',
  yellow: '#ffbe4d',
  green: '#3ee58a',
  pink: '#f472b6',
  purple: '#a78bfa',
  cyan: '#3fd8ff',
  orange: '#fb923c'
}

/** The hex value for one of Chromium's group colors (the value itself when it is already hex). */
export const hexOfGroupColor = (name: string): string => (/^#[0-9a-f]{6}$/i.test(name) ? name : (GROUP_COLORS[name] ?? GROUP_COLORS.grey))
