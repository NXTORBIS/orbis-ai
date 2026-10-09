import { sortingAlgorithms } from './algorithms/sorting.js';
import { searchingAlgorithms } from './algorithms/searching.js';
import { arrayAlgorithms } from './algorithms/arrays.js';
import { linkedListAlgorithms } from './algorithms/linkedlist.js';
import { stackAlgorithms } from './algorithms/stack.js';
import { queueAlgorithms } from './algorithms/queue.js';
import { treeAlgorithms } from './algorithms/trees.js';
import { graphAlgorithms } from './algorithms/graphs.js';
import { pathfindingAlgorithms } from './algorithms/pathfinding.js';
import { dpAlgorithms } from './algorithms/dp.js';
import { stringAlgorithms } from './algorithms/strings.js';
import { recursionAlgorithms } from './algorithms/recursion.js';
import { backtrackingAlgorithms } from './algorithms/backtracking.js';
import { greedyAlgorithms, hashingAlgorithms } from './algorithms/greedy.js';
import { graphAdvancedAlgorithms } from './algorithms/graphAdvanced.js';
import { pathfindingAdvancedAlgorithms } from './algorithms/pathfindingAdvanced.js';
import { dpAdvancedAlgorithms } from './algorithms/dpAdvanced.js';

export const ALL_ALGORITHMS = [
  ...sortingAlgorithms,
  ...searchingAlgorithms,
  ...arrayAlgorithms,
  ...linkedListAlgorithms,
  ...stackAlgorithms,
  ...queueAlgorithms,
  ...treeAlgorithms,
  ...graphAlgorithms,
  ...pathfindingAlgorithms,
  ...dpAlgorithms,
  ...stringAlgorithms,
  ...recursionAlgorithms,
  ...backtrackingAlgorithms,
  ...greedyAlgorithms,
  ...hashingAlgorithms,
  ...graphAdvancedAlgorithms,
  ...pathfindingAdvancedAlgorithms,
  ...dpAdvancedAlgorithms,
];

export const ALGO_MAP = Object.fromEntries(ALL_ALGORITHMS.map((a) => [a.id, a]));

export const CATEGORIES = [
  'Sorting', 'Searching', 'Arrays', 'Linked Lists', 'Stacks', 'Queues',
  'Trees', 'Graphs', 'Shortest Path', 'Dynamic Programming', 'Strings',
  'Recursion', 'Backtracking', 'Greedy', 'Hashing',
];

export function searchAlgorithms(query) {
  if (!query) return ALL_ALGORITHMS;
  const q = query.toLowerCase();
  return ALL_ALGORITHMS.filter((a) =>
    a.name.toLowerCase().includes(q) ||
    a.category.toLowerCase().includes(q) ||
    (a.complexity?.avg || '').toLowerCase().includes(q) ||
    a.description.toLowerCase().includes(q)
  );
}

// Favorites + recently used (localStorage)
const FAV_KEY = 'algoviz_favorites';
const RECENT_KEY = 'algoviz_recent';

export function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
export function toggleFavorite(id) {
  const favs = getFavorites();
  const i = favs.indexOf(id);
  if (i >= 0) favs.splice(i, 1); else favs.unshift(id);
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  return favs;
}
export function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
export function addRecent(id, inputSize) {
  let recent = getRecent().filter((r) => r.id !== id);
  recent.unshift({ id, ts: Date.now(), inputSize });
  recent = recent.slice(0, 12);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  return recent;
}
export function clearRecent() { localStorage.removeItem(RECENT_KEY); }