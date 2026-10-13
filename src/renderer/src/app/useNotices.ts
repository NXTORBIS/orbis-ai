/**
 * Notices, toasts and the unread counter.
 *
 * Pulled out of App.tsx so the notification logic — which half the screens callback into — is in one place
 * rather than interleaved with the chat pipeline.
 */
import { useCallback, useRef, useState } from 'react'
import { newId } from '../lib/utils'
import type { Notice, NoticeKind } from '../lib/notices'

export interface NoticesHandle {
  notices: Notice[]
  setNotices: React.Dispatch<React.SetStateAction<Notice[]>>
  unread: number
  setUnread: React.Dispatch<React.SetStateAction<number>>
  toasts: Notice[]
  setToasts: React.Dispatch<React.SetStateAction<Notice[]>>
  notify: (text: string, kind?: NoticeKind) => void
  logActivity: (text: string, kind: NoticeKind) => void
  /** Ref that always points at the current `notify`, for callbacks that should not re-close over it. */
  notifyRef: React.MutableRefObject<(text: string, kind?: NoticeKind) => void>
  /** Keep in sync with activityOpen from outside. */
  activityOpenRef: React.MutableRefObject<boolean>
}

export function useNotices(): NoticesHandle {
  const [notices, setNotices] = useState<Notice[]>([])
  const [unread, setUnread] = useState(0)
  const [toasts, setToasts] = useState<Notice[]>([])
  const activityOpenRef = useRef(false)
  const notifyRef = useRef<(text: string, kind?: NoticeKind) => void>(() => undefined)

  const notify = useCallback((text: string, kind: NoticeKind = 'info') => {
    const toast = { id: newId(), text, kind, at: Date.now() }
    setToasts((current) => [...current.slice(-3), toast])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== toast.id)), kind === 'info' ? 3000 : 5000)
  }, [])

  const logActivity = useCallback((text: string, kind: NoticeKind) => {
    setNotices((current) => [...current.slice(-49), { id: newId(), text, kind, at: Date.now() }])
    if (!activityOpenRef.current) setUnread((n) => n + 1)
  }, [])

  notifyRef.current = notify

  return { notices, setNotices, unread, setUnread, toasts, setToasts, notify, logActivity, notifyRef, activityOpenRef }
}
