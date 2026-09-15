import { memo, useEffect, useRef, useState } from 'react'
import {
  Ban,
  Check,
  ChevronDown,
  Copy,
  CornerDownRight,
  Ellipsis,
  FileText,
  Gamepad2,
  Globe,
  LoaderCircle,
  Pause,
  Pencil,
  RefreshCw,
  Repeat,
  ShieldAlert,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Type,
  Upload,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { AutomationState, BrowserConfirmation, BrowserStep, ChatMessage } from '../../../shared/types'
import { automationActive, automationProgress } from '../../../shared/automation'
import { IMAGE_GEN_STATUS } from '../../../shared/types'
import ImageGenPlaceholder from './ImageGenPlaceholder'
import { modelLabel } from '../../../shared/models'
import { copyText, formatDuration } from '../lib/utils'
import { useDismiss } from '../lib/useDismiss'
import type { NoticeKind } from '../App'
import Markdown from './Markdown'
import ResearchSources from './ResearchSources'
import { OrbisMark } from './Brand'
import { ThinkingOrb, ThinkingText } from './Thinking'

interface Props {
  message: ChatMessage
  assistantName: string
  userName: string
  /** This message is the one currently being generated. */
  streaming: boolean
  status?: string
  canRegenerate: boolean
  canEdit: boolean
  /** Follow-up chips are clickable only while no reply is streaming. */
  canSuggest: boolean
  /** Sends a follow-up suggestion as the next message. */
  onSuggest(text: string): void
  onRegenerate(messageId: string): void
  onEdit(messageId: string, text: string): void
  /** Re-send a user message as-is, replacing the replies after it. */
  onResend(messageId: string): void
  onFeedback(messageId: string, feedback: 'up' | 'down' | undefined): void
  onNotify(text: string, kind?: NoticeKind): void
  /** Approves or cancels a browser action Orbis asked about in this reply. */
  onBrowserConfirm?(messageId: string, confirmationId: string, approved: boolean): void
  /** Pauses or stops the browser automation this reply is running. */
  onAutomationControl?(messageId: string, action: 'pause' | 'stop'): void
}

const formatTime = (ts: number): string => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function MessageItem(props: Props): React.JSX.Element {
  const { message, streaming, status } = props
  const browsing = Boolean(message.steps?.length || message.confirmation || message.automation)
  if (message.role === 'user') return <UserMessage {...props} />
  return streaming && !message.content && !browsing ? <PendingReply status={status} reasoning={message.reasoning} /> : <AssistantMessage {...props} />
}

function UserMessage({ message, userName, canEdit, onEdit, onResend, onNotify }: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    if (!draft.trim()) return
    setEditing(false)
    onEdit(message.id, draft)
  }

  const share = (): void => {
    void copyText(`**${userName}** · ${formatTime(message.createdAt)}\n\n${message.content}`).then(() => onNotify('Message copied with attribution.'))
  }

  return (
    <div className="msg user">
      <div className="msg-body">
        <div className="msg-meta">
          <time>{formatTime(message.createdAt)}</time>
          <span className="msg-name">{userName}</span>
        </div>
        {editing ? (
          <div className="edit-panel glass">
            <textarea
              value={draft}
              autoFocus
              rows={Math.min(12, draft.split('\n').length + 1)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  setEditing(false)
                }
              }}
            />
            <div className="edit-actions">
              <button className="text-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="primary-btn" onClick={submit} disabled={!draft.trim()}>
                Send
              </button>
            </div>
          </div>
        ) : (
          message.content && <div className="user-bubble">{message.content}</div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div className="attachment-row end">
            {message.attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="attachment-chip glass">
                <FileText size={13} />
                <span className="truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}
        {!editing && (
          <div className="msg-actions">
            {message.content && <CopyButton text={message.content} />}
            {canEdit && (
              <button
                className="icon-btn small"
                title="Edit message"
                onClick={() => {
                  setDraft(message.content)
                  setEditing(true)
                }}
              >
                <Pencil size={14} />
              </button>
            )}
            {canEdit && (
              <button className="icon-btn small" title="Resend for a new reply" onClick={() => onResend(message.id)}>
                <RefreshCw size={14} />
              </button>
            )}
            {message.content && (
              <button className="icon-btn small" title="Share" onClick={share}>
                <Upload size={14} />
              </button>
            )}
            {message.content && <MoreMenu getText={() => message.content} onNotify={onNotify} alignRight />}
          </div>
        )}
      </div>
      <div className="avatar user-avatar">{userName.trim().charAt(0).toUpperCase() || 'U'}</div>
    </div>
  )
}

function PendingReply({ status, reasoning }: { status?: string; reasoning?: string }): React.JSX.Element {
  if (status === IMAGE_GEN_STATUS) {
    return (
      <div className="msg assistant pending image-pending">
        <div className="avatar assistant-avatar">
          <OrbisMark size={20} />
        </div>
        <div className="msg-body">
          <ImageGenPlaceholder />
        </div>
      </div>
    )
  }
  return (
    <div className="msg assistant pending">
      <ThinkingOrb />
      <div className="msg-body">
        <ThinkingText />
        {status && <div className="stream-status">{status}</div>}
        {reasoning && <Reasoning text={reasoning} active />}
      </div>
    </div>
  )
}

function AssistantMessage(props: Props): React.JSX.Element {
  const { message, streaming, status } = props
  const cardRef = useRef<HTMLDivElement>(null)

  const plainText = (): string => cardRef.current?.querySelector('.markdown')?.textContent ?? message.content

  const share = (): void => {
    void copyText(`**${props.assistantName}** · ${formatTime(message.createdAt)}\n\n${message.content}`).then(() =>
      props.onNotify('Reply copied with attribution.')
    )
  }

  return (
    <div className="msg assistant">
      <div className="avatar assistant-avatar">
        <OrbisMark size={20} />
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-name">{props.assistantName}</span>
          <Sparkles size={11} className="meta-icon" />
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <div className="msg-card glass" ref={cardRef}>
          {message.reasoning && <Reasoning text={message.reasoning} durationMs={message.reasoningMs} />}
          {message.automation && (
            <AutomationBar
              automation={message.automation}
              live={streaming}
              onControl={props.onAutomationControl ? (action) => props.onAutomationControl?.(message.id, action) : undefined}
            />
          )}
          {message.steps && message.steps.length > 0 && <BrowserSteps steps={message.steps} active={streaming} />}
          {streaming && status && !message.confirmation && <div className="stream-status">{status}</div>}
          {message.confirmation && props.onBrowserConfirm && (
            <ConfirmationCard
              key={message.confirmation.id}
              confirmation={message.confirmation}
              onAnswer={(confirmationId, approved) => props.onBrowserConfirm?.(message.id, confirmationId, approved)}
            />
          )}
          {message.content && <Markdown text={message.content} sources={message.research?.sources} />}
          {message.research && message.research.sources.length > 0 && <ResearchSources research={message.research} content={message.content} streaming={streaming} />}
          {streaming && <span className="stream-caret" />}
          {message.error && <div className="message-error">{message.error}</div>}
        </div>
        {!streaming && (
          <div className="msg-actions">
            {message.content && <CopyButton text={message.content} />}
            <button
              className={`icon-btn small${message.feedback === 'up' ? ' on' : ''}`}
              title="Good response"
              onClick={() => props.onFeedback(message.id, message.feedback === 'up' ? undefined : 'up')}
            >
              <ThumbsUp size={14} />
            </button>
            <button
              className={`icon-btn small${message.feedback === 'down' ? ' on' : ''}`}
              title="Bad response"
              onClick={() => props.onFeedback(message.id, message.feedback === 'down' ? undefined : 'down')}
            >
              <ThumbsDown size={14} />
            </button>
            {props.canRegenerate && (
              <button className="icon-btn small" title="Regenerate" onClick={() => props.onRegenerate(message.id)}>
                <RefreshCw size={14} />
              </button>
            )}
            {message.content && (
              <button className="icon-btn small" title="Share" onClick={share}>
                <Upload size={14} />
              </button>
            )}
            {message.content && <MoreMenu getText={plainText} onNotify={props.onNotify} />}
            {message.model && <span className="model-tag">{modelLabel(message.model)}</span>}
          </div>
        )}
        {!streaming && props.canSuggest && message.suggestions && message.suggestions.length > 0 && (
          <div className="followups" role="group" aria-label="Suggested follow-ups">
            {message.suggestions.map((suggestion) => (
              <button key={suggestion} type="button" className="followup-chip" onClick={() => props.onSuggest(suggestion)}>
                <CornerDownRight size={13} />
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** "More" menu shared by user and assistant messages: read aloud and copy as plain text. */
function MoreMenu({ getText, onNotify, alignRight = false }: { getText(): string; onNotify(text: string, kind?: NoticeKind): void; alignRight?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useDismiss(rootRef, open, () => setOpen(false))

  useEffect(() => () => void (speaking && speechSynthesis.cancel()), [speaking])

  const toggleSpeech = (): void => {
    setOpen(false)
    if (speaking) {
      speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(getText())
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    speechSynthesis.cancel()
    speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  return (
    <div className="popover-anchor" ref={rootRef}>
      <button className={`icon-btn small${speaking ? ' on' : ''}`} title="More" onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={14} />
      </button>
      {open && (
        <div className={`popover glass up${alignRight ? ' align-right' : ''}`} role="menu">
          <button className="menu-item" onClick={toggleSpeech}>
            {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {speaking ? 'Stop reading' : 'Read aloud'}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              void copyText(getText()).then(() => onNotify('Copied as plain text.'))
            }}
          >
            <Type size={14} />
            Copy as plain text
          </button>
        </div>
      )}
    </div>
  )
}

function Reasoning({ text, active = false, durationMs }: { text: string; active?: boolean; durationMs?: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = active ? 'Reasoning' : durationMs ? `Thought for ${formatDuration(durationMs)}` : 'Thoughts'
  return (
    <div className={`reasoning${open ? ' open' : ''}`}>
      <button className="reasoning-toggle" onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronDown size={13} />
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  )
}

const STEP_ICONS: Record<BrowserStep['status'], React.ReactNode> = {
  done: <Check size={13} />,
  waiting: <LoaderCircle size={13} className="spin" />,
  declined: <Ban size={13} />,
  blocked: <ShieldAlert size={13} />
}

const AUTOMATION_LABELS: Record<AutomationState['status'], string> = {
  running: 'Automation running',
  'waiting-approval': 'Waiting for your approval',
  paused: 'Automation paused',
  stopped: 'Automation stopped',
  completed: 'Automation finished',
  stuck: 'Automation stopped: no progress',
  failed: 'Automation stopped: error'
}

/** Live status of a continuous automation or game, with Pause and Stop while it runs. All numbers are verified progress. */
function AutomationBar({ automation, live, onControl }: { automation: AutomationState; live: boolean; onControl?: (action: 'pause' | 'stop') => void }): React.JSX.Element {
  const active = live && automationActive(automation)
  const game = automation.kind === 'game'
  const label = game ? AUTOMATION_LABELS[automation.status].replace('Automation', 'Game automation') : AUTOMATION_LABELS[automation.status]
  const endsAt = automation.deadline ? new Date(automation.deadline).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null
  return (
    <div className={`automation-bar ${automation.status}`} role="status" aria-live="polite">
      <div className="automation-head">
        {active ? <LoaderCircle size={14} className="spin" /> : game ? <Gamepad2 size={14} /> : <Repeat size={14} />}
        <b>{label}</b>
        <span className="automation-progress">{automationProgress(automation)}</span>
        {active && onControl && (
          <span className="automation-actions">
            <button type="button" className="queue-btn" onClick={() => onControl('pause')}>
              <Pause size={11} />
              Pause
            </button>
            <button type="button" className="queue-btn danger" onClick={() => onControl('stop')}>
              <Square size={10} />
              Stop
            </button>
          </span>
        )}
      </div>
      {automation.total ? (
        <div className="automation-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (automation.completed / automation.total) * 100)}%` }} />
        </div>
      ) : null}
      <div className="automation-meta">
        <span>Goal: {automation.objective}</span>
        <span>
          Stops {automation.stopWhen}
          {endsAt ? ` (by ${endsAt})` : ''}
        </span>
        {automation.current && <span>{game ? 'Now' : 'Last item'}: {automation.current}</span>}
        {!active && automation.reason && <span>{automation.reason}</span>}
      </div>
    </div>
  )
}

/** What Orbis did in the browser for this reply; open while it works, collapsed afterwards. Long runs show their latest steps. */
function BrowserSteps({ steps, active }: { steps: BrowserStep[]; active: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(active)
  const shown = open || active
  const visible = steps.slice(-40)
  return (
    <div className={`browser-steps${shown ? ' open' : ''}`}>
      <button type="button" className="reasoning-toggle" aria-expanded={shown} onClick={() => setOpen((o) => !o)}>
        <Globe size={13} />
        {active ? 'Using the browser' : `Used the browser · ${steps.length} step${steps.length === 1 ? '' : 's'}`}
        <ChevronDown size={13} />
      </button>
      {shown && (
        <ol className="browser-step-list">
          {steps.length > visible.length && <li className="browser-step earlier">{steps.length - visible.length} earlier steps</li>}
          {visible.map((step) => (
            <li key={step.id} className={`browser-step ${step.status}`}>
              {STEP_ICONS[step.status]}
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Asks the user to approve a consequential browser action before Orbis runs it. */
function ConfirmationCard({ confirmation, onAnswer }: { confirmation: BrowserConfirmation; onAnswer(confirmationId: string, approved: boolean): void }): React.JSX.Element {
  const [answered, setAnswered] = useState(false)
  const answer = (approved: boolean): void => {
    if (answered) return
    setAnswered(true)
    onAnswer(confirmation.id, approved)
  }
  return (
    <div className="browser-confirm" role="alertdialog" aria-labelledby={`confirm-${confirmation.id}`} aria-describedby={`confirm-reason-${confirmation.id}`}>
      <div className="browser-confirm-head">
        <ShieldAlert size={15} />
        <span id={`confirm-${confirmation.id}`}>Orbis wants to:</span>
      </div>
      <p className="browser-confirm-action">{confirmation.action}</p>
      <p className="browser-confirm-reason" id={`confirm-reason-${confirmation.id}`}>
        {confirmation.reason} Nothing happens until you approve.
      </p>
      <div className="browser-confirm-buttons">
        <button type="button" className="text-btn" disabled={answered} onClick={() => answer(false)}>
          Cancel
        </button>
        <button type="button" className="primary-btn" disabled={answered} onClick={() => answer(true)}>
          Approve
        </button>
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="icon-btn small"
      title={copied ? 'Copied' : 'Copy'}
      onClick={() =>
        void copyText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

// Callbacks resolve the conversation by id, so only data props decide re-rendering.
export default memo(
  MessageItem,
  (a, b) =>
    a.message === b.message &&
    a.streaming === b.streaming &&
    a.status === b.status &&
    a.canRegenerate === b.canRegenerate &&
    a.canEdit === b.canEdit &&
    a.canSuggest === b.canSuggest &&
    a.assistantName === b.assistantName &&
    a.userName === b.userName
)
