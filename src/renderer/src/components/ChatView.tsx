import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, HatGlasses } from 'lucide-react'
import type { Attachment, Conversation, Settings } from '../../../shared/types'
import type { NoticeKind, StreamState } from '../App'
import type { ChatQueue } from '../lib/messageQueue'
import Composer from './Composer'
import MemoryOffer from './MemoryOffer'
import ChatRail from './ChatRail'
import Greeting from './Greeting'
import MessageItem from './MessageItem'
import type { Anchored, ChatScrollState, ScrollAction, Viewport } from '../../../shared/chatScroll'
import {
  jumpVisible,
  keepAnchored,
  newChatScrollState,
  onJumpPressed,
  onLayoutChanged,
  onRendered,
  onScrolled,
  roomUnderTurn,
  settled
} from '../../../shared/chatScroll'

interface Props {
  conversation?: Conversation
  stream?: StreamState
  settings: Settings | null
  loaded: boolean
  model: string
  incognito: boolean
  quickPromptsOpen: boolean
  onQuickPromptsChange(open: boolean): void
  onModelChange(model: string): void
  onSend(text: string, attachments: Attachment[]): boolean
  onCommand(name: string, args: string): void
  onBrowserConfirm(messageId: string, confirmationId: string, approved: boolean): void
  onAutomationControl(messageId: string, action: 'pause' | 'stop'): void
  queue?: ChatQueue
  onRemoveQueued(itemId: string): void
  onClearQueue(): void
  onResumeQueue(): void
  onStop(): void
  onRegenerate(messageId: string): void
  onEdit(messageId: string, text: string): void
  onResend(messageId: string): void
  onFeedback(messageId: string, feedback: 'up' | 'down' | undefined): void
  onNotify(text: string, kind?: NoticeKind): void
  onImprovePrompt(text: string): Promise<string | null>
  onOpenSettings(): void
  onNewChat?(): void
  onSearch?(): void
}

const dayKey = (ts: number): string => new Date(ts).toDateString()
const formatDay = (ts: number): string => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/**
 * The message inside a slot, which is the thing that has a place on the page.
 *
 * A slot wraps a message only so it can be found by id, and takes no space of its own (`display: contents`). It has
 * no box: it cannot be scrolled to and its position always reads as zero. Asking the slot where it is was why a new
 * question was not brought into view and why the reader's place was not held -- both were measuring nothing.
 */
const boxOf = (slot: Element | null): HTMLElement | null => (slot?.firstElementChild as HTMLElement | null) ?? null

export default function ChatView(props: Props): React.JSX.Element {
  const { conversation, stream, settings } = props
  const messages = conversation?.messages ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * When Orbis may move the page.
   *
   * Every decision is in `shared/chatScroll.ts`, which knows nothing about the DOM and is tested on its own. This is
   * the part that measures the scroller and carries the answers out -- deliberately the smaller half, because the
   * deciding is what used to be wrong.
   */
  const scroll = useRef<ChatScrollState>(newChatScrollState())
  const [showJump, setShowJump] = useState(false)
  const showJumpRef = useRef(false)
  showJumpRef.current = showJump

  /**
   * The message the reader is looking at, and where it sat.
   *
   * Kept current by everything that moves the scroller, not just by the last layout change -- otherwise it would say
   * the reader was wherever they happened to be when an image last loaded, and putting them back "where they were"
   * would move them somewhere they had left.
   */
  const was = useRef<Anchored & { id: string | null }>({ scrollTop: 0, anchorTop: 0, id: null })

  /**
   * The topmost message still on screen.
   *
   * That is the one whose movement the reader would notice. Found by walking from the top, which is cheap because it
   * stops at the first one and the messages are in order.
   */
  const anchorOf = useCallback((el: HTMLElement): { id: string | null; anchorTop: number } => {
    const top = el.scrollTop
    for (const slot of Array.from(el.querySelectorAll<HTMLElement>('[data-msg-id]'))) {
      const node = boxOf(slot)
      if (node && node.offsetTop + node.offsetHeight > top) {
        return { id: slot.dataset.msgId ?? null, anchorTop: node.offsetTop }
      }
    }
    return { id: null, anchorTop: 0 }
  }, [])

  const measure = useCallback(
    (el: HTMLElement): Viewport => {
      const anchor = anchorOf(el)
      was.current = { scrollTop: el.scrollTop, anchorTop: anchor.anchorTop, id: anchor.id }
      return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
    },
    [anchorOf]
  )

  /**
   * Carries out one decision, and records where the scroller ended up.
   *
   * Recording it is what lets the scroll event this causes be recognised as Orbis's own rather than the person's --
   * without which every move Orbis made would be undone by its own echo a frame later.
   */
  /**
   * Writes the mode onto the scroller.
   *
   * The state itself is a ref, so that a wheel turn does not render the conversation -- but a state nothing can see is
   * a state nothing can check. One attribute makes it readable by a test, by the styles, and by anybody wondering why
   * the page did or did not move.
   */
  const reflect = useCallback((el: HTMLElement): void => {
    el.dataset.follow = scroll.current.mode
  }, [])

  const perform = useCallback((el: HTMLElement, action: ScrollAction): void => {
    reflect(el)
    if (action.kind === 'none') return
    if (action.kind === 'toTurn') {
      boxOf(el.querySelector(`[data-msg-id="${CSS.escape(action.messageId)}"]`))?.scrollIntoView({ block: 'start' })
    } else if (action.smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
    // Read back rather than assumed: a smooth scroll has not arrived yet, and `scrollIntoView` lands where the layout
    // allows rather than where it was asked to.
    scroll.current = settled(scroll.current, el.scrollTop)
    const now = measure(el)
    reflect(el)
    // The button is decided from where the scroller now is, not left to the scroll event this may or may not produce:
    // a move to where it already was fires nothing, and a move Orbis made is ignored as its own echo. Without this the
    // way back would stay on screen after the very press that made it unnecessary.
    setShowJump((shown) => jumpVisible(now, shown))
  }, [measure, reflect])

  /**
   * The question that was last scrolled to, which is the one given room under it.
   *
   * Only a question asked while this view was open. A conversation that has just been opened lands at its end, and
   * room under its last question would be a screen of nothing to land on.
   */
  const tailTurn = useRef<string | null>(null)
  const tailRef = useRef<HTMLDivElement>(null)

  /** Sizes the room under the newest turn: enough for its question to reach the top, and no more. */
  const fitTail = useCallback((el: HTMLElement): void => {
    const tail = tailRef.current
    const inner = tail?.parentElement
    if (!tail || !inner) return
    const question = tailTurn.current ? boxOf(el.querySelector(`[data-msg-id="${CSS.escape(tailTurn.current)}"]`)) : null
    let room = 0
    if (question) {
      // From the top of the question to the end of the content, with the space kept under the last message.
      const padding = inner.offsetTop + inner.offsetHeight - (tail.offsetTop + tail.offsetHeight)
      room = roomUnderTurn(el.clientHeight, tail.offsetTop - question.offsetTop + padding)
    }
    // Written only when it changes: a write is a layout, and this runs for every piece of a reply.
    if (tail.offsetHeight !== room) tail.style.height = `${room}px`
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const { state, action } = onRendered(scroll.current, {
      conversationId: conversation?.id ?? null,
      lastUserId: messages.findLast((m) => m.role === 'user')?.id ?? null
    })
    if (action.kind === 'toTurn') tailTurn.current = action.messageId
    else if (state.conversationId !== scroll.current.conversationId) tailTurn.current = null
    scroll.current = state
    // Before the move, so the move has somewhere to go.
    fitTail(el)
    perform(el, action)
  }, [conversation, messages, perform, fitTail])

  /**
   * The page changing shape for reasons that are not new messages: the window resizing, the sidebar opening, an image
   * finishing loading, a code block being highlighted.
   *
   * A follower is kept at the end. A reader is put back where they were, by the number of pixels that appeared above
   * them -- which is what stops the thing they are reading sliding out from under them.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    measure(el)
    const observer = new ResizeObserver(() => {
      const before = was.current
      // The answer grew, or the window changed size: the room under the turn is whatever is still needed.
      fitTail(el)
      const action = onLayoutChanged(scroll.current)
      if (action.kind === 'none') {
        // Only the same message can be compared with itself. If the one the reader was looking at has gone -- a
        // conversation switched, a message deleted -- there is nothing to hold still and nothing is moved.
        const node = before.id ? boxOf(el.querySelector(`[data-msg-id="${CSS.escape(before.id)}"]`)) : null
        const next = node
          ? keepAnchored(before, { anchorTop: node.offsetTop }, el.scrollHeight - el.clientHeight)
          : null
        if (next !== null) {
          el.scrollTop = next
          scroll.current = settled(scroll.current, el.scrollTop)
        }
      } else {
        perform(el, action)
      }
      measure(el)
    })
    observer.observe(el)
    // The content, not just the box: a code block growing changes the scroll height without changing the scroller.
    for (const child of Array.from(el.children)) observer.observe(child)
    // And children that arrive later, which is most of them: a message added after this ran would otherwise grow
    // unobserved, and the reader would be moved by something nothing was watching.
    const watcher = new MutationObserver((changes) => {
      for (const change of changes) {
        for (const added of Array.from(change.addedNodes)) {
          if (added instanceof Element) observer.observe(added)
        }
      }
    })
    watcher.observe(el, { childList: true })
    return () => {
      watcher.disconnect()
      observer.disconnect()
    }
  }, [measure, perform, fitTail, conversation?.id])

  /**
   * A scroll happened. Whose it was is decided by position, then acted on.
   *
   * The state is a ref rather than React state so that a wheel turn does not render the conversation. Only the jump
   * button's visibility is state, and only when it actually changes.
   */
  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const outcome = onScrolled(scroll.current, measure(el), showJumpRef.current)
    scroll.current = outcome.state
    reflect(el)
    if (outcome.showJump !== showJumpRef.current) setShowJump(outcome.showJump)
  }, [measure, reflect])

  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const completeDraft = useCallback(
    (draft: string) =>
      window.api.completeDraft(
        draft,
        messagesRef.current.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content }))
      ),
    []
  )

  const last = messages.at(-1)
  // Offered after the reply, so it never interrupts: the last thing the person said, if it was about them.
  const lastUserMessage = !stream ? messages.findLast((m) => m.role === 'user')?.content : undefined
  const composer = (
    <>
      <MemoryOffer message={lastUserMessage} onNotify={props.onNotify} />
      <Composer
      streaming={Boolean(stream)}
      model={props.model}
      prediction={!stream && last?.role === 'assistant' ? last.prediction : undefined}
      onCompleteDraft={completeDraft}
      draftContextKey={`${conversation?.id ?? 'new'}:${last?.id ?? ''}:${stream ? 'live' : 'idle'}`}
      queue={props.queue}
      onRemoveQueued={props.onRemoveQueued}
      onClearQueue={props.onClearQueue}
      onResumeQueue={props.onResumeQueue}
      effects={settings?.effects !== false}
      quickPromptsOpen={props.quickPromptsOpen}
      onQuickPromptsChange={props.onQuickPromptsChange}
      onModelChange={props.onModelChange}
      onSend={(text, attachments) => props.onSend(text, attachments)}
      onCommand={props.onCommand}
      onStop={props.onStop}
      onNotify={props.onNotify}
      onImprovePrompt={props.onImprovePrompt}
      onNewChat={props.onNewChat}
      onSearch={props.onSearch}
      onSettings={props.onOpenSettings}
      />
    </>
  )

  if (messages.length === 0) {
    return (
      <div className="stage-content">
        <div className="empty-state">
          <Greeting />
          {props.incognito && (
            <p className="incognito-note">
              <HatGlasses size={14} />
              Incognito chat. It won't be saved or appear in your history, and it's gone once you leave.
            </p>
          )}
        </div>
        {composer}
      </div>
    )
  }

  const lastAssistantIndex = messages.findLastIndex((m) => m.role === 'assistant')

  return (
    <div className="stage-content">
      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        <div className="messages-inner">
          {props.incognito && (
            <div className="incognito-banner">
              <HatGlasses size={13} />
              Incognito chat · not saved
            </div>
          )}
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {(i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt)) && (
                <div className="date-divider">
                  <span>{formatDay(m.createdAt)}</span>
                </div>
              )}
              <div className="msg-slot" data-msg-id={m.id}>
              <MessageItem
                message={m}
                assistantName={settings?.assistantName ?? 'Assistant'}
                userName={settings?.userName ?? 'You'}
                streaming={stream?.messageId === m.id}
                status={stream?.messageId === m.id ? stream.status : undefined}
                canRegenerate={!stream && i === lastAssistantIndex}
                canEdit={!stream}
                canSuggest
                onSuggest={(text) => {
                  props.onSend(text, [])
                }}
                onRegenerate={props.onRegenerate}
                onEdit={props.onEdit}
                onResend={props.onResend}
                onFeedback={props.onFeedback}
                onNotify={props.onNotify}
                onBrowserConfirm={props.onBrowserConfirm}
                onAutomationControl={props.onAutomationControl}
              />
              </div>
            </Fragment>
          ))}
          <div className="messages-tail" ref={tailRef} aria-hidden="true" />
        </div>
      </div>
      <ChatRail messages={messages} scrollRef={scrollRef} userName={settings?.userName ?? 'You'} />
      {showJump && (
        <button
          className="jump-btn glass"
          title="Scroll to bottom"
          onClick={() => {
            const el = scrollRef.current
            if (!el) return
            // Asked for, so it is given -- and from here the newest output is followed until they leave again.
            // Instantly for somebody who has asked for less movement; the journey is the only part that is optional.
            const reducedMotion = document.documentElement.dataset.motion === 'reduced'
            const { state, action } = onJumpPressed(scroll.current, reducedMotion)
            scroll.current = state
            perform(el, action)
          }}
        >
          <ArrowDown size={15} />
        </button>
      )}
      {composer}
    </div>
  )
}
