/**
 * Application shell: navigation, routing and tool dispatch.
 *
 * Every navigation destination leads to an implemented screen. The tool
 * dispatch below validates the stored configuration shape before handing it to
 * a tool, falling back to that tool's default configuration if a saved or
 * imported file carries something unusable — with a message rather than a
 * blank screen.
 */
import { Component, Suspense, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { AppProvider, useApp } from './store';
import { TOOLS, TOOL_CATEGORIES, getTool, type Route } from './tools';
import { BrandMark, Icon, type IconName } from '../ui/icons';
import { Button, Card, Notice, ToastProvider } from '../ui/primitives';
import { HomeScreen } from './screens/HomeScreen';
import { ExamplesScreen, SavedScreen, SettingsScreen, TemplatesScreen } from './screens/LibraryScreens';
import { TOOL_SCREENS, loadDefaultConfig } from './tools/lazy';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import type { ToolId } from '../persistence/schema';
import { reconcileConfig } from '../persistence/reconcile';


/** Shown on the header's search control, so the shortcut is discoverable. */
const SHORTCUT_LABEL =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '\u2318K' : 'Ctrl K';

export function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <ErrorBoundary>
          <Shell />
        </ErrorBoundary>
      </AppProvider>
    </ToastProvider>
  );
}

function Shell() {
  const app = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 1020));
  const palette = useCommandPalette();

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth > 1020);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Open an investigation named in the URL, so a link to one works.
  const { route, ready, openInvestigation } = app;
  const currentId = app.current?.id;
  useEffect(() => {
    if (route.kind === 'tool' && route.investigationId && currentId !== route.investigationId && ready) {
      void openInvestigation(route.investigationId);
    }
  }, [route, currentId, ready, openInvestigation]);

  // Close the mobile navigation after a route change.
  useEffect(() => {
    setNavOpen(false);
  }, [app.route]);

  if (!app.ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 'var(--s4)' }}>
        <BrandMark size={40} />
        <p className="oc-muted" style={{ fontSize: 13 }}>Opening local storage…</p>
      </div>
    );
  }

  const showSidebar = wide || navOpen;

  return (
    <div className="oc-app" data-nav-collapsed={!showSidebar} data-nav-overlay={showSidebar && !wide}>
      <a className="skip-link" href="#oc-main-content">
        Skip to main content
      </a>

      {showSidebar && (
        <Sidebar
          route={app.route}
          onNavigate={app.navigate}
          counts={{ saved: app.investigations.length, templates: app.templates.length }}
          overlay={!wide}
          onClose={() => setNavOpen(false)}
        />
      )}

      <div className="oc-main">
        <header className="oc-header">
          {!wide && <Button icon="menu" variant="ghost" title="Open navigation" onClick={() => setNavOpen(true)} />}
          <span className="oc-header__title">{titleFor(app.route)}</span>
          <div className="oc-header__spacer" />
          <div className="oc-header__actions">
            <button type="button" className="oc-header__search" onClick={() => palette.setOpen(true)} aria-label="Search tools, methods, investigations and examples">
              <Icon name="search" size={14} aria-hidden="true" />
              <span>Search…</span>
              <kbd>{SHORTCUT_LABEL}</kbd>
            </button>
            <Button
              icon={app.preferences.theme === 'light' ? 'moon' : 'sun'}
              variant="ghost"
              title={app.preferences.theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'}
              onClick={() => app.setPreferences({ theme: app.preferences.theme === 'light' ? 'dark' : 'light' })}
            />
          </div>
        </header>

        <main className="oc-content" id="oc-main-content" tabIndex={-1}>
          <ErrorBoundary key={routeKey(app.route)}>
            <Screen />
          </ErrorBoundary>
        </main>
      </div>

      {palette.open && <CommandPalette onClose={() => palette.setOpen(false)} />}
    </div>
  );
}

function routeKey(route: Route): string {
  return route.kind === 'tool' ? `tool:${route.toolId}:${route.investigationId ?? ''}` : route.kind;
}

function titleFor(route: Route): string {
  switch (route.kind) {
    case 'home':
      return 'Orbis Chance';
    case 'tool':
      return getTool(route.toolId).name;
    case 'saved':
      return 'Saved investigations';
    case 'templates':
      return 'Templates';
    case 'examples':
      return 'Worked examples';
    case 'settings':
      return 'Settings';
  }
}

function Sidebar({
  route,
  onNavigate,
  counts,
  overlay,
  onClose,
}: {
  route: Route;
  onNavigate(r: Route): void;
  counts: { saved: number; templates: number };
  overlay: boolean;
  onClose(): void;
}) {
  const current = route.kind === 'tool' ? route.toolId : null;
  return (
    <nav
      className="oc-sidebar"
      aria-label="Main navigation"
      style={overlay ? { position: 'fixed', inset: '0 auto 0 0', width: 'var(--sidebar-width)', zIndex: 40, boxShadow: 'var(--shadow-3)' } : undefined}
    >
      <div className="oc-sidebar__brand">
        <BrandMark />
        <span className="oc-brand-name">
          Orbis <span>Chance</span>
        </span>
        {overlay && (
          <div style={{ marginLeft: 'auto' }}>
            <Button icon="x" variant="ghost" size="sm" title="Close navigation" onClick={onClose} />
          </div>
        )}
      </div>

      <div className="oc-nav">
        <NavItem icon="home" label="Home" active={route.kind === 'home'} onClick={() => onNavigate({ kind: 'home' })} />

        {TOOL_CATEGORIES.map((category) => {
          const tools = TOOLS.filter((t) => t.category === category);
          if (!tools.length) return null;
          return (
            <div key={category}>
              <div className="oc-nav__group-label">{category}</div>
              {tools.map((tool) => (
                <NavItem key={tool.id} icon={tool.icon} label={tool.name} active={current === tool.id} onClick={() => onNavigate({ kind: 'tool', toolId: tool.id })} />
              ))}
            </div>
          );
        })}

        <div className="oc-nav__group-label">Library</div>
        <NavItem icon="saved" label="Saved" count={counts.saved} active={route.kind === 'saved'} onClick={() => onNavigate({ kind: 'saved' })} />
        <NavItem icon="template" label="Templates" count={counts.templates || undefined} active={route.kind === 'templates'} onClick={() => onNavigate({ kind: 'templates' })} />
        <NavItem icon="book" label="Examples" active={route.kind === 'examples'} onClick={() => onNavigate({ kind: 'examples' })} />
      </div>

      <div className="oc-sidebar__footer">
        <NavItem icon="settings" label="Settings" active={route.kind === 'settings'} onClick={() => onNavigate({ kind: 'settings' })} />
      </div>
    </nav>
  );
}

function NavItem({ icon, label, active, onClick, count }: { icon: IconName; label: string; active: boolean; onClick(): void; count?: number }) {
  return (
    <button type="button" className="oc-nav__item" aria-current={active ? 'page' : undefined} onClick={onClick}>
      <span className="oc-nav__icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className="oc-nav__label">{label}</span>
      {count !== undefined && count > 0 && <span className="oc-nav__count">{count}</span>}
    </button>
  );
}

function Screen() {
  const app = useApp();
  const route = app.route;

  switch (route.kind) {
    case 'home':
      return <HomeScreen />;
    case 'saved':
      return <SavedScreen />;
    case 'templates':
      return <TemplatesScreen />;
    case 'examples':
      return <ExamplesScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'tool':
      return <ToolScreen toolId={route.toolId} />;
  }
}

function ToolScreen({ toolId }: { toolId: ToolId }) {
  const app = useApp();
  const tool = getTool(toolId);
  const { current, startInvestigation, resumeTool } = app;
  const openToolId = current?.toolId;
  const openConfig = current?.config;
  const [defaults, setDefaults] = useState<Record<string, unknown> | null>(null);

  // The tool's default configuration now arrives with its screen's chunk
  // rather than from a static map, so it has to be awaited. Everything below
  // waits for it: without the defaults there is nothing to reconcile a stored
  // configuration against, and guessing would silently drop fields.
  useEffect(() => {
    let alive = true;
    setDefaults(null);
    void loadDefaultConfig(toolId).then((value) => {
      if (alive) setDefaults(value as Record<string, unknown>);
    });
    return () => {
      alive = false;
    };
  }, [toolId]);

  // Arriving at a tool: restore the investigation already open for it this
  // session, and only start a new one when there is none. Replacing it would
  // discard unsaved edits and, because the id changes, saving afterwards would
  // insert a duplicate record rather than updating the original.
  useEffect(() => {
    if (!defaults) return;
    if (openToolId === toolId) return;
    if (resumeTool(toolId)) return;
    startInvestigation(toolId, structuredClone(defaults), { name: `Untitled ${tool.name.toLowerCase()}` });
  }, [toolId, openToolId, resumeTool, startInvestigation, tool.name, defaults]);

  const config = useMemo(() => {
    if (!defaults) return null;
    if (openToolId !== toolId) return null;
    return reconcileConfig(defaults, openConfig);
  }, [openToolId, openConfig, toolId, defaults]);

  if (!config) {
    return (
      <div className="oc-page">
        <Card>
          <p className="oc-muted">Preparing {tool.name}…</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="oc-page">
      {config.repaired > 0 && (
        <Notice tone="warning" title="Some settings were reset">
          <p>
            This investigation was missing {config.repaired} setting(s) that {tool.name} needs — most likely because it was created by a different version. The
            missing values have been set to their defaults; everything else was kept. Review the settings before relying on the result.
          </p>
        </Notice>
      )}
      <Suspense
        fallback={
          <Card>
            <p className="oc-muted">Loading {tool.name}…</p>
          </Card>
        }
      >
        <ToolBody toolId={toolId} config={config.value} />
      </Suspense>
    </div>
  );
}

/**
 * Merge a stored configuration over the tool's defaults, so a file written by
 * an older version still opens with every field present. Reports how many
 * fields had to be filled in.
 */
function ToolBody({ toolId, config }: { toolId: ToolId; config: Record<string, unknown> }) {
  // One lookup rather than a 25-arm switch. The per-tool configuration type is
  // recovered inside `lazy.ts`, where each screen is paired with its own type.
  const Screen = TOOL_SCREENS[toolId];
  return <Screen config={config as never} />;
}

/** Catches a rendering error so one broken screen does not blank the application. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged for diagnosis; no user data is included.
    console.error('Orbis Chance encountered a rendering error:', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="oc-page">
          <Card title="Something went wrong on this screen">
            <Notice tone="error" title="The screen could not be displayed">
              <p>{this.state.error.message}</p>
            </Notice>
            <p style={{ fontSize: 12.5 }}>
              Your saved investigations are unaffected. Try returning to the home screen, or reload the page. If this happens with a specific saved
              investigation, export it and check its settings.
            </p>
            <div className="oc-btn-row">
              <Button variant="primary" icon="home" onClick={() => { location.hash = '#/'; this.setState({ error: null }); }}>
                Go to the home screen
              </Button>
              <Button icon="reset" onClick={() => location.reload()}>
                Reload the page
              </Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
