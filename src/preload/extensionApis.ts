/**
 * Chrome extension APIs Electron doesn't provide (or doesn't connect to Orbis's tabs), for extension service workers
 * and extension pages (popups, options). Registered for the browser session as both a service-worker and a frame
 * preload; in ordinary web pages it does nothing. Every call goes to the Orbis main process, which implements it for
 * real against Orbis's tabs, window, toolbar and context menu.
 */
import { contextBridge, ipcRenderer } from 'electron'

// The same script runs in service workers (no window) and in frames; only extension pages get the APIs.
const pageWindow = (globalThis as unknown as { window?: { location: { protocol: string } } }).window
const isWorker = !pageWindow
const isExtensionPage = Boolean(pageWindow && pageWindow.location.protocol === 'chrome-extension:')

if (isWorker || isExtensionPage) {
  contextBridge.exposeInMainWorld('__orbisExtensionBridge', {
    call: async (method: string, args: unknown[]) => {
      // A service worker starts running its script before Orbis has attached its handler; its first calls are retried
      // for a few seconds instead of failing.
      for (let attempt = 0; ; attempt++) {
        try {
          return await ipcRenderer.invoke('orbis-ext:call', method, args)
        } catch (err) {
          if (attempt >= 40 || !/No handler registered/.test(String((err as Error)?.message ?? err))) throw err
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    },
    listen: (callback: (name: string, args: unknown[]) => void) => {
      ipcRenderer.on('orbis-ext:event', (_event, name: string, args: unknown[]) => callback(name, args))
    }
  })

  contextBridge.executeInMainWorld({
    // Serialized into the extension's own world: it must not use anything from this file's scope.
    func: () => {
      type Fn = (...args: unknown[]) => unknown
      const g = globalThis as unknown as { chrome?: Record<string, Record<string, unknown>>; __orbisExtensionBridge?: { call(m: string, a: unknown[]): Promise<unknown>; listen(cb: (n: string, a: unknown[]) => void): void } }
      const bridge = g.__orbisExtensionBridge
      const chrome = g.chrome
      if (!bridge || !chrome) return

      const listeners = new Map<string, Set<Fn>>()
      const announced = new Set<string>()
      bridge.listen((name, args) => {
        for (const listener of [...(listeners.get(name) ?? [])]) {
          try {
            const result = listener(...(args ?? []))
            if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch((e) => console.error(e))
          } catch (e) {
            console.error(e)
          }
        }
      })
      const event = (name: string) => {
        const set = new Set<Fn>()
        listeners.set(name, set)
        return {
          addListener(fn: Fn) {
            set.add(fn)
            // The main process wakes a stopped service worker only for events it listens to.
            if (!announced.has(name)) {
              announced.add(name)
              void bridge.call('events.listen', [name]).catch(() => undefined)
            }
          },
          removeListener: (fn: Fn) => void set.delete(fn),
          hasListener: (fn: Fn) => set.has(fn),
          hasListeners: () => set.size > 0
        }
      }
      const cleanError = (e: unknown): Error => new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      // Promise style, and callback style (last argument a function) as Chrome allows.
      const call = (method: string) =>
        function (...args: unknown[]) {
          const callback = typeof args[args.length - 1] === 'function' ? (args.pop() as Fn) : null
          while (args.length && args[args.length - 1] === undefined) args.pop()
          const result = bridge.call(method, args).catch((e) => {
            throw cleanError(e)
          })
          if (!callback) return result
          result.then(
            (value) => callback(value),
            (error) => {
              console.error(`chrome.${method}:`, error.message)
              callback(undefined)
            }
          )
          return undefined
        }
      const define = (target: Record<string, unknown>, key: string, value: unknown): void => {
        try {
          Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: true })
        } catch {
          try {
            target[key] = value
          } catch {
            // Left as it was.
          }
        }
      }
      const namespace = (key: string, members: Record<string, unknown>): void => {
        const existing = chrome[key]
        if (existing && typeof existing === 'object') {
          for (const [name, value] of Object.entries(members)) define(existing, name, value)
        } else define(chrome as unknown as Record<string, unknown>, key, members)
      }

      namespace('windows', {
        WINDOW_ID_NONE: -1,
        WINDOW_ID_CURRENT: -2,
        get: call('windows.get'),
        getCurrent: call('windows.getCurrent'),
        getLastFocused: call('windows.getLastFocused'),
        getAll: call('windows.getAll'),
        create: call('windows.create'),
        update: call('windows.update'),
        remove: call('windows.remove'),
        onCreated: event('windows.onCreated'),
        onRemoved: event('windows.onRemoved'),
        onFocusChanged: event('windows.onFocusChanged'),
        onBoundsChanged: event('windows.onBoundsChanged')
      })

      namespace('tabs', {
        TAB_ID_NONE: -1,
        query: call('tabs.query'),
        get: call('tabs.get'),
        getCurrent: call('tabs.getCurrent'),
        create: call('tabs.create'),
        update: call('tabs.update'),
        remove: call('tabs.remove'),
        reload: call('tabs.reload'),
        duplicate: call('tabs.duplicate'),
        move: call('tabs.move'),
        highlight: call('tabs.highlight'),
        goBack: call('tabs.goBack'),
        goForward: call('tabs.goForward'),
        onCreated: event('tabs.onCreated'),
        onUpdated: event('tabs.onUpdated'),
        onRemoved: event('tabs.onRemoved'),
        onActivated: event('tabs.onActivated'),
        onHighlighted: event('tabs.onHighlighted'),
        onMoved: event('tabs.onMoved')
      })

      const menus = {
        ContextType: { ALL: 'all', PAGE: 'page', FRAME: 'frame', SELECTION: 'selection', LINK: 'link', EDITABLE: 'editable', IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', ACTION: 'action', BROWSER_ACTION: 'browser_action', PAGE_ACTION: 'page_action' },
        ItemType: { NORMAL: 'normal', CHECKBOX: 'checkbox', RADIO: 'radio', SEPARATOR: 'separator' },
        ACTION_MENU_TOP_LEVEL_LIMIT: 6,
        create(properties: Record<string, unknown> = {}, callback?: Fn) {
          const id = properties.id ?? `orbis-menu-${Math.random().toString(36).slice(2)}`
          const { onclick, ...rest } = properties as { onclick?: Fn }
          if (typeof onclick === 'function') {
            const set = listeners.get('contextMenus.onClicked')
            set?.add((info: unknown, tab: unknown) => {
              if ((info as { menuItemId?: unknown })?.menuItemId === id) onclick(info, tab)
            })
          }
          bridge.call('contextMenus.create', [{ ...rest, id }]).then(
            () => callback?.(),
            (e) => {
              console.error('chrome.contextMenus.create:', cleanError(e).message)
              callback?.()
            }
          )
          return id
        },
        update: call('contextMenus.update'),
        remove: call('contextMenus.remove'),
        removeAll: call('contextMenus.removeAll'),
        onClicked: event('contextMenus.onClicked')
      }
      namespace('contextMenus', menus)
      define(chrome as unknown as Record<string, unknown>, 'menus', chrome.contextMenus)

      namespace('action', {
        setBadgeText: call('action.setBadgeText'),
        getBadgeText: call('action.getBadgeText'),
        setBadgeBackgroundColor: call('action.setBadgeBackgroundColor'),
        getBadgeBackgroundColor: call('action.getBadgeBackgroundColor'),
        setBadgeTextColor: call('action.setBadgeTextColor'),
        getBadgeTextColor: call('action.getBadgeTextColor'),
        setTitle: call('action.setTitle'),
        getTitle: call('action.getTitle'),
        setIcon: function (details: Record<string, unknown>, callback?: Fn) {
          // ImageData can't cross the process boundary as-is: its pixels are copied into plain arrays first.
          const copy = (image: unknown) => {
            const d = image as { width: number; height: number; data: ArrayLike<number> }
            return d && typeof d.width === 'number' ? { width: d.width, height: d.height, data: Array.from(d.data) } : image
          }
          const imageData = details?.imageData as unknown
          const payload = { ...details }
          // Relative icon paths resolve against the calling script or page, as in Chrome ("../icons/a.png" from
          // background/index.js is /icons/a.png).
          const base = (globalThis as unknown as { location: { href: string } }).location.href
          const absolute = (p: unknown): unknown => (typeof p === 'string' ? new URL(p, base).pathname : p)
          if (typeof details?.path === 'string') payload.path = absolute(details.path)
          else if (details?.path && typeof details.path === 'object') payload.path = Object.fromEntries(Object.entries(details.path as Record<string, unknown>).map(([size, p]) => [size, absolute(p)]))
          if (imageData) {
            payload.imageData =
              typeof (imageData as { width?: unknown }).width === 'number'
                ? copy(imageData)
                : Object.fromEntries(Object.entries(imageData as Record<string, unknown>).map(([size, image]) => [size, copy(image)]))
          }
          return call('action.setIcon')(payload, ...(callback ? [callback] : []))
        },
        setPopup: call('action.setPopup'),
        getPopup: call('action.getPopup'),
        enable: call('action.enable'),
        disable: call('action.disable'),
        isEnabled: call('action.isEnabled'),
        openPopup: call('action.openPopup'),
        getUserSettings: call('action.getUserSettings'),
        onClicked: event('action.onClicked')
      })

      namespace('permissions', {
        getAll: call('permissions.getAll'),
        contains: call('permissions.contains'),
        request: call('permissions.request'),
        remove: call('permissions.remove'),
        onAdded: event('permissions.onAdded'),
        onRemoved: event('permissions.onRemoved')
      })

      if (chrome.runtime) define(chrome.runtime, 'openOptionsPage', call('runtime.openOptionsPage'))

      // Orbis doesn't give extensions access to file:// pages or private tabs, so both answers are truthfully "no".
      namespace('extension', {
        isAllowedFileSchemeAccess: function (callback?: Fn) {
          if (typeof callback === 'function') return void callback(false)
          return Promise.resolve(false)
        },
        isAllowedIncognitoAccess: function (callback?: Fn) {
          if (typeof callback === 'function') return void callback(false)
          return Promise.resolve(false)
        },
        inIncognitoContext: false
      })

      // chrome.storage.sync: Electron doesn't provide it. Orbis keeps each extension's sync area in the main process, with
      // Chrome's quotas; changes reach chrome.storage.sync.onChanged and chrome.storage.onChanged (area "sync").
      const storage = chrome.storage as Record<string, unknown> | undefined
      if (storage) {
        const syncListeners = new Set<Fn>()
        const areaListeners = new Set<Fn>()
        const announceStorage = (): void => {
          if (announced.has('storage.onChanged')) return
          announced.add('storage.onChanged')
          void bridge.call('events.listen', ['storage.onChanged']).catch(() => undefined)
        }
        listeners.set(
          'storage.onChanged',
          new Set<Fn>([
            (changes: unknown, area: unknown) => {
              if (area !== 'sync') return
              for (const fn of [...syncListeners]) fn(changes)
              for (const fn of [...areaListeners]) fn(changes, 'sync')
            }
          ])
        )
        define(storage, 'sync', {
          QUOTA_BYTES: 102_400,
          QUOTA_BYTES_PER_ITEM: 8_192,
          MAX_ITEMS: 512,
          MAX_WRITE_OPERATIONS_PER_HOUR: 1_800,
          MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
          get: call('storage.sync.get'),
          set: call('storage.sync.set'),
          remove: call('storage.sync.remove'),
          clear: call('storage.sync.clear'),
          getBytesInUse: call('storage.sync.getBytesInUse'),
          onChanged: {
            addListener(fn: Fn) {
              syncListeners.add(fn)
              announceStorage()
            },
            removeListener: (fn: Fn) => void syncListeners.delete(fn),
            hasListener: (fn: Fn) => syncListeners.has(fn),
            hasListeners: () => syncListeners.size > 0
          }
        })
        const native = storage.onChanged as { addListener?: Fn; removeListener?: Fn; hasListener?: Fn } | undefined
        if (native && typeof native.addListener === 'function') {
          const add = native.addListener.bind(native)
          const remove = native.removeListener?.bind(native)
          const has = native.hasListener?.bind(native)
          define(native as Record<string, unknown>, 'addListener', (fn: Fn) => {
            areaListeners.add(fn)
            announceStorage()
            return add(fn)
          })
          define(native as Record<string, unknown>, 'removeListener', (fn: Fn) => {
            areaListeners.delete(fn)
            return remove?.(fn)
          })
          define(native as Record<string, unknown>, 'hasListener', (fn: Fn) => areaListeners.has(fn) || Boolean(has?.(fn)))
        }
      }
    }
  })
}
