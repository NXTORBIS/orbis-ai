import { describe, expect, it } from 'vitest';
import { evaluate, parseExpression, referencedVariables, topologicalOrder } from './expression';

describe('expression language', () => {
  it('respects precedence and associativity', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7);
    expect(evaluate('(1 + 2) * 3')).toBe(9);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluate('-2 ^ 2')).toBe(-4);
    expect(evaluate('10 - 4 - 3')).toBe(3);
    expect(evaluate('7 % 3')).toBe(1);
  });
  it('evaluates variables, functions and logic', () => {
    expect(evaluate('max(a, b) + if(a > b, 100, 0)', { a: 3, b: 5 })).toBe(5);
    expect(evaluate('a > 1 and not (b < 0) or false', { a: 2, b: 1 })).toBe(1);
    expect(evaluate('clamp(x, 0, 1)', { x: 7 })).toBe(1);
    expect(evaluate('sqrt(16) + ln(e)')).toBe(5);
    expect(evaluate('1.5e2 + .5')).toBe(150.5);
  });
  it('rejects malformed input with helpful messages', () => {
    expect(() => parseExpression('')).toThrow(/empty/);
    expect(() => parseExpression('1 +')).toThrow(/ended unexpectedly/);
    expect(() => parseExpression('a = 2')).toThrow(/==/);
    expect(() => parseExpression('foo(1)')).toThrow(/Unknown function/);
    expect(() => parseExpression('max()')).toThrow(/expects/);
    expect(() => parseExpression('1 < x < 3')).toThrow(/Chained/);
    expect(() => parseExpression('alert`x`')).toThrow(/Unexpected character/);
    expect(() => evaluate('y + 1', { x: 1 })).toThrow(/Unknown variable "y"/);
    expect(() => parseExpression('('.repeat(200) + '1' + ')'.repeat(200))).toThrow(/deeply/);
  });
  it('lists referenced variables', () => {
    expect([...referencedVariables(parseExpression('a * b + max(c, a)'))].sort()).toEqual(['a', 'b', 'c']);
  });
  it('orders dependencies and detects cycles', () => {
    expect(topologicalOrder([
      { name: 'c', deps: new Set(['b']) },
      { name: 'b', deps: new Set(['a']) },
      { name: 'a', deps: new Set() },
    ])).toEqual(['a', 'b', 'c']);
    expect(() => topologicalOrder([
      { name: 'a', deps: new Set(['b']) },
      { name: 'b', deps: new Set(['a']) },
    ])).toThrow(/Circular/);
  });
});
