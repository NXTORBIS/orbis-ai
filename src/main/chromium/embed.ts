import { createRequire } from 'node:module'

/**
 * Embeds Orbis's Chromium window in the Orbis window (Windows): Chromium's top-level window becomes a native child of the
 * Orbis window and is placed exactly over the renderer's "browser view" region. Win32 is called through koffi (MIT).
 */

const GWL_STYLE = -16
const GWL_EXSTYLE = -20
const WS_CHILD = 0x40000000
const WS_VISIBLE = 0x10000000
const WS_CLIPSIBLINGS = 0x04000000
const WS_CLIPCHILDREN = 0x02000000
// caption+border, thickframe, sysmenu, minimize box, maximize box, popup
const STYLE_STRIP = 0x00c00000 | 0x00040000 | 0x00080000 | 0x00020000 | 0x00010000 | 0x80000000
// dlgmodalframe, windowedge, clientedge, appwindow, toolwindow, staticedge
const EX_STRIP = 0x1 | 0x100 | 0x200 | 0x40000 | 0x80 | 0x20000
const SWP_NOACTIVATE = 0x0010
const SWP_FRAMECHANGED = 0x0020
const SWP_SHOWWINDOW = 0x0040
const SW_HIDE = 0
const SW_SHOWNA = 8

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Api {
  enumWindows(pid: number): { hwnd: bigint; cls: string; visible: boolean }[]
  setParent(child: bigint, parent: bigint): void
  getParent(hwnd: bigint): bigint
  isChild(parent: bigint, child: bigint): boolean
  isVisible(hwnd: bigint): boolean
  getStyles(hwnd: bigint): { style: number; ex: number }
  setStyles(hwnd: bigint, style: number, ex: number): void
  setPos(hwnd: bigint, r: Rect, show: boolean): void
  show(hwnd: bigint, visible: boolean): void
  focus(hwnd: bigint): void
  holdInput(hwnd: bigint, join: boolean): boolean
  raise(hwnd: bigint): boolean
  rect(hwnd: bigint): Rect
  clientRect(hwnd: bigint): Rect
  clientToScreen(hwnd: bigint, x: number, y: number): { x: number; y: number }
}

let cached: Api | null | undefined

function load(): Api | null {
  if (cached !== undefined) return cached
  if (process.platform !== 'win32') return (cached = null)
  try {
    const koffi: any = createRequire(typeof __filename === 'string' ? __filename : process.cwd() + '/x.js')('koffi')
    const user32 = koffi.load('user32.dll')
    koffi.proto('bool __stdcall OrbisEnumProc(void *hwnd, intptr_t lparam)')
    koffi.struct('ORBIS_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    koffi.struct('ORBIS_POINT', { x: 'int32', y: 'int32' })
    const EnumWindows = user32.func('bool __stdcall EnumWindows(OrbisEnumProc *cb, intptr_t lparam)')
    const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)')
    const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hwnd, _Out_ uint16_t *buf, int max)')
    const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)')
    const SetParent = user32.func('void *__stdcall SetParent(void *child, void *parent)')
    const GetParent = user32.func('void *__stdcall GetParent(void *hwnd)')
    const IsChild = user32.func('bool __stdcall IsChild(void *parent, void *child)')
    const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int idx)')
    const SetWindowLongPtrW = user32.func('intptr_t __stdcall SetWindowLongPtrW(void *hwnd, int idx, intptr_t v)')
    const SetWindowPos = user32.func('bool __stdcall SetWindowPos(void *hwnd, void *after, int x, int y, int cx, int cy, uint32 flags)')
    const GetWindow = user32.func('void *__stdcall GetWindow(void *hwnd, uint32 cmd)')
    const ShowWindow = user32.func('bool __stdcall ShowWindow(void *hwnd, int cmd)')
    const SetFocus = user32.func('void *__stdcall SetFocus(void *hwnd)')
    const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 attach, uint32 to, bool join)')
    const GetCurrentThreadId = koffi.load('kernel32.dll').func('uint32 __stdcall GetCurrentThreadId()')
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hwnd, _Out_ ORBIS_RECT *r)')
    const GetClientRect = user32.func('bool __stdcall GetClientRect(void *hwnd, _Out_ ORBIS_RECT *r)')
    const ClientToScreen = user32.func('bool __stdcall ClientToScreen(void *hwnd, _Inout_ ORBIS_POINT *p)')
    const big = (p: unknown): bigint => (p == null ? 0n : (koffi.address(p) as bigint))
    const ptr = (h: bigint): unknown => (h === 0n ? null : koffi.as(h, 'void *'))
    const style32 = (v: unknown): number => Number(BigInt.asUintN(32, BigInt(v as number)))
    const rectOf = (fn: (h: unknown, r: unknown) => boolean, hwnd: bigint): Rect => {
      const r = { left: 0, top: 0, right: 0, bottom: 0 }
      fn(ptr(hwnd), r)
      return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
    }
    cached = {
      enumWindows(pid) {
        const found: { hwnd: bigint; cls: string; visible: boolean }[] = []
        const cb = koffi.register((h: unknown) => {
          const out = [0]
          GetWindowThreadProcessId(h, out)
          if (out[0] === pid) {
            const buf = new Uint16Array(256)
            const n = GetClassNameW(h, buf, 256)
            found.push({ hwnd: big(h), cls: String.fromCharCode(...buf.subarray(0, n)), visible: IsWindowVisible(h) })
          }
          return true
        }, 'OrbisEnumProc *')
        try {
          EnumWindows(cb, 0)
        } finally {
          koffi.unregister(cb)
        }
        return found
      },
      setParent: (c, p) => void SetParent(ptr(c), ptr(p)),
      getParent: (h) => big(GetParent(ptr(h))),
      isChild: (p, c) => IsChild(ptr(p), ptr(c)),
      isVisible: (h) => IsWindowVisible(ptr(h)),
      getStyles: (h) => ({ style: style32(GetWindowLongPtrW(ptr(h), GWL_STYLE)), ex: style32(GetWindowLongPtrW(ptr(h), GWL_EXSTYLE)) }),
      setStyles(h, style, ex) {
        SetWindowLongPtrW(ptr(h), GWL_STYLE, style | 0)
        SetWindowLongPtrW(ptr(h), GWL_EXSTYLE, ex | 0)
      },
      setPos: (h, r, show) => void SetWindowPos(ptr(h), null, r.x, r.y, r.width, r.height, SWP_NOACTIVATE | SWP_FRAMECHANGED | (show ? SWP_SHOWWINDOW : 0)),
      show: (h, v) => void ShowWindow(ptr(h), v ? SW_SHOWNA : SW_HIDE),
      focus: (h) => void SetFocus(ptr(h)),
      /**
       * Joins this process's input queue to the browser's, or parts them again.
       *
       * Windows sends a key to whatever has the focus *in the foreground thread's own queue*. The browser is a window of
       * another process embedded in ours, so while ours is the foreground window its keys go to our focus, not to the
       * browser, and the address bar cannot be typed in. Attaching merges the two queues so the browser's focus is the one
       * that counts. It has to stay attached for as long as the browser is showing: attaching only long enough to call
       * SetFocus parts the queues again straight away and the keyboard goes back to the window behind.
       */
      holdInput(h, join) {
        const target = GetWindowThreadProcessId(ptr(h), [0]) as number
        const me = GetCurrentThreadId() as number
        if (!target || target === me) return false
        return AttachThreadInput(me, target, join) as boolean
      },
      // The Orbis renderer's own window can sit above the browser window and would take its mouse clicks: keep the browser on top.
      raise(h) {
        if (big(GetWindow(ptr(h), 3)) === 0n) return false
        SetWindowPos(ptr(h), null, 0, 0, 0, 0, 0x0001 | 0x0002 | SWP_NOACTIVATE)
        return true
      },
      rect: (h) => rectOf(GetWindowRect as never, h),
      clientRect: (h) => rectOf(GetClientRect as never, h),
      clientToScreen(h, x, y) {
        const p = { x, y }
        ClientToScreen(ptr(h), p)
        return p
      }
    }
    return cached
  } catch {
    return (cached = null)
  }
}

export function embedSupported(): boolean {
  return load() !== null
}

/** The browser's main window among the windows of one process: the biggest visible top-level Chromium widget window. */
export function findBrowserWindow(pid: number): bigint | null {
  const api = load()
  if (!api) return null
  let best: { hwnd: bigint; area: number } | null = null
  for (const w of api.enumWindows(pid)) {
    if (w.cls !== 'Chrome_WidgetWin_1') continue
    const r = api.rect(w.hwnd)
    const area = r.width * r.height
    if (area > (best?.area ?? 0)) best = { hwnd: w.hwnd, area }
  }
  return best?.hwnd ?? null
}

/** The size of a window's client area in physical pixels. */
export function clientSize(hwnd: bigint): { width: number; height: number } | null {
  const r = load()?.clientRect(hwnd)
  return r ? { width: r.width, height: r.height } : null
}

export interface Embedded {
  hwnd: bigint
  /** Places the window over a region of the parent's client area, in physical pixels. */
  place(r: Rect, visible: boolean): void
  hide(): void
  /** Puts the window back on top of its siblings if something covered it. Returns whether it had to. */
  raise(): boolean
  focus(): void
  /** Joins this process's input queue to the browser's (or parts them), so the keyboard reaches the embedded window. */
  holdInput(join: boolean): boolean
  isVisible(): boolean
  parent(): bigint
  screenRect(): Rect
}

/** Makes `child` a native child of `parent` (both HWNDs): no caption, no frame, clipped to the parent. */
export function embedWindow(parent: bigint, child: bigint): Embedded {
  const api = load()
  if (!api) throw new Error('Embedding is not available on this computer.')
  const { style, ex } = api.getStyles(child)
  api.setStyles(child, ((style & ~STYLE_STRIP) | WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN) >>> 0, (ex & ~EX_STRIP) >>> 0)
  api.setParent(child, parent)
  const now = api.getStyles(child)
  api.setStyles(child, ((now.style & ~STYLE_STRIP) | WS_CHILD | WS_VISIBLE) >>> 0, now.ex)
  return {
    hwnd: child,
    place: (r, visible) => api.setPos(child, r, visible),
    hide: () => api.show(child, false),
    raise: () => api.raise(child),
    focus: () => api.focus(child),
    holdInput: (join) => api.holdInput(child, join),
    isVisible: () => api.isVisible(child),
    parent: () => api.getParent(child),
    screenRect: () => api.rect(child)
  }
}

/**
 * The browser as its own window, rather than a panel inside Orbis.
 *
 * `embedWindow` above makes Chromium a native child of the Orbis window: no caption, clipped to the parent, moving
 * when it moves. This is the opposite and does almost nothing -- the window is left exactly as Chromium made it, with
 * its own frame, its own taskbar button and its own place on screen, and all this offers is the ability to put it away
 * and bring it back.
 *
 * That difference is the whole point of the separate-window model. An embedded browser *is* the Orbis window while it
 * is showing, so there is no arrangement where you can see both. Two real windows can sit side by side, and going back
 * to the chat becomes hiding one rather than covering the other.
 *
 * Hiding, never closing. A closed browser loses every tab, and "I have finished reading for a moment" is not a request
 * to throw away what you had open.
 */
export interface Standalone {
  hwnd: bigint
  /** Puts it away, or brings it back and gives it the keyboard. */
  setVisible(visible: boolean): void
  isVisible(): boolean
  focus(): void
}

export function standaloneWindow(child: bigint): Standalone {
  const api = load()
  if (!api) throw new Error('Window control is not available on this computer.')
  /**
   * The styles are not touched.
   *
   * `embedWindow` strips the caption and the frame because a child window must not have them. Here they are what makes
   * it a window somebody can move, resize and find in the taskbar, so the only calls this makes are show, hide and
   * focus.
   */
  return {
    hwnd: child,
    setVisible: (visible) => {
      api.show(child, visible)
      if (visible) api.focus(child)
    },
    isVisible: () => api.isVisible(child),
    focus: () => api.focus(child)
  }
}

/** The HWND of an Electron BrowserWindow from getNativeWindowHandle(). */
export function hwndFromHandle(buffer: Buffer): bigint {
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0))
}

export const win32 = { load }
export { WS_VISIBLE }
