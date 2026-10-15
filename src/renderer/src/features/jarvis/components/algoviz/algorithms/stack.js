import { mkStep, newStats } from '../stepUtils';

// Stack algorithms. View type: 'stack'. viewData: { items: [...], top, op, highlight }

// ── Balanced Parentheses ──
export function balancedParens(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const s = opts.string ?? (Array.isArray(input) ? input.join('') : String(input) ?? '([{}])');
  const code = ['for ch in s:', '  if ch is opener: push(ch)', '  elif matches(top, ch): pop()', '  else: return False', 'return stack empty'];
  const push = (p) => steps.push(mkStep(p, stats));
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const open = '([{';
  const st = [];
  push({ array: s.split(''), view: 'stack', viewData: { items: [], op: 'init', string: s, idx: -1 }, vars: {}, codeLine: 0, desc: `Check balance of "${s}"` });
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (open.includes(ch)) { st.push(ch); stats.stackOps++; push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'push', string: s, idx: i, highlight: st.length - 1 }, vars: { ch, i }, codeLine: 1, desc: `Push '${ch}'` }); }
    else if (pairs[ch]) {
      if (!st.length || st[st.length - 1] !== pairs[ch]) { push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'mismatch', string: s, idx: i }, vars: { ch, i }, codeLine: 3, desc: `Mismatch at '${ch}'` }); return { steps, code }; }
      st.pop(); stats.stackOps++; push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'pop', string: s, idx: i, highlight: st.length }, vars: { ch, i }, codeLine: 2, desc: `Pop matching '${ch}'` });
    }
  }
  push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'done', string: s, idx: s.length - 1 }, vars: {}, codeLine: 4, desc: st.length === 0 ? 'Balanced ✓' : 'Unbalanced — stack not empty' });
  return { steps, code };
}

// ── Infix → Postfix (shunting yard) ──
export function infixToPostfix(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const s = opts.string ?? '3+4*2/(1-5)';
  const code = ['for token in infix:', '  if operand: output', '  if "(": push', '  if operator: pop higher/equal, then push', '  if ")": pop until "("', 'pop remaining'];
  const push = (p) => steps.push(mkStep(p, stats));
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  const st = []; const out = [];
  push({ array: s.split(''), view: 'stack', viewData: { items: [], op: 'init', string: s, idx: -1, output: '' }, vars: {}, codeLine: 0, desc: `Convert "${s}" to postfix` });
  for (let i = 0; i < s.length; i++) {
    const t = s[i];
    if (/[0-9a-zA-Z]/.test(t)) { out.push(t); push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'output', string: s, idx: i, output: out.join(' ') }, vars: { t, output: out.join('') }, codeLine: 1, desc: `Output '${t}'` }); }
    else if (t === '(') { st.push(t); stats.stackOps++; push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'push', string: s, idx: i, output: out.join(' ') }, vars: { t }, codeLine: 2, desc: `Push '('` }); }
    else if (t === ')') { while (st.length && st[st.length - 1] !== '(') { out.push(st.pop()); stats.stackOps++; } st.pop(); push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'pop', string: s, idx: i, output: out.join(' ') }, vars: { t, output: out.join('') }, codeLine: 3, desc: `Pop until '('` }); }
    else if (prec[t] !== undefined) {
      while (st.length && prec[st[st.length - 1]] >= prec[t]) { out.push(st.pop()); stats.stackOps++; }
      st.push(t); stats.stackOps++;
      push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'push', string: s, idx: i, output: out.join(' ') }, vars: { t, output: out.join('') }, codeLine: 2, desc: `Push '${t}'` });
    }
  }
  while (st.length) { out.push(st.pop()); stats.stackOps++; push({ array: s.split(''), view: 'stack', viewData: { items: st.slice(), op: 'pop', string: s, idx: s.length - 1, output: out.join(' ') }, vars: { output: out.join('') }, codeLine: 4, desc: `Pop remaining` }); }
  push({ array: s.split(''), view: 'stack', viewData: { items: [], op: 'done', string: s, idx: s.length - 1, output: out.join(' ') }, vars: { result: out.join(' ') }, codeLine: 4, desc: `Postfix: ${out.join(' ')}` });
  return { steps, code };
}

// ── Postfix Evaluation ──
export function postfixEval(input, opts = {}) {
  const stats = newStats(); const steps = [];
  const s = opts.string ?? '3 4 2 * +';
  const code = ['for token in postfix:', '  if number: push', '  if operator: b=pop; a=pop; push(a op b)', 'return top'];
  const push = (p) => steps.push(mkStep(p, stats));
  const toks = s.split(/\s+/).filter(Boolean);
  const st = [];
  push({ array: toks, view: 'stack', viewData: { items: [], op: 'init', string: s, idx: -1 }, vars: {}, codeLine: 0, desc: `Evaluate "${s}"` });
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^-?\d+(\.\d+)?$/.test(t)) { st.push(parseFloat(t)); stats.stackOps++; push({ array: toks, view: 'stack', viewData: { items: st.slice(), op: 'push', string: s, idx: i, highlight: st.length - 1 }, vars: { t }, codeLine: 1, desc: `Push ${t}` }); }
    else {
      const b = st.pop(), a = st.pop(); stats.stackOps += 2;
      let r;
      if (t === '+') r = a + b; else if (t === '-') r = a - b; else if (t === '*') r = a * b; else if (t === '/') r = a / b;
      st.push(r);
      push({ array: toks, view: 'stack', viewData: { items: st.slice(), op: 'op', string: s, idx: i, highlight: st.length - 1 }, vars: { a, b, op: t, r }, codeLine: 2, desc: `${a} ${t} ${b} = ${r}` });
    }
  }
  push({ array: toks, view: 'stack', viewData: { items: st.slice(), op: 'done', string: s, idx: toks.length - 1 }, vars: { result: st[0] }, codeLine: 3, desc: `Result = ${st[0]}` });
  return { steps, code };
}

export const stackAlgorithms = [
  { id: 'balancedParens', name: 'Balanced Parentheses', category: 'Stacks', view: 'stack', inputType: 'string', generate: balancedParens, description: 'Uses a stack to check whether brackets are balanced.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Syntax validation', advantages: 'Linear', disadvantages: '—' },
  { id: 'infixToPostfix', name: 'Infix → Postfix', category: 'Stacks', view: 'stack', inputType: 'string', generate: infixToPostfix, description: 'Shunting-yard converts infix to postfix notation.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Expression parsing', advantages: 'Handles precedence', disadvantages: 'Single-digit tokens here' },
  { id: 'postfixEval', name: 'Postfix Evaluation', category: 'Stacks', view: 'stack', inputType: 'string', generate: postfixEval, description: 'Evaluates a postfix expression with a stack.', complexity: { best: 'O(n)', avg: 'O(n)', worst: 'O(n)', space: 'O(n)' }, stable: true, inplace: true, useCases: 'Expression evaluation', advantages: 'No precedence rules', disadvantages: '—' },
];