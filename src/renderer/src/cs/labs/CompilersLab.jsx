import React, { useState, useMemo } from 'react';
import { GitMerge, Play, Code2 } from 'lucide-react';
import LabShell from '../parts/LabShell.jsx';

// Compiler pipeline: lexer → recursive descent parser → AST for a tiny expression language.
// Supports: let, if/else, print, arithmetic, comparisons, identifiers, numbers.
const SAMPLE = `let x = 3 + 4 * 2;
let y = x - 1;
if x > y {
  print x;
} else {
  print y;
}`;

const TOKEN_TYPES = { NUM: 'number', ID: 'identifier', KW: 'keyword', OP: 'operator', PUNCT: 'punct', EOF: 'eof' };
const KEYWORDS = new Set(['let', 'if', 'else', 'print']);

function lex(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c)) { let n = ''; while (i < src.length && /\d/.test(src[i])) n += src[i++]; tokens.push({ type: 'NUM', value: +n }); continue; }
    if (/[a-zA-Z_]/.test(c)) { let n = ''; while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) n += src[i++]; tokens.push({ type: KEYWORDS.has(n) ? 'KW' : 'ID', value: n }); continue; }
    if ('+-*/'.includes(c)) { tokens.push({ type: 'OP', value: c }); i++; continue; }
    if ('<>='.includes(c)) { let op = c; if (src[i + 1] === '=') { op += '='; i++; } tokens.push({ type: 'OP', value: op }); i++; continue; }
    if (c === '{' || c === '}' || c === '(' || c === ')' || c === ';' || c === ',') { tokens.push({ type: 'PUNCT', value: c }); i++; continue; }
    throw new Error(`Unexpected character: '${c}' at position ${i}`);
  }
  tokens.push({ type: 'EOF', value: null });
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (type, value) => {
    const t = peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) throw new Error(`Expected ${type}${value ? ' "' + value + '"' : ''} but got ${t.type} "${t.value}"`);
    pos++; return t;
  };
  const parseExpr = () => {
    let left = parseTerm();
    while (peek().type === 'OP' && ['+', '-'].includes(peek().value)) {
      const op = eat('OP').value; const right = parseTerm();
      left = { type: 'BinaryOp', op, left, right };
    }
    if (peek().type === 'OP' && ['>', '<', '>=', '<=', '='].includes(peek().value)) {
      const op = eat('OP').value; const right = parseExpr();
      left = { type: 'BinaryOp', op, left, right };
    }
    return left;
  };
  const parseTerm = () => {
    let left = parseFactor();
    while (peek().type === 'OP' && ['*', '/'].includes(peek().value)) {
      const op = eat('OP').value; const right = parseFactor();
      left = { type: 'BinaryOp', op, left, right };
    }
    return left;
  };
  const parseFactor = () => {
    const t = peek();
    if (t.type === 'NUM') { eat('NUM'); return { type: 'Number', value: t.value }; }
    if (t.type === 'ID') { eat('ID'); return { type: 'Identifier', name: t.value }; }
    if (t.type === 'PUNCT' && t.value === '(') { eat('PUNCT', '('); const e = parseExpr(); eat('PUNCT', ')'); return e; }
    throw new Error(`Unexpected token: ${t.type} "${t.value}"`);
  };
  const parseStmt = () => {
    const t = peek();
    if (t.type === 'KW' && t.value === 'let') {
      eat('KW', 'let'); const name = eat('ID').value; eat('OP', '='); const value = parseExpr(); eat('PUNCT', ';');
      return { type: 'LetDecl', name, value };
    }
    if (t.type === 'KW' && t.value === 'print') {
      eat('KW', 'print'); const value = parseExpr(); eat('PUNCT', ';');
      return { type: 'Print', value };
    }
    if (t.type === 'KW' && t.value === 'if') {
      eat('KW', 'if'); const cond = parseExpr(); eat('PUNCT', '{');
      const then = []; while (!(peek().type === 'PUNCT' && peek().value === '}')) then.push(parseStmt());
      eat('PUNCT', '}'); let alt = null;
      if (peek().type === 'KW' && peek().value === 'else') {
        eat('KW', 'else'); eat('PUNCT', '{'); alt = [];
        while (!(peek().type === 'PUNCT' && peek().value === '}')) alt.push(parseStmt());
        eat('PUNCT', '}');
      }
      return { type: 'If', cond, then, alt };
    }
    throw new Error(`Unexpected statement starting with ${t.type} "${t.value}"`);
  };
  const body = [];
  while (peek().type !== 'EOF') body.push(parseStmt());
  return { type: 'Program', body };
}

function evalAst(ast) {
  const env = {};
  const out = [];
  const ev = (node) => {
    switch (node.type) {
      case 'Number': return node.value;
      case 'Identifier': if (!(node.name in env)) throw new Error(`Undefined: ${node.name}`); return env[node.name];
      case 'BinaryOp': {
        const l = ev(node.left), r = ev(node.right);
        switch (node.op) { case '+': return l + r; case '-': return l - r; case '*': return l * r; case '/': return l / r;
          case '>': return l > r ? 1 : 0; case '<': return l < r ? 1 : 0; case '>=': return l >= r ? 1 : 0; case '<=': return l <= r ? 1 : 0; case '=': return l === r ? 1 : 0; }
      }
      case 'LetDecl': env[node.name] = ev(node.value); break;
      case 'Print': out.push(String(ev(node.value))); break;
      case 'If': if (ev(node.cond)) node.then.forEach(ev); else if (node.alt) node.alt.forEach(ev); break;
    }
  };
  ast.body.forEach(ev);
  return out;
}

const astToTree = (node, depth = 0) => {
  if (!node) return null;
  const pad = '  '.repeat(depth);
  switch (node.type) {
    case 'Number': return `${pad}Number(${node.value})`;
    case 'Identifier': return `${pad}Identifier(${node.name})`;
    case 'BinaryOp': return `${pad}BinaryOp(${node.op})\n${astToTree(node.left, depth + 1)}\n${astToTree(node.right, depth + 1)}`;
    case 'LetDecl': return `${pad}LetDecl(${node.name})\n${astToTree(node.value, depth + 1)}`;
    case 'Print': return `${pad}Print\n${astToTree(node.value, depth + 1)}`;
    case 'If': return `${pad}If\n${astToTree(node.cond, depth + 1)}\n${pad}  then:\n${node.then.map((s) => astToTree(s, depth + 2)).join('\n')}${node.alt ? `\n${pad}  else:\n${node.alt.map((s) => astToTree(s, depth + 2)).join('\n')}` : ''}`;
    default: return `${pad}${node.type}`;
  }
};

export default function CompilersLab() {
  const [src, setSrc] = useState(SAMPLE);
  const [tokens, setTokens] = useState([]);
  const [ast, setAst] = useState('');
  const [output, setOutput] = useState([]);
  const [error, setError] = useState('');

  const compile = () => {
    setError(''); setTokens([]); setAst(''); setOutput([]);
    try {
      const tk = lex(src);
      setTokens(tk.filter((t) => t.type !== 'EOF'));
      const tree = parse(tk);
      setAst(astToTree(tree));
      setOutput(evalAst(tree));
    } catch (e) { setError(e.message); }
  };

  return (
    <LabShell icon={GitMerge} title="Compiler Design" description="Lexer → parser → AST → interpreter. Watch your code become tokens, then a tree, then output.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <button onClick={compile} className="flex items-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background hover:bg-cyan-j/90 w-fit"><Play className="size-3.5" /> Compile & Run</button>
          <textarea value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false}
            className="h-72 resize-none rounded-lg border border-border bg-card p-3 font-mono-j text-xs leading-relaxed scrollbar-thin" />
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground"><Code2 className="size-3" /> TOKENS</div>
            <div className="flex flex-wrap gap-1">
              {tokens.length === 0 ? <span className="text-xs text-muted-foreground">Compile to see tokens.</span> :
                tokens.map((t, i) => (
                  <span key={i} className={`rounded px-1.5 py-0.5 font-mono-j text-[10px] ${
                    t.type === 'NUM' ? 'bg-amber-500/15 text-amber-400' :
                    t.type === 'ID' ? 'bg-cyan-j/15 text-cyan-j' :
                    t.type === 'KW' ? 'bg-purple-500/15 text-purple-400' :
                    t.type === 'OP' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                    {t.type === 'NUM' ? t.value : t.value}
                  </span>
                ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 flex-1">
            <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground">AST</div>
            <pre className="font-mono-j text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90">{ast || 'Compile to see the AST.'}</pre>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground">OUTPUT</div>
            {output.length === 0 ? <span className="text-xs text-muted-foreground">No output.</span> :
              output.map((o, i) => <pre key={i} className="font-mono-j text-xs text-cyan-j">→ {o}</pre>)}
          </div>
        </div>
      </div>
    </LabShell>
  );
}