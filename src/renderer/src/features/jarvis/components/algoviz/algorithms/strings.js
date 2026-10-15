import { mkStep, newStats } from '../stepUtils';

// String algorithms. View type: 'string'.
// viewData: { text: [...], pattern: [...], i, j, matches, shift, lps }

// ── Naive String Search ──
export function naiveSearch(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const text = opts.text ?? 'AABAACAADAABAABA';
  const pat = opts.pattern ?? 'AABA';
  const code = ['for i in 0..n-m:', '  j = 0', '  while j<m and text[i+j]==pattern[j]: j++', '  if j==m: found at i'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = text.length, m = pat.length;
  push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), i: 0, j: 0 }, vars: { text, pattern: pat }, codeLine: 0, desc: `Search "${pat}" in "${text}"` });
  for (let i = 0; i <= n - m; i++) {
    let j = 0;
    while (j < m) {
      stats.comparisons++;
      push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), i, j }, vars: { i, j, tc: text[i + j], pc: pat[j] }, codeLine: 2, desc: `Compare text[${i + j}]='${text[i + j]}' with pat[${j}]='${pat[j]}'` });
      if (text[i + j] !== pat[j]) break;
      j++;
    }
    if (j === m) { push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), i, j, found: true }, vars: { i }, codeLine: 3, desc: `Found at index ${i}` }); }
    else { push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), i, j, mismatch: true }, vars: { i }, codeLine: 2, desc: `Mismatch at ${i + j}, shift` }); }
  }
  push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), done: true }, vars: {}, codeLine: 4, desc: 'Search complete' });
  return { steps, code };
}

// ── KMP ──
export function kmp(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const text = opts.text ?? 'ABABDABACDABABCABAB';
  const pat = opts.pattern ?? 'ABABCABAB';
  const code = ['build LPS array', 'i=0; j=0', 'while i<n:', '  if text[i]==pat[j]: i++; j++', '  if j==m: found', '  elif i<n and text[i]!=pat[j]:', '    if j!=0: j=lps[j-1] else i++'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = text.length, m = pat.length;
  const lps = new Array(m).fill(0);
  let len = 0, i = 1;
  while (i < m) { if (pat[i] === pat[len]) { lps[i++] = ++len; } else if (len) { len = lps[len - 1]; } else { lps[i++] = 0; } }
  push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), lps, i: 0, j: 0 }, vars: { lps: lps.join(',') }, codeLine: 0, desc: `LPS = [${lps.join(', ')}]` });
  i = 0; let j = 0;
  while (i < n) {
    stats.comparisons++;
    push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), lps, i, j }, vars: { i, j, tc: text[i], pc: pat[j] }, codeLine: 3, desc: `Compare text[${i}]='${text[i]}' pat[${j}]='${pat[j]}'` });
    if (text[i] === pat[j]) { i++; j++; if (j === m) { push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), lps, i, j, found: true }, vars: { at: i - j }, codeLine: 4, desc: `Found at ${i - j}` }); j = lps[j - 1]; } }
    else { if (j) { const nj = lps[j - 1]; push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), lps, i, j, shift: true }, vars: { j, nj }, codeLine: 6, desc: `Shift j ${j}→${nj} via LPS` }); j = lps[j - 1]; } else { i++; } }
  }
  push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), lps, done: true }, vars: {}, codeLine: 7, desc: 'Done' });
  return { steps, code };
}

// ── Rabin-Karp ──
export function rabinKarp(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const text = opts.text ?? 'GEEKS FOR GEEKS';
  const pat = opts.pattern ?? 'GEEK';
  const code = ['ph = hash(pattern)', 'for i in 0..n-m:', '  th = hash(text[i..i+m-1])', '  if th==ph and verify: found'];
  const push = (p) => steps.push(mkStep(p, stats));
  const n = text.length, m = pat.length; const B = 256, Q = 101;
  let ph = 0, th = 0, h = 1;
  for (let i = 0; i < m - 1; i++) h = (h * B) % Q;
  for (let i = 0; i < m; i++) { ph = (B * ph + pat.charCodeAt(i)) % Q; th = (B * th + text.charCodeAt(i)) % Q; }
  push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), i: 0, j: 0, ph, th }, vars: { ph, pattern: pat }, codeLine: 0, desc: `Pattern hash = ${ph}` });
  for (let i = 0; i <= n - m; i++) {
    push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), i, j: 0, ph, th }, vars: { i, th, ph }, codeLine: 2, desc: `Window hash = ${th}` });
    if (th === ph) {
      stats.comparisons++;
      let match = true; for (let k = 0; k < m; k++) { if (text[i + k] !== pat[k]) { match = false; break; } }
      if (match) { push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), i, j: m, found: true, ph, th }, vars: { i }, codeLine: 3, desc: `Found at ${i}` }); }
    }
    if (i < n - m) { th = (B * (th - text.charCodeAt(i) * h) + text.charCodeAt(i + m)) % Q; if (th < 0) th += Q; }
  }
  push({ array: text.split(''), view: 'string', viewData: { text: text.split(''), pattern: pat.split(''), done: true }, vars: {}, codeLine: 4, desc: 'Done' });
  return { steps, code };
}

export const stringAlgorithms = [
  { id: 'naiveSearch', name: 'Naive String Search', category: 'Strings', view: 'string', inputType: 'string', generate: naiveSearch, description: 'Checks every position for the pattern — O(nm) worst case.', complexity: { best: 'O(n)', avg: 'O(nm)', worst: 'O(nm)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Teaching', advantages: 'Simple', disadvantages: 'Backtracks' },
  { id: 'kmp', name: 'KMP', category: 'Strings', view: 'string', inputType: 'string', generate: kmp, description: 'Uses an LPS array to avoid re-scanning text.', complexity: { best: 'O(n)', avg: 'O(n+m)', worst: 'O(n+m)', space: 'O(m)' }, stable: true, inplace: true, useCases: 'String matching', advantages: 'Linear, no backtrack', disadvantages: 'LPS preprocessing' },
  { id: 'rabinKarp', name: 'Rabin-Karp', category: 'Strings', view: 'string', inputType: 'string', generate: rabinKarp, description: 'Rolling hash compares windows; verifies on hash match.', complexity: { best: 'O(n+m)', avg: 'O(n+m)', worst: 'O(nm)', space: 'O(1)' }, stable: true, inplace: true, useCases: 'Multi-pattern search', advantages: 'Rolling hash fast', disadvantages: 'Spurious hits' },
];