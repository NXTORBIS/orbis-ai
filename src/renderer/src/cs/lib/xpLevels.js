// Level progression used by both the backend XP engine and the frontend.
// Levels continue indefinitely — there is no level cap.

// Total XP required to REACH a given level (level 1 = 0).
export function xpForLevel(level) {
  if (level <= 1) return 0;
  let total = 0;
  for (let i = 1; i < level; i++) total += 100 + (i - 1) * 50;
  return total;
}

// Derive level info from a total XP value.
export function levelFromXp(xp) {
  xp = Math.max(0, xp || 0);
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const curMin = xpForLevel(level);
  const nextMin = xpForLevel(level + 1);
  const span = nextMin - curMin;
  const intoLevel = xp - curMin;
  return {
    level,
    totalXp: xp,
    curMin,
    nextMin,
    xpToNext: Math.max(0, nextMin - xp),
    progress: span > 0 ? Math.min(100, Math.round((intoLevel / span) * 100)) : 100,
  };
}

// A flavour title for a level — cycles through ranks that grow with prestige.
const RANKS = [
  'Initiate', 'Novice', 'Apprentice', 'Adept', 'Coder', 'Developer',
  'Engineer', 'Specialist', 'Architect', 'Veteran', 'Expert', 'Master',
  'Grandmaster', 'Legend', 'Mythic', 'Ascendant', 'Transcendent',
];
export function titleForLevel(level) {
  if (level <= RANKS.length) return RANKS[level - 1];
  const cycle = RANKS.length;
  const tier = Math.floor((level - 1) / cycle);
  const name = RANKS[(level - 1) % cycle];
  return `${name} ${'★'.repeat(tier)}`;
}

// Difficulty multipliers applied to base XP rewards.
export const DIFFICULTY_MULTIPLIER = {
  beginner: 1,
  intermediate: 1.25,
  advanced: 1.5,
  expert: 2,
  standard: 1,
};