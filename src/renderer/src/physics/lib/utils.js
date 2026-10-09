/** Joins class names, the way the original's `cn` does. Orbis has no Tailwind merge, and none is needed here. */
export function cn(...parts) {
  return parts.flat(Infinity).filter(Boolean).join(' ')
}
export default cn
