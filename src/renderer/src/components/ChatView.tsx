import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import type { Attachment, ChatMode, Conversation, Settings } from '../../../shared/types'
import type { NoticeKind, StreamState } from '../App'
import Composer from './Composer'
import Greeting from './Greeting'
import MessageItem from './MessageItem'

interface Props {
  conversation?: Conversation
  stream?: StreamState
  settings: Settings | null
  loaded: boolean
  mode: ChatMode
  model: string
  quickPromptsOpen: boolean
  onQuickPromptsChange(open: boolean): void
  onModeChange(mode: ChatMode, model?: string): void
  onSend(text: string, attachments: Attachment[]): boolean
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

export default function ChatView(props: Props): React.JSX.Element {
  const { conversation, stream, settings } = props
  const messages = conversation?.messages ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  // Follow streaming output only while the user hasn't scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [conversation])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance < 80
    setShowJump(distance > 240)
  }

  const composer = (
    <Composer
      streaming={Boolean(stream)}
      mode={props.mode}
      model={props.model}
      quickPromptsOpen={props.quickPromptsOpen}
      onQuickPromptsChange={props.onQuickPromptsChange}
      onModeChange={props.onModeChange}
      onSend={(text, attachments) => {
        stickToBottomRef.current = true
        return props.onSend(text, attachments)
      }}
      onStop={props.onStop}
      onNotify={props.onNotify}
      onImprovePrompt={props.onImprovePrompt}
      onNewChat={props.onNewChat}
      onSearch={props.onSearch}
      onSettings={props.onOpenSettings}
    />
  )

  if (messages.length === 0) {
    return (
      <div className="stage-content">
        <div className="empty-state">
          <Greeting />
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
          {messages.map((m, i) => (
            <Fragment key={m.id}>
              {(i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt)) && (
                <div className="date-divider">
                  <span>{formatDay(m.createdAt)}</span>
                </div>
              )}
              <MessageItem
                message={m}
                assistantName={settings?.assistantName ?? 'Assistant'}
                userName={settings?.userName ?? 'You'}
                streaming={stream?.messageId === m.id}
                status={stream?.messageId === m.id ? stream.status : undefined}
                canRegenerate={!stream && i === lastAssistantIndex}
                canEdit={!stream}
                onRegenerate={props.onRegenerate}
                onEdit={props.onEdit}
                onResend={props.onResend}
                onFeedback={props.onFeedback}
                onNotify={props.onNotify}
              />
            </Fragment>
          ))}
        </div>
      </div>
      {showJump && (
        <button
          className="jump-btn glass"
          title="Scroll to bottom"
          onClick={() => {
            stickToBottomRef.current = true
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
          }}
        >
          <ArrowDown size={15} />
        </button>
      )}
      {composer}
    </div>
  )
}
