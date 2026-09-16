import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  Circle,
  ExternalLink,
  FolderOpen,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { PanelId } from '../../../shared/browserSidebar'
import type { BrowserLibrarySnapshot, Conversation, InstalledExtension, PageShot, Research, SitePermissionDecision } from '../../../shared/types'
import type { CapabilityDescriptor } from '../../../shared/browserControl'
import type { NoticeKind } from '../App'
import type { Experience } from '../lib/experience'
import type { TabGroup } from './TabContextMenu'
import { PanelFrame } from './BrowserSidebar'
import AdBlockSection from './AdBlockSection'
import BrowserLibraryPanel from './BrowserLibraryPanel'
import type { ClosedTab, LibraryTab } from './BrowserLibraryPanel'

const NotesView = lazy(() => import('./NotesView'))
const TasksView = lazy(() => import('./TasksView'))
const ClipboardView = lazy(() => import('./ClipboardView'))
const WhiteboardView = lazy(() => import('./WhiteboardView'))
const WorkspacesView = lazy(() => import('./WorkspacesView'))
const ProfilesView = lazy(() => import('./ProfilesView'))
const CustomizeView = lazy(() => import('./CustomizeView'))
const WorkflowsView = lazy(() => import('./WorkflowsView'))

/**
 * What each panel of the browser sidebar shows.
 *
 * Every one of these is the real Orbis feature. Where a screen for it already exists it is that screen, rendered
 * beside the page instead of over it; where one does not, it reads the same store or drives the same Browser Control
 * Layer that Orion does, so there is one implementation of each thing rather than two that drift apart.
 *
 * Nothing here keeps its own copy of anything. A panel is a window onto state that lives elsewhere.
 */

export interface SidebarTab {
  id: string
  url: string
  title: string
  favicon?: string
  loading: boolean
  pinned?: boolean
  private?: boolean
  muted?: boolean
  audible?: boolean
  groupId?: string
  customTitle?: string
}

export interface SidebarContext {
  tabs: SidebarTab[]
  groups: TabGroup[]
  activeTabId: string
  closedTabs: ClosedTab[]
  /** The page in front: its address, and the id its blocking results are kept under. */
  pageUrl: string
  getWebContentsId(): number | null
  /** Opens an address in the tab that is in front. */
  navigate(url: string): void
  /** Opens an address beside it. */
  openTab(url: string): void
  reopenTab(position: number): void
  onNotify(message: string, kind?: NoticeKind): void
  experience: Experience
  onClose(): void
  /** Asks Orion about the page in front; the panel shows the answer as it arrives. */
  askOrion(prompt: string, onDelta: (text: string, done: boolean) => void): () => void
}

/** Anything the sidebar asks the browser to do goes through the control layer, the same way Orion asks. */
async function control(capability: string, params: Record<string, unknown> = {}): Promise<boolean> {
  const result = await window.api.executeControl({ capability, params, target: {}, source: 'user' }).catch(() => null)
  return Boolean(result?.ok)
}

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const when = (time: number): string => {
  const date = new Date(time)
  const days = Math.floor((Date.now() - time) / 86_400_000)
  if (days === 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** A site's own icon, falling back to nothing rather than to an invented one. */
function Favicon({ icon }: { url?: string; icon?: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (icon && !failed) return <img className="bsb-favicon" src={icon} alt="" onError={() => setFailed(true)} />
  return <Circle className="bsb-favicon" size={13} aria-hidden="true" />
}

/** A box that filters whatever the panel is showing. */
function Filter({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }): React.JSX.Element {
  return (
    <div className="bsb-filter">
      <Search size={13} aria-hidden="true" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} spellCheck={false} />
      {value && (
        <button type="button" aria-label="Clear" onClick={() => onChange('')}>
          <X size={12} />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- tabs

function TabsPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = ctx.tabs.filter((t) => !q || `${t.customTitle || t.title} ${t.url}`.toLowerCase().includes(q))

  return (
    <PanelFrame
      id="tabs"
      onClose={onClose}
      actions={
        <button type="button" className="bsb-pane-action" title="New tab" aria-label="New tab" onClick={() => ctx.openTab('')}>
          <Plus size={14} />
        </button>
      }
    >
      <Filter value={query} onChange={setQuery} placeholder={`Search ${ctx.tabs.length} tabs`} />
      <ul className="bsb-items">
        {shown.map((tab) => {
          const group = ctx.groups.find((g) => g.id === tab.groupId)
          return (
            <li key={tab.id} className={`bsb-item${tab.id === ctx.activeTabId ? ' on' : ''}`}>
              <button type="button" className="bsb-item-main" onClick={() => void control('tabs.activate', { tabId: tab.id })}>
                <Favicon url={tab.url} icon={tab.favicon} />
                <span className="bsb-item-text">
                  <b className="truncate">{tab.customTitle || tab.title || 'New tab'}</b>
                  <small className="truncate">
                    {group && <span className="bsb-chip" style={{ '--group-color': group.color } as React.CSSProperties}>{group.name}</span>}
                    {tab.url ? host(tab.url) : 'Empty tab'}
                  </small>
                </span>
              </button>
              {(tab.audible || tab.muted) && (
                <button
                  type="button"
                  className="bsb-item-action"
                  aria-label={tab.muted ? 'Unmute' : 'Mute'}
                  title={tab.muted ? 'Unmute' : 'Mute'}
                  onClick={() => void control('tabs.mute', { tabId: tab.id, muted: !tab.muted })}
                >
                  {tab.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                </button>
              )}
              <button type="button" className="bsb-item-action" aria-label={`Close ${tab.title}`} title="Close" onClick={() => void control('tabs.close', { tabId: tab.id })}>
                <X size={13} />
              </button>
            </li>
          )
        })}
        {!shown.length && <p className="bsb-none">{q ? 'No tab matches that.' : 'No tabs open.'}</p>}
      </ul>

      {ctx.closedTabs.length > 0 && (
        <section className="bsb-sub">
          <h4>Recently closed</h4>
          {ctx.closedTabs
            .slice(-8)
            .reverse()
            .map((closed) => (
              <button key={`${closed.index}-${closed.url}`} type="button" className="bsb-item-main plain" onClick={() => ctx.reopenTab(closed.index)}>
                <RotateCcw size={13} aria-hidden="true" />
                <span className="bsb-item-text">
                  <b className="truncate">{closed.title || host(closed.url)}</b>
                  <small className="truncate">{host(closed.url)}</small>
                </span>
              </button>
            ))}
        </section>
      )}
    </PanelFrame>
  )
}

function TabGroupsPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null)
  return (
    <PanelFrame id="tabGroups" onClose={onClose}>
      {!ctx.groups.length && <p className="bsb-none">No tab groups. Select tabs in the tab strip and group them there.</p>}
      {ctx.groups.map((group) => {
        const mine = ctx.tabs.filter((t) => t.groupId === group.id)
        return (
          <section key={group.id} className="bsb-sub">
            <h4 style={{ '--group-color': group.color } as React.CSSProperties} className="bsb-group-title">
              {renaming === group.id ? (
                <input
                  className="hud-input compact"
                  defaultValue={group.name}
                  aria-label="Group name"
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    void control('groups.rename', { groupId: group.id, name: e.currentTarget.value })
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <>
                  <button type="button" className="bsb-group-title-name" onDoubleClick={() => setRenaming(group.id)} onClick={() => void control('groups.collapse', { groupId: group.id, collapsed: !group.collapsed })}>
                    {group.name}
                  </button>
                  <span className="bsb-group-count">{mine.length}</span>
                  <button type="button" className="bsb-item-action" aria-label={`Close ${group.name}`} title="Close the group and its tabs" onClick={() => void control('groups.close', { groupId: group.id })}>
                    <X size={13} />
                  </button>
                </>
              )}
            </h4>
            {mine.map((tab) => (
              <button key={tab.id} type="button" className="bsb-item-main plain" onClick={() => void control('tabs.activate', { tabId: tab.id })}>
                <Favicon url={tab.url} icon={tab.favicon} />
                <span className="bsb-item-text">
                  <b className="truncate">{tab.customTitle || tab.title}</b>
                  <small className="truncate">{host(tab.url)}</small>
                </span>
              </button>
            ))}
          </section>
        )
      })}
    </PanelFrame>
  )
}

// ---------------------------------------------------------------- the library's own lists

/** The library snapshot, read once per panel that needs it and kept up to date by the main process. */
function useLibrary(): BrowserLibrarySnapshot | null {
  const [library, setLibrary] = useState<BrowserLibrarySnapshot | null>(null)
  useEffect(() => {
    void window.api.getBrowserLibrary().then(setLibrary)
    return window.api.onBrowserLibrary(setLibrary)
  }, [])
  return library
}

function ReadingListPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const library = useLibrary()
  const items = library?.readingList ?? []
  const unread = items.filter((r) => !r.readAt)
  const read = items.filter((r) => r.readAt)

  const row = (item: (typeof items)[number]): React.JSX.Element => (
    <li key={item.url} className="bsb-item">
      <button
        type="button"
        className="bsb-item-main"
        onClick={() => {
          ctx.openTab(item.url)
          void window.api.setReadingListRead(item.url, true)
        }}
      >
        <BookOpen size={13} aria-hidden="true" />
        <span className="bsb-item-text">
          <b className="truncate">{item.title || host(item.url)}</b>
          <small className="truncate">
            {host(item.url)} · {when(item.addedAt)}
          </small>
        </span>
      </button>
      <button
        type="button"
        className="bsb-item-action"
        aria-label={item.readAt ? 'Mark unread' : 'Mark read'}
        title={item.readAt ? 'Mark unread' : 'Mark read'}
        onClick={() => void window.api.setReadingListRead(item.url, !item.readAt)}
      >
        <Check size={13} />
      </button>
      <button type="button" className="bsb-item-action" aria-label="Remove" title="Remove" onClick={() => void window.api.removeFromReadingList(item.url)}>
        <X size={13} />
      </button>
    </li>
  )

  return (
    <PanelFrame
      id="readingList"
      onClose={onClose}
      actions={
        ctx.pageUrl ? (
          <button
            type="button"
            className="bsb-pane-action"
            title="Add this page"
            aria-label="Add this page to the reading list"
            onClick={async () => {
              const added = await window.api.addToReadingList(ctx.pageUrl, document.title)
              ctx.onNotify(added ? 'Added to your reading list.' : 'That page cannot be set aside.', added ? 'info' : 'warn')
            }}
          >
            <Plus size={14} />
          </button>
        ) : undefined
      }
    >
      {!items.length && <p className="bsb-none">Nothing set aside yet. Add the page you are on with the plus above.</p>}
      {unread.length > 0 && <ul className="bsb-items">{unread.map(row)}</ul>}
      {read.length > 0 && (
        <section className="bsb-sub">
          <h4>
            Read
            <button type="button" className="bsb-text-btn" onClick={() => void window.api.clearReadReadingList()}>
              Clear
            </button>
          </h4>
          <ul className="bsb-items">{read.map(row)}</ul>
        </section>
      )}
    </PanelFrame>
  )
}

function SavedPagesPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const library = useLibrary()
  const pages = library?.savedPages ?? []
  return (
    <PanelFrame id="savedPages" onClose={onClose}>
      {!pages.length && <p className="bsb-none">No pages saved yet. Save one from the browser menu and it is listed here.</p>}
      <ul className="bsb-items">
        {pages.map((page) => (
          <li key={page.path} className="bsb-item">
            <button type="button" className="bsb-item-main" title={page.path} onClick={() => ctx.openTab(`file:///${page.path.replace(/\\/g, '/')}`)}>
              <FolderOpen size={13} aria-hidden="true" />
              <span className="bsb-item-text">
                <b className="truncate">{page.title || host(page.url)}</b>
                <small className="truncate">
                  {host(page.url)} · {when(page.savedAt)}
                </small>
              </span>
            </button>
            <button type="button" className="bsb-item-action" aria-label="Open the page it was saved from" title="Open the original page" onClick={() => ctx.openTab(page.url)}>
              <ExternalLink size={13} />
            </button>
            <button type="button" className="bsb-item-action" aria-label="Forget" title="Forget it here; the file stays where it is" onClick={() => void window.api.forgetSavedPage(page.path)}>
              <X size={13} />
            </button>
          </li>
        ))}
      </ul>
    </PanelFrame>
  )
}

function ScreenshotsPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const library = useLibrary()
  const shots = library?.screenshots ?? []
  const [open, setOpen] = useState<{ shot: PageShot; src: string } | null>(null)

  const show = async (shot: PageShot): Promise<void> => {
    const src = await window.api.readScreenshot(shot.id)
    if (src) setOpen({ shot, src })
    else ctx.onNotify('That picture is no longer on disk.', 'warn')
  }

  return (
    <PanelFrame id="screenshots" onClose={onClose}>
      {!shots.length && <p className="bsb-none">No pictures kept yet. Take one from the browser menu and it is kept here.</p>}
      <div className="bsb-shots">
        {shots.map((shot) => (
          <figure key={shot.id} className="bsb-shot">
            <button type="button" onClick={() => void show(shot)} title={shot.title || shot.url}>
              <ShotThumb id={shot.id} />
            </button>
            <figcaption>
              <span className="truncate">{shot.title || host(shot.url)}</span>
              <small>
                {when(shot.at)}
                {shot.width ? ` · ${shot.width}×${shot.height}` : ''}
              </small>
              <span className="bsb-shot-actions">
                <button type="button" aria-label="Open the page" title="Open the page" onClick={() => ctx.openTab(shot.url)}>
                  <ExternalLink size={12} />
                </button>
                <button type="button" aria-label="Delete" title="Delete the picture" onClick={() => void window.api.removeScreenshot(shot.id)}>
                  <Trash2 size={12} />
                </button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      {open && (
        <div className="bsb-shot-view" role="dialog" aria-label={open.shot.title || 'Screenshot'} onClick={() => setOpen(null)}>
          <img src={open.src} alt={open.shot.title || 'A picture of a page'} />
        </div>
      )}
    </PanelFrame>
  )
}

/** A kept picture is read from disk only when it is on screen, so a long list costs nothing until it is looked at. */
function ShotThumb({ id }: { id: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        watcher.disconnect()
        void window.api.readScreenshot(id).then(setSrc)
      }
    })
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [id])
  return <span ref={ref} className="bsb-shot-thumb">{src ? <img src={src} alt="" loading="lazy" /> : null}</span>
}

// ---------------------------------------------------------------- research, from the chats it happened in

function useResearch(): { research: Research; at: number; chatId: string; chatTitle: string }[] {
  const [rounds, setRounds] = useState<{ research: Research; at: number; chatId: string; chatTitle: string }[]>([])
  useEffect(() => {
    let alive = true
    void window.api.listConversations().then((chats: Conversation[]) => {
      if (!alive) return
      const found = chats.flatMap((chat) =>
        chat.messages.filter((m) => m.research?.sources?.length).map((m) => ({ research: m.research!, at: m.createdAt || chat.updatedAt, chatId: chat.id, chatTitle: chat.title }))
      )
      setRounds(found.sort((a, b) => b.at - a.at).slice(0, 100))
    })
    return () => {
      alive = false
    }
  }, [])
  return rounds
}

function ResearchPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const rounds = useResearch()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = rounds.filter((r) => !q || r.research.question.toLowerCase().includes(q))
  return (
    <PanelFrame id="research" onClose={onClose}>
      <Filter value={query} onChange={setQuery} placeholder="Search research" />
      {!rounds.length && <p className="bsb-none">Orion has not researched anything yet. When it reads the web to answer, what it read is listed here.</p>}
      <ul className="bsb-items">
        {shown.map((round) => (
          <li key={round.research.id} className="bsb-item column">
            <b className="bsb-research-q">{round.research.question}</b>
            <small className="bsb-research-meta">
              {round.research.sources.length} source{round.research.sources.length === 1 ? '' : 's'} · {when(round.at)}
            </small>
            <div className="bsb-research-sources">
              {round.research.sources.slice(0, 5).map((source) => (
                <button key={source.url} type="button" className="bsb-source" title={source.title} onClick={() => ctx.openTab(source.url)}>
                  <Favicon url={source.url} />
                  <span className="truncate">{source.domain}</span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </PanelFrame>
  )
}

function SourcesPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const rounds = useResearch()
  const sources = useMemo(() => {
    const seen = new Set<string>()
    return rounds
      .flatMap((r) => r.research.sources.map((s) => ({ ...s, question: r.research.question, at: r.at })))
      .filter((s) => (seen.has(s.url) ? false : seen.add(s.url)))
      .slice(0, 300)
  }, [rounds])
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = sources.filter((s) => !q || `${s.title} ${s.domain}`.toLowerCase().includes(q))

  return (
    <PanelFrame id="sources" onClose={onClose}>
      <Filter value={query} onChange={setQuery} placeholder={`Search ${sources.length} sources`} />
      {!sources.length && <p className="bsb-none">No sources yet. These are the pages Orion actually read.</p>}
      <ul className="bsb-items">
        {shown.map((source) => (
          <li key={source.url} className="bsb-item">
            <button type="button" className="bsb-item-main" title={source.snippet} onClick={() => ctx.openTab(source.url)}>
              <Favicon url={source.url} />
              <span className="bsb-item-text">
                <b className="truncate">{source.title || source.domain}</b>
                <small className="truncate">
                  {source.publisher || source.domain}
                  {source.published ? ` · ${source.published}` : ''}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </PanelFrame>
  )
}

// ---------------------------------------------------------------- extensions, media, privacy, controls

function ExtensionsPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([])
  useEffect(() => {
    void window.api.getExtensions().then(setExtensions)
    return window.api.onExtensionsChanged(setExtensions)
  }, [])

  return (
    <PanelFrame
      id="extensions"
      onClose={onClose}
      actions={
        <button
          type="button"
          className="bsb-pane-action"
          title="Check the Web Store for updates"
          aria-label="Check for extension updates"
          onClick={async () => {
            const { updated } = await window.api.updateExtensions()
            ctx.onNotify(updated ? `Updated ${updated} extension${updated === 1 ? '' : 's'}.` : 'Every extension is already up to date.')
          }}
        >
          <RotateCcw size={14} />
        </button>
      }
    >
      {!extensions.length && <p className="bsb-none">No extensions installed. Install one from the Chrome Web Store and it appears here.</p>}
      <ul className="bsb-items">
        {extensions.map((extension) => (
          <li key={extension.id} className="bsb-item">
            <span className="bsb-item-main plain">
              <span className="bsb-item-text">
                <b className="truncate">{extension.name}</b>
                <small className="truncate">
                  {extension.version} · {extension.enabled ? 'On' : 'Off'}
                </small>
              </span>
            </span>
            <button
              type="button"
              className="bsb-item-action"
              role="switch"
              aria-checked={extension.enabled}
              aria-label={`${extension.enabled ? 'Turn off' : 'Turn on'} ${extension.name}`}
              title={extension.enabled ? 'Turn off' : 'Turn on'}
              onClick={() => void window.api.setExtensionEnabled(extension.id, !extension.enabled)}
            >
              {extension.enabled ? <Check size={13} /> : <Circle size={13} />}
            </button>
            <button type="button" className="bsb-item-action" aria-label={`Remove ${extension.name}`} title="Remove" onClick={() => void window.api.removeExtension(extension.id)}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </PanelFrame>
  )
}

function MediaPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const playing = ctx.tabs.filter((t) => t.audible || t.muted)
  return (
    <PanelFrame id="media" onClose={onClose}>
      {!playing.length && <p className="bsb-none">Nothing is playing. Tabs making sound are listed here, with their controls.</p>}
      <ul className="bsb-items">
        {playing.map((tab) => (
          <li key={tab.id} className="bsb-item">
            <button type="button" className="bsb-item-main" onClick={() => void control('tabs.activate', { tabId: tab.id })}>
              <Favicon url={tab.url} icon={tab.favicon} />
              <span className="bsb-item-text">
                <b className="truncate">{tab.customTitle || tab.title}</b>
                <small className="truncate">
                  {host(tab.url)} · {tab.muted ? 'Muted' : 'Playing'}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="bsb-item-action"
              aria-label={tab.muted ? `Unmute ${tab.title}` : `Mute ${tab.title}`}
              title={tab.muted ? 'Unmute' : 'Mute'}
              onClick={() => void control('tabs.mute', { tabId: tab.id, muted: !tab.muted })}
            >
              {tab.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <button type="button" className="bsb-item-action" aria-label={`Always mute ${host(tab.url)}`} title={`Always mute ${host(tab.url)}`} onClick={() => void control('tabs.muteSite', { tabId: tab.id, muted: true })}>
              <VolumeX size={13} />
            </button>
          </li>
        ))}
      </ul>
    </PanelFrame>
  )
}

function PrivacyPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const library = useLibrary()
  const site = ctx.pageUrl ? host(ctx.pageUrl) : ''
  const secure = /^https:/i.test(ctx.pageUrl)
  const remembered = Object.entries(library?.permissions ?? {}) as [string, SitePermissionDecision][]
  const here = remembered.filter(([key]) => site && key.startsWith(`https://${site}`))

  return (
    <PanelFrame id="privacy" onClose={onClose}>
      {ctx.pageUrl ? (
        <section className="bsb-sub">
          <h4>This page</h4>
          <p className={`bsb-secure${secure ? ' ok' : ' no'}`}>
            {secure ? 'The connection to this site is encrypted (HTTPS).' : 'This site is not using HTTPS. What is sent to it can be read on the way.'}
          </p>
          <p className="bsb-none plain">{site}</p>
          {here.length > 0 && (
            <ul className="bsb-items">
              {here.map(([key, decision]) => (
                <li key={key} className="bsb-item">
                  <span className="bsb-item-main plain">
                    <span className="bsb-item-text">
                      <b className="truncate">{key.split(' ').slice(1).join(' ')}</b>
                      <small>{decision === 'allow' ? 'Allowed' : 'Blocked'}</small>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <p className="bsb-none">Open a page to see what it is allowed to do.</p>
      )}

      <section className="bsb-sub">
        <h4>
          Remembered decisions
          {remembered.length > 0 && (
            <button type="button" className="bsb-text-btn" onClick={() => void window.api.forgetSitePermissions().then(() => ctx.onNotify('Every remembered permission was forgotten.'))}>
              Forget all
            </button>
          )}
        </h4>
        {!remembered.length && <p className="bsb-none plain">Nothing remembered. Orbis asks each time.</p>}
        <ul className="bsb-items">
          {remembered.slice(0, 100).map(([key, decision]) => (
            <li key={key} className="bsb-item">
              <span className="bsb-item-main plain">
                <span className="bsb-item-text">
                  <b className="truncate">{key.split(' ')[0].replace(/^https?:\/\//, '')}</b>
                  <small className="truncate">
                    {key.split(' ').slice(1).join(' ')} · {decision === 'allow' ? 'Allowed' : 'Blocked'}
                  </small>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </PanelFrame>
  )
}

function ControlsPanel({ onClose }: { onClose(): void }): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<CapabilityDescriptor[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    void window.api.getControlCapabilities().then(setCapabilities)
  }, [])
  const q = query.trim().toLowerCase()
  const shown = capabilities.filter((c) => !q || `${c.name} ${c.id} ${c.description}`.toLowerCase().includes(q))
  const domains = [...new Set(shown.map((c) => c.domain))]

  return (
    <PanelFrame id="controls" onClose={onClose}>
      <Filter value={query} onChange={setQuery} placeholder={`Search ${capabilities.length} things Orbis can do`} />
      <p className="bsb-none plain">Everything here is what Orion and workflows drive. Asking Orion to do one of these does exactly this.</p>
      {domains.map((domain) => (
        <section key={domain} className="bsb-sub">
          <h4>{domain}</h4>
          {shown
            .filter((c) => c.domain === domain)
            .map((capability) => (
              <div key={capability.id} className="bsb-capability">
                <b>{capability.name}</b>
                <small>{capability.description}</small>
                <code>{capability.id}</code>
              </div>
            ))}
        </section>
      ))}
    </PanelFrame>
  )
}

function OrionPanel({ ctx, onClose }: { ctx: SidebarContext; onClose(): void }): React.JSX.Element {
  const [answer, setAnswer] = useState<{ text: string; done: boolean } | null>(null)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])

  const ask = useCallback(
    (prompt: string) => {
      stop.current?.()
      setAnswer({ text: '', done: false })
      stop.current = ctx.askOrion(prompt, (text, done) => setAnswer({ text, done }))
    },
    [ctx]
  )

  const has = Boolean(ctx.pageUrl)
  return (
    <PanelFrame id="orion" onClose={onClose}>
      {!has && <p className="bsb-none">Open a page and Orion can read it, sum it up, or look into it further.</p>}
      {has && (
        <div className="bsb-orion-actions">
          <button type="button" className="bsb-text-btn strong" onClick={() => ask('Sum up the page I am on in three or four sentences, in plain words.')}>
            Summarise this page
          </button>
          <button type="button" className="bsb-text-btn strong" onClick={() => ask('Explain what I have selected on this page. If nothing is selected, say so.')}>
            Explain the selection
          </button>
          <button type="button" className="bsb-text-btn strong" onClick={() => ask('Research the subject of the page I am on, and tell me what else is worth knowing. Cite the pages you read.')}>
            Research this
          </button>
        </div>
      )}
      {answer && (
        <div className="bsb-orion-answer">
          <p>
            {answer.text}
            {!answer.done && <span className="osearch-caret" aria-hidden="true" />}
          </p>
          {answer.done && answer.text && (
            <button type="button" className="bsb-text-btn" onClick={() => void navigator.clipboard.writeText(answer.text).then(() => ctx.onNotify('Copied.'))}>
              Copy
            </button>
          )}
        </div>
      )}
    </PanelFrame>
  )
}

// ---------------------------------------------------------------- what each panel is

/**
 * One panel's content.
 *
 * The screens that already exist are used as they are; they are written to fill whatever holds them, so they fill a
 * sidebar panel as readily as they filled the stage. Nothing is reimplemented to live here.
 */
export function SidebarPanel({ id, ctx }: { id: PanelId; ctx: SidebarContext }): React.JSX.Element {
  const onClose = ctx.onClose
  const view = (node: React.ReactNode): React.JSX.Element => <Suspense fallback={<p className="bsb-none">Opening…</p>}>{node}</Suspense>

  switch (id) {
    case 'tabs':
      return <TabsPanel ctx={ctx} onClose={onClose} />
    case 'tabGroups':
      return <TabGroupsPanel ctx={ctx} onClose={onClose} />
    case 'bookmarks':
    case 'history':
    case 'downloads':
      // The library's own screen, which already searches, opens and removes real entries; the sidebar gives it a
      // heading and a way out, the same as every other panel.
      return (
        <PanelFrame id={id} onClose={onClose}>
          <BrowserLibraryPanel
            tab={id as LibraryTab}
            onTab={() => undefined}
            onClose={onClose}
            onOpen={(url) => ctx.openTab(url)}
            closedTabs={ctx.closedTabs}
            onReopen={(position) => ctx.reopenTab(position)}
            inSidebar
          />
        </PanelFrame>
      )
    case 'readingList':
      return <ReadingListPanel ctx={ctx} onClose={onClose} />
    case 'savedPages':
      return <SavedPagesPanel ctx={ctx} onClose={onClose} />
    case 'screenshots':
      return <ScreenshotsPanel ctx={ctx} onClose={onClose} />
    case 'workspaces':
      return view(<WorkspacesView onClose={onClose} onNotify={ctx.onNotify} />)
    case 'profiles':
      return view(<ProfilesView onClose={onClose} onNotify={ctx.onNotify} />)
    case 'extensions':
      return <ExtensionsPanel ctx={ctx} onClose={onClose} />
    case 'research':
      return <ResearchPanel ctx={ctx} onClose={onClose} />
    case 'sources':
      return <SourcesPanel ctx={ctx} onClose={onClose} />
    case 'notes':
      return view(<NotesView onClose={onClose} onNotify={ctx.onNotify} />)
    case 'tasks':
      return view(<TasksView onClose={onClose} onNotify={ctx.onNotify} />)
    case 'reminders':
      return view(<TasksView onClose={onClose} onNotify={ctx.onNotify} only="reminders" />)
    case 'clipboard':
      return view(<ClipboardView onClose={onClose} onNotify={ctx.onNotify} />)
    case 'whiteboard':
      return view(<WhiteboardView onClose={onClose} onNotify={ctx.onNotify} />)
    case 'media':
      return <MediaPanel ctx={ctx} onClose={onClose} />
    case 'privacy':
      return <PrivacyPanel ctx={ctx} onClose={onClose} />
    case 'adblock':
    case 'tracking':
      return (
        <PanelFrame id={id} onClose={onClose}>
          <AdBlockSection getWebContentsId={ctx.getWebContentsId} pageUrl={ctx.pageUrl} />
        </PanelFrame>
      )
    case 'controls':
      return <ControlsPanel onClose={onClose} />
    case 'workflows':
      return view(<WorkflowsView onClose={onClose} onNotify={ctx.onNotify} />)
    case 'orion':
      return <OrionPanel ctx={ctx} onClose={onClose} />
    case 'customize':
      return view(<CustomizeView experience={ctx.experience} onClose={onClose} onNotify={ctx.onNotify} />)
  }
}
