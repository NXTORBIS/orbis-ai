import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ChevronLeft, Expand, Maximize2, Minimize2, Pause, Play, RotateCcw, X } from 'lucide-react'
import type { NoticeKind } from '../../lib/notices'
import { APP_SIZES } from '../../../../shared/native/manifest'
import { useSurface } from '../../lib/surfaces'
import { nativeAppSurface } from './labSurfaces'
import { Surface, hasSurface, type LiveInstance } from './surfaces'
import { appIcon } from './icons'
import AskBar from './AskBar'
import './native.css'

/**
 * A Native App, shown in the conversation it was opened in.
 *
 * ## The message carries a pointer; this reads the live app
 *
 * Exactly the pattern `ArtifactCard` already uses. The reply holds `{ appId, instanceId }` and everything on this card
 * comes from the runtime when the card is drawn. So a conversation does not get slower as apps accumulate, an app
 * shows what it holds now rather than what it held when the reply was written, and a card whose app has been closed
 * says so instead of offering buttons that fail.
 *
 * ## The host is quiet and owns nothing domain-specific
 *
 * A title, a size control, the lifecycle buttons the app actually supports, and the app's own screen filling the rest.
 * There is no gravity slider in here and there never will be: the app owns its interior, which is why Physics feels
 * like Physics and Statistics does not.
 *
 * ## Telling the runtime what it cannot see
 *
 * The card reports when it scrolls out of view, so an app that asked to pause when hidden actually pauses. Without it
 * `whenHidden` would be a field nothing reads.
 */

export interface AppReference {
  appId: string
  instanceId: string
  appVersion: number
}

interface Instance {
  id: string
  appId: string
  appName: string
  appVersion: number
  surface: { kind: string; ref: string }
  phase: string
  generation: number
  size: 'compact' | 'expanded' | 'workspace'
  values: Record<string, string | number | boolean | number[]>
  described: Record<string, string>
  shown: string[]
  definitions: LiveInstance['definitions']
  domain: Record<string, unknown>
  failure: { says: string; recovery: string } | null
  effort: string
}

interface Card {
  state:
    | { show: 'app'; size: 'compact' | 'expanded' | 'workspace' }
    | { show: 'closed'; says: string }
    | { show: 'failed'; says: string; recovery: string }
    | { show: 'gone'; says: string }
    | { show: 'retired'; says: string }
  note: string | null
  name: string
}

function NativeAppCard({
  reference,
  onNotify
}: {
  reference: AppReference
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [card, setCard] = useState<Card | null>(null)
  const [instance, setInstance] = useState<Instance | null>(null)
  const [busy, setBusy] = useState(false)

  /*
   * Full page is a view, not a size.
   *
   * The three sizes are the app's own state: declared in its manifest, checked by the main process and written
   * down with the conversation. Whether somebody is looking at it full screen right now is none of that, so it
   * lives here and is forgotten when the card unmounts.
   *
   * It exists because a studio does not fit in a chat bubble: the Physics Studio lays out about 1,700 pixels tall
   * and the card gives it 700, so most of it was permanently below the fold.
   *
   * It must be declared here, with the other hooks, and not further down beside the code that uses it. A card
   * that is closed or failed returns before that point, and a hook that runs only sometimes is React error #310.
   */
  const [fullPage, setFullPage] = useState(false)
  /*
   * A workspace-sized app opens full page.
   *
   * These are the laboratories: a studio with a canvas, a parameter panel and live graphs. In a chat bubble their
   * controls sit below the fold and have to be scrolled to, which is the first thing anybody notices. Anything
   * that opens compact or expanded is small enough to belong in the conversation and is left there.
   *
   * Once per instance: somebody who presses Back to the chat must not be thrown into full page again on the next
   * render.
   */
  const decided = useRef(false)

  // Escape leaves full page rather than closing the app, which is what every other overlay in Orbis does.
  useEffect(() => {
    if (!fullPage) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setFullPage(false)
    }
    window.addEventListener('keydown', onKey, true)
    // The page behind must not scroll while a full-page lab is over it.
    const had = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = had
    }
  }, [fullPage])
  const frame = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    const [found, held] = await Promise.all([
      window.api.native('card', reference).catch(() => null) as Promise<Card | null>,
      window.api.native('instance', reference.instanceId).catch(() => null) as Promise<Instance | null>
    ])
    setCard(found)
    setInstance(held)
  }, [reference])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (decided.current || card === null) return
    decided.current = true
    if (card.state.show === 'app' && card.state.size === 'workspace') setFullPage(true)
  }, [card])

  /*
   * Re-read when this instance changes underneath us.
   *
   * The card used to read its instance once and never again, which was fine while it was the only thing that
   * changed an app. Orion configures them too, and then the card went on showing the old settings — the screen
   * quietly disagreeing with what the reply said had happened.
   */
  useEffect(() => {
    if (typeof window.api.onNativeChanged !== 'function') return undefined
    return window.api.onNativeChanged((instanceId) => {
      if (instanceId === reference.instanceId) void load()
    })
  }, [load, reference.instanceId])

  // The runtime cannot see the viewport, so the card tells it. This is what makes `whenHidden` real.
  useEffect(() => {
    const element = frame.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) void window.api.native('on-screen', reference.instanceId, entry.isIntersecting).catch(() => undefined)
      },
      { rootMargin: '200px' }
    )
    watcher.observe(element)
    return () => {
      watcher.disconnect()
      // Leaving the conversation is the same as scrolling away, as far as the app's clock is concerned.
      void window.api.native('on-screen', reference.instanceId, false).catch(() => undefined)
    }
  }, [reference.instanceId])

  // The app's own screen has mounted, so the runtime can stop calling it loading.
  useEffect(() => {
    if (instance?.phase === 'loading') void window.api.native('ready', reference.instanceId).then(() => void load())
  }, [instance?.phase, reference.instanceId, load])

  const act = useCallback(
    async (op: string, a?: unknown) => {
      setBusy(true)
      const found = (await window.api.native(op, reference.instanceId, a).catch(() => null)) as Instance | null
      setBusy(false)
      if (found) setInstance(found)
      await load()
      return found
    },
    [reference.instanceId, load]
  )

  /**
   * Parameters set through the runtime.
   *
   * Returns the refusals by parameter id so the panel can show each one against the field that caused it. A refusal
   * is not an error here -- it is the runtime declining a value, which is the behaviour the whole parameter system
   * exists for.
   */
  const configure = useCallback(
    async (next: Record<string, unknown>): Promise<Readonly<Record<string, string>> | null> => {
      const found = (await window.api.native('configure', reference.instanceId, next).catch(() => null)) as
        | { instance?: Instance; changed?: string[] }
        | { ok?: boolean; says?: string; warnings?: string[] }
        | null

      if (found && 'instance' in found && found.instance) {
        setInstance(found.instance)
        return null
      }

      // A refusal. Attribute it to the parameter it names where possible, so it appears under the right field.
      const says = (found as { says?: string } | null)?.says ?? 'That value was not accepted.'
      const out: Record<string, string> = {}
      for (const id of Object.keys(next)) out[id] = says
      return out
    },
    [reference.instanceId]
  )

  const reopen = useCallback(async () => {
    setBusy(true)
    const made = (await window.api
      .native('open', { appId: reference.appId, conversationId: null })
      .catch(() => null)) as { ok?: boolean; says?: string } | null
    setBusy(false)
    if (made?.ok) {
      onNotify(made.says ?? 'Opened.')
      await load()
    } else {
      onNotify(made?.says ?? 'That app could not be opened.', 'warn')
    }
  }, [reference.appId, onNotify, load])

  /*
   * What Orbis itself may do with this laboratory, said by the card rather than by anything that holds a list of
   * laboratories.
   *
   * Every control comes from the app's own declared parameters -- with their units, their ranges and their options --
   * and every write goes through `configure`, the same function the panel's own fields call. So a laboratory is
   * controllable down to the parameter the day it registers, and none of it is written down twice.
   *
   * Above the early returns, because a hook that runs only sometimes is React error #310: a card that is loading,
   * closed or failed returns before this point, and the getters below say so rather than guessing.
   */
  useSurface(
    nativeAppSurface({
      appId: reference.appId,
      name: () => card?.name ?? reference.appId,
      instance: () => instance,
      why: () => (card === null ? 'This card has not finished loading.' : card.state.show === 'app' ? null : card.state.says),
      busy: () => busy,
      configure,
      act: (operation, argument) => act(operation, argument),
      fullPage: () => fullPage,
      setFullPage,
      sizes: APP_SIZES
    })
  )

  if (!card) return <div className="na-card na-loading" aria-label="Loading" ref={frame} />

  const Icon = appIcon(instance ? instance.surface.ref : 'flask')

  // ---------------------------------------------------------------- the states that are not an app

  if (card.state.show !== 'app') {
    const { state } = card
    return (
      <div className="na-card na-quiet" ref={frame} role="group" aria-label={card.name}>
        <header className="na-head">
          <strong>{card.name}</strong>
        </header>
        <p className="na-says">
          {state.show === 'failed' && <AlertTriangle size={14} aria-hidden />} {state.says}
        </p>
        {(state.show === 'closed' || state.show === 'gone') && (
          <div className="na-actions">
            <button type="button" className="na-btn" disabled={busy} onClick={() => void reopen()}>
              Open it again
            </button>
          </div>
        )}
        {state.show === 'failed' && (
          <div className="na-actions">
            {/* The buttons the failure itself named. A retry that would fail the same way is not offered. */}
            {state.recovery === 'restore' && (
              <button
                type="button"
                className="na-btn"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    const made = (await window.api.native('restore', reference.instanceId).catch(() => null)) as
                      | { ok?: boolean; says?: string }
                      | null
                    onNotify(made?.says ?? 'That could not be restored.', made?.ok ? 'info' : 'warn')
                    await load()
                  })()
                }}
              >
                Restore the last saved state
              </button>
            )}
            {state.recovery === 'restart' && (
              <button type="button" className="na-btn" disabled={busy} onClick={() => void reopen()}>
                Start it again
              </button>
            )}
            <button type="button" className="na-btn quiet" disabled={busy} onClick={() => void act('close')}>
              Close
            </button>
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------- the app itself

  const size = card.state.size
  const running = instance?.phase === 'running'
  const canGrow = size !== 'workspace'

  const summary = (instance?.shown ?? [])
    .map((id) => instance?.described[id])
    .filter((one): one is string => Boolean(one))
    .slice(0, 4)
    .join(' · ')

  /*
   * Full page goes through a portal, and it has to.
   *
   * The card sits inside a message bubble carrying `backdrop-filter`, and an ancestor with a filter, a transform
   * or a backdrop-filter becomes the containing block for anything `position: fixed` inside it. So the overlay
   * was not covering the window at all: it was being laid out inside the bubble and came out 718 by 28 pixels.
   * Moving it to the body is the only way `inset: 0` means the window.
   */
  const shell = (
    <div
      className={`na-card na-${size}${fullPage ? ' na-full' : ''}`}
      /* So a card on screen can be tied back to the instance it is drawing — there was no way to do that, which
         made it impossible to tell two open copies of the same app apart from outside. */
      data-instance={reference.instanceId}
      data-app={reference.appId}
      ref={frame}
      role={fullPage ? 'dialog' : 'group'}
      aria-modal={fullPage ? true : undefined}
      aria-label={card.name}
    >
      <header className="na-head">
        <Icon size={15} aria-hidden />
        <strong>{card.name}</strong>
        {summary && <span className="na-summary">{summary}</span>}

        <div className="na-head-buttons">
          {/* Only offered for an app that has a clock. A play button on a plotter is a control that does nothing. */}
          {instance && (instance.phase === 'running' || instance.phase === 'paused') && (
            <button
              type="button"
              className="icon-btn small"
              aria-label={running ? 'Pause' : 'Run'}
              title={running ? 'Pause' : 'Run'}
              disabled={busy}
              onClick={() => void act(running ? 'pause' : 'run')}
            >
              {running ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
            </button>
          )}
          <button
            type="button"
            className="icon-btn small"
            aria-label="Put back to its starting values"
            title="Put back to its starting values"
            disabled={busy}
            onClick={() => {
              void (async () => {
                await act('reset')
                onNotify(`${card.name} is back at its starting values.`)
              })()
            }}
          >
            <RotateCcw size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn small"
            aria-label={canGrow ? 'Make it bigger' : 'Make it smaller'}
            title={canGrow ? 'Make it bigger' : 'Make it smaller'}
            disabled={busy}
            onClick={() => void act('resize', canGrow ? (size === 'compact' ? 'expanded' : 'workspace') : 'expanded')}
          >
            {canGrow ? <Maximize2 size={14} aria-hidden /> : <Minimize2 size={14} aria-hidden />}
          </button>
          {/*
            * Full page, and the way out of it.
            *
            * Out is a labelled button rather than an icon: an icon that means "back to the conversation" is one
            * nobody finds, and full page covers the conversation completely, so not finding it is being stuck.
            */}
          {fullPage ? (
            <button type="button" className="na-back" onClick={() => setFullPage(false)} title="Back to the conversation (Esc)">
              <ChevronLeft size={14} aria-hidden />
              Back to chat
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn small"
              aria-label="Open full page"
              title="Open full page"
              onClick={() => setFullPage(true)}
            >
              <Expand size={14} aria-hidden />
            </button>
          )}
          <button type="button" className="icon-btn small" aria-label="Close" title="Close" disabled={busy} onClick={() => void act('close')}>
            <X size={14} aria-hidden />
          </button>
        </div>
      </header>

      {/* Said rather than hidden: a card under an old reply drawn by a newer app is showing something else. */}
      {card.note && <p className="na-note">{card.note}</p>}

      <div className="na-body">
        {/*
          * Both kinds of screen, because both are screens.
          *
          * This read `kind === 'page'` only. A laboratory adopted from Pages declares `page`; every laboratory built
          * for this platform -- the algorithms, the molecules, the circuits, the logic, the processor, the operating
          * system, the networks, the images, the learning, the neural networks -- declares `native`. So each of those
          * fell past this line to the sentence at the bottom and said its screen was not part of the build, while the
          * component sat in `surfaces.tsx` and the engine sat behind it. Four phases of work, registered, searchable,
          * openable, and showing one apologetic line.
          *
          * `hasSurface` is what decides whether a screen exists, and it is the same answer for both kinds. The kind
          * says where the screen came from, which is not something the card needs to know.
          */}
        {instance && (instance.surface.kind === 'page' || instance.surface.kind === 'native') && hasSurface(instance.appId) ? (
          <Surface
            appId={instance.appId}
            props={{
              // The slug the Pages register knows it by. A built laboratory ignores this and talks to its own worker.
              pageId: instance.surface.ref || instance.appId,
              onNotify,
              initial: startingText(instance.values),
              instance: instance as unknown as LiveInstance,
              onConfigure: configure
            }}
          />
        ) : instance && instance.surface.kind === 'artifact' ? (
          /* The Creation Engine already draws this one, and its card is the one in the reply. */
          <p className="na-missing">
            {card.name} is drawn by the Creation Engine — its own card in this conversation is the one to use. This
            entry exists so Orion can find it by what it does.
          </p>
        ) : (
          <p className="na-missing">
            This app is registered and its screen is not part of this build. Nothing has been lost.
          </p>
        )}
      </div>
      {/* Only when full page. In a chat bubble the real composer is a few pixels below, and two would be odd. */}
      {fullPage && <AskBar about={card.name} />}
    </div>
  )

  return fullPage ? createPortal(shell, document.body) : shell
}

/**
 * Parameter values as the starting text for an app's own fields.
 *
 * Deliberately the raw values and not the described ones. A described number carries its unit ("9.81 m/s²"), which a
 * field expecting a number cannot read; a described choice carries its label ("quadratic — ordinary speeds in air")
 * rather than the id the component compares against; and a described list of a dozen numbers is summarised as a count.
 * Each of those would land a value in a field that looks right and is not.
 */
function startingText(values: Record<string, string | number | boolean | number[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, value] of Object.entries(values)) {
    out[id] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

export default memo(NativeAppCard)
