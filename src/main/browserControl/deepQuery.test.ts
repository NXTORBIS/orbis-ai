import test from 'node:test'
import assert from 'node:assert/strict'
import { DEEP, SNAPSHOT_SCRIPT, locateScript, targetScript } from './page.ts'

/**
 * The shadow-root walk, run against a tree small enough to reason about.
 *
 * Not a substitute for a real page -- that is checked against the browser -- but the traversal is the part written by
 * hand, and the thing it has to get right is that an element behind a shadow boundary is found at all. Whole sites keep
 * every control a person uses on the far side of one, and against those every locator was looking at an almost empty
 * page: a button plainly on the screen reported as not existing, which is the most confusing failure possible because
 * the person can see it.
 */

interface Node {
  tag: string
  marks: string[]
  children: Node[]
  shadowRoot?: Node
}

const node = (tag: string, marks: string[] = [], children: Node[] = [], shadow?: Node): Node => ({ tag, marks, children, shadowRoot: shadow })

/** Just enough of a DOM for the walk: querySelectorAll over '*' and over a mark, and a shadowRoot on a host. */
function asDom(root: Node): { querySelectorAll(selector: string): unknown[] } {
  const wrap = (n: Node): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      tag: n.tag,
      shadowRoot: n.shadowRoot ? asDom(n.shadowRoot) : null,
      querySelectorAll: (selector: string): unknown[] => {
        const out: unknown[] = []
        const walk = (x: Node): void => {
          for (const child of x.children) {
            if (selector === '*' || child.marks.includes(selector)) out.push(byNode.get(child))
            walk(child)
          }
        }
        walk(n)
        return out
      }
    }
    byNode.set(n, self)
    for (const child of n.children) wrap(child)
    return self
  }
  const byNode = new Map<Node, unknown>()
  return wrap(root) as unknown as { querySelectorAll(selector: string): unknown[] }
}

/** Runs the walker from page.ts against a fake document and returns the tags it found. */
function deepFind(root: Node, selector: string): string[] {
  const document = asDom(root)
  const fn = new Function('document', `${DEEP}\nreturn orbisDeep(${JSON.stringify(selector)}).map((el) => el.tag)`)
  return fn(document) as string[]
}

test('an element in the ordinary document is found', () => {
  const tree = node('html', [], [node('button', ['wanted'])])
  assert.deepEqual(deepFind(tree, 'wanted'), ['button'])
})

test('an element inside a shadow root is found', () => {
  // The whole point. querySelectorAll stops at the boundary and reports nothing here.
  const inside = node('shadow-root', [], [node('button', ['wanted'])])
  const tree = node('html', [], [node('my-player', [], [], inside)])
  assert.deepEqual(deepFind(tree, 'wanted'), ['button'])
})

test('shadow roots nested inside shadow roots are followed', () => {
  const deepest = node('#root3', [], [node('span', ['wanted'])])
  const middle = node('#root2', [], [node('inner-host', [], [], deepest)])
  const outer = node('#root1', [], [node('middle-host', [], [], middle)])
  const tree = node('html', [], [node('outer-host', [], [], outer)])
  assert.deepEqual(deepFind(tree, 'wanted'), ['span'])
})

test('both sides of a boundary are found, document first', () => {
  const inside = node('#root', [], [node('shadow-button', ['wanted'])])
  const tree = node('html', [], [node('light-button', ['wanted']), node('host', [], [], inside)])
  assert.deepEqual(deepFind(tree, 'wanted'), ['light-button', 'shadow-button'])
})

test('nothing matching is an empty answer, not a throw', () => {
  const tree = node('html', [], [node('div', ['other'], [], node('#root', [], [node('p', ['also-other'])]))])
  assert.deepEqual(deepFind(tree, 'wanted'), [])
})

test('a tree deeper than the walk is bounded rather than endless', () => {
  /*
   * The cost of this walk is the size of the page, so it is capped. The caps are high enough that no real page reaches
   * them; what matters is that a pathological one cannot hang a tab.
   */
  let inner = node('#root', [], [node('button', ['wanted'])])
  for (let i = 0; i < 20; i++) inner = node('#root', [], [node('host', [], [], inner)])
  const tree = node('html', [], [node('host', [], [], inner)])
  // Past the depth limit it simply does not find it; it does not loop and it does not throw.
  assert.deepEqual(deepFind(tree, 'wanted'), [])
})

test('every script that resolves a reference knows how to look through a shadow root', () => {
  /*
   * A reference is put on the element the snapshot numbered -- which may be inside a shadow root. If a later script
   * looks it up with a plain document query it finds nothing, and the step fails on an element Orbis itself had just
   * numbered a moment earlier.
   */
  for (const [name, code] of [
    ['snapshot', SNAPSHOT_SCRIPT],
    ['target', targetScript(3)],
    ['locate', locateScript({ text: 'Next' })]
  ] as const) {
    assert.ok(code.includes('orbisDeep'), `${name} does not look through shadow roots`)
    assert.ok(!/document\.querySelectorAll\('\[data-orbis-ref/.test(code), `${name} still resolves a reference with a shallow query`)
  }
})
