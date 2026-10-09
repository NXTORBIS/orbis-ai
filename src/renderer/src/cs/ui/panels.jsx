/**
 * Resizable split panes, with the shape of `react-resizable-panels`.
 *
 * NOT the user's file. Their problem page splits the statement from the editor and lets you drag the divider, so
 * the three components it imports have to exist. This is them, in about a hundred lines of flexbox and one
 * pointer handler, rather than a dependency.
 *
 * It keeps the behaviour that matters: dragging resizes, double-clicking the handle resets, the handle is
 * reachable by keyboard with the arrow keys, and a pane cannot be dragged smaller than its `minSize`. The sizes
 * are percentages, as theirs are.
 */
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'

const Group = createContext(null)

/**
 * A row or a column of panes.
 *
 * `autoSaveId` is accepted and remembered in this browser, because their page passes one and losing the split
 * on every open would be worse than keeping it.
 */
export function PanelGroup({ direction = 'horizontal', children, className = '', autoSaveId, onLayout, ...rest }) {
  const row = direction === 'horizontal'
  const box = useRef(null)
  const panels = useRef([])
  const [sizes, setSizes] = useState(null)

  const remembered = useMemo(() => {
    if (!autoSaveId) return null
    try {
      const held = localStorage.getItem('orbis:cs:split:' + autoSaveId)
      const read = held ? JSON.parse(held) : null
      return Array.isArray(read) && read.every((one) => typeof one === 'number') ? read : null
    } catch {
      // Storage can be denied. A default split is a working split.
      return null
    }
  }, [autoSaveId])

  const remember = useCallback(
    (next) => {
      if (!autoSaveId) return
      try {
        localStorage.setItem('orbis:cs:split:' + autoSaveId, JSON.stringify(next))
      } catch {
        // Losing a remembered split is better than losing the screen.
      }
    },
    [autoSaveId]
  )

  const register = useCallback((id, defaultSize, minSize) => {
    panels.current = [...panels.current.filter((one) => one.id !== id), { id, defaultSize, minSize }]
    return () => {
      panels.current = panels.current.filter((one) => one.id !== id)
    }
  }, [])

  // The order panels appear in the markup, which is the order they were registered in.
  const order = () => panels.current.map((one) => one.id)

  const current = useCallback(() => {
    const ids = order()
    if (sizes && sizes.length === ids.length) return sizes
    if (remembered && remembered.length === ids.length) return remembered
    const stated = panels.current.map((one) => one.defaultSize)
    const given = stated.filter((one) => typeof one === 'number')
    if (given.length === ids.length) return stated
    // Nothing stated: share the room equally.
    return ids.map(() => 100 / Math.max(1, ids.length))
  }, [sizes, remembered])

  /** Drag the divider after pane `index`, by a fraction of the whole. */
  const drag = useCallback(
    (index, fraction) => {
      const now = current()
      const next = [...now]
      const move = fraction * 100
      const leastA = panels.current[index]?.minSize ?? 10
      const leastB = panels.current[index + 1]?.minSize ?? 10
      const a = now[index] + move
      const b = now[index + 1] - move
      if (a < leastA || b < leastB) return
      next[index] = a
      next[index + 1] = b
      setSizes(next)
      remember(next)
      onLayout?.(next)
    },
    [current, remember, onLayout]
  )

  const reset = useCallback(() => {
    setSizes(null)
    if (autoSaveId) {
      try {
        localStorage.removeItem('orbis:cs:split:' + autoSaveId)
      } catch {
        // Nothing to do; the sizes are back to their defaults in memory either way.
      }
    }
  }, [autoSaveId])

  const value = useMemo(
    () => ({ row, box, register, current, drag, reset, order }),
    [row, register, current, drag, reset]
  )

  return (
    <Group.Provider value={value}>
      <div
        ref={box}
        className={`flex min-h-0 min-w-0 ${row ? 'flex-row' : 'flex-col'} ${className}`.trim()}
        style={{ width: '100%', height: '100%' }}
        {...rest}
      >
        {children}
      </div>
    </Group.Provider>
  )
}

export function Panel({ children, className = '', defaultSize, minSize = 10, id: given, order: _order, ...rest }) {
  const group = useContext(Group)
  const made = useId()
  const id = given ?? made

  useEffect(() => group?.register(id, defaultSize, minSize), [group, id, defaultSize, minSize])

  const sizes = group?.current() ?? []
  const index = (group?.order() ?? []).indexOf(id)
  const size = index >= 0 ? sizes[index] : undefined

  return (
    <div
      className={`min-h-0 min-w-0 overflow-hidden ${className}`.trim()}
      style={{ flexBasis: size === undefined ? undefined : `${size}%`, flexGrow: size === undefined ? 1 : 0, flexShrink: 1 }}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * The divider.
 *
 * Draggable, resettable with a double click, and movable with the arrow keys — a divider only a mouse can reach
 * is a divider somebody on a keyboard cannot use at all.
 */
export function PanelResizeHandle({ className = '', ...rest }) {
  const group = useContext(Group)
  const self = useRef(null)
  const [dragging, setDragging] = useState(false)

  /** Which divider this is: the number of panels before it in the markup. */
  const indexOf = () => {
    const parent = self.current?.parentElement
    if (!parent) return 0
    const kids = [...parent.children]
    const mine = kids.indexOf(self.current)
    return kids.slice(0, mine).filter((one) => !one.hasAttribute('data-split-handle')).length - 1
  }

  const onPointerDown = (event) => {
    if (!group?.box.current) return
    const index = indexOf()
    const rect = group.box.current.getBoundingClientRect()
    const whole = group.row ? rect.width : rect.height
    if (whole <= 0) return
    let last = group.row ? event.clientX : event.clientY
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)

    const move = (one) => {
      const now = group.row ? one.clientX : one.clientY
      const by = (now - last) / whole
      if (by !== 0) {
        group.drag(index, by)
        last = now
      }
    }
    const done = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', done)
      window.removeEventListener('pointercancel', done)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', done)
    window.addEventListener('pointercancel', done)
  }

  const onKeyDown = (event) => {
    if (!group) return
    const index = indexOf()
    const back = group.row ? 'ArrowLeft' : 'ArrowUp'
    const on = group.row ? 'ArrowRight' : 'ArrowDown'
    if (event.key === back) {
      event.preventDefault()
      group.drag(index, -0.02)
    } else if (event.key === on) {
      event.preventDefault()
      group.drag(index, 0.02)
    } else if (event.key === 'Home' || event.key === 'Enter') {
      event.preventDefault()
      group.reset()
    }
  }

  return (
    <div
      ref={self}
      data-split-handle=""
      role="separator"
      tabIndex={0}
      aria-orientation={group?.row ? 'vertical' : 'horizontal'}
      aria-label="Resize. Arrow keys to move, Enter to reset."
      className={`cs-split-handle${group?.row ? '' : ' across'}${dragging ? ' dragging' : ''} ${className}`.trim()}
      onPointerDown={onPointerDown}
      onDoubleClick={() => group?.reset()}
      onKeyDown={onKeyDown}
      {...rest}
    />
  )
}

export default { PanelGroup, Panel, PanelResizeHandle }
