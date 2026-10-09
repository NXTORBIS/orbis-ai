export const CATEGORIES = [
  { id: 'alkali-metal', label: 'Alkali Metal', color: '#f97316', glow: 'rgba(249,115,22,0.55)' },
  { id: 'alkaline-earth-metal', label: 'Alkaline Earth Metal', color: '#eab308', glow: 'rgba(234,179,8,0.55)' },
  { id: 'transition-metal', label: 'Transition Metal', color: '#38bdf8', glow: 'rgba(56,189,248,0.55)' },
  { id: 'post-transition-metal', label: 'Post-Transition Metal', color: '#818cf8', glow: 'rgba(129,140,248,0.55)' },
  { id: 'metalloid', label: 'Metalloid', color: '#2dd4bf', glow: 'rgba(45,212,191,0.55)' },
  { id: 'reactive-nonmetal', label: 'Reactive Nonmetal', color: '#4ade80', glow: 'rgba(74,222,128,0.55)' },
  { id: 'noble-gas', label: 'Noble Gas', color: '#c084fc', glow: 'rgba(192,132,252,0.55)' },
  { id: 'halogen', label: 'Halogen', color: '#22d3ee', glow: 'rgba(34,211,238,0.55)' },
  { id: 'lanthanide', label: 'Lanthanide', color: '#f472b6', glow: 'rgba(244,114,182,0.55)' },
  { id: 'actinide', label: 'Actinide', color: '#fb7185', glow: 'rgba(251,113,133,0.55)' },
  { id: 'unknown', label: 'Unknown Properties', color: '#94a3b8', glow: 'rgba(148,163,184,0.55)' },
];

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}