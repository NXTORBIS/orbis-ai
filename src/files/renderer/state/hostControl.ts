import {
  FILES_ASK_STATE_MESSAGE,
  FILES_COMMANDS_MESSAGE,
  FILES_CONTROL_CONTRACT,
  FILES_CONTROL_MESSAGE,
  FILES_CONTROLS,
  FILES_RESULT_MESSAGE,
  FILES_STATE_MESSAGE,
  type FilesCommand,
  type FilesCommandOutcome,
  type FilesViewState,
} from '../../../shared/filesControl';
import { GROUP_KEYS, SORT_KEYS, VIEW_MODES } from '../../shared/customization/schema';
import type { GroupKey, Location, SortSpec, ViewMode } from '../../shared/model';
import { app } from './app';
import { availability, commandById, describeCommands, getContext } from '../commands';
import {
  activePane,
  activeTab,
  currentLocation,
  listingKeyFor,
  listings,
  navigate,
  paneCount,
  parentPath,
  setSelection,
  updatePane,
  ws,
} from './workspace';

/**
 * Saying what is on screen to the Orbis window, and doing what it asks.
 *
 * Orbis Files runs in a frame of its own because its stylesheet restyles the whole document. That frame is a separate
 * program: the window's register of controllable screens cannot see inside it, and the one door between the Orbis
 * application and its window reaches the window's main frame, not a subframe. There is no second channel and there
 * must not be one — so this talks over the `postMessage` route the two already use for "Files is ready" and "open
 * this tool".
 *
 * Three things keep it honest:
 *
 *  - **Nothing here does anything of its own.** Every command runs through the command registry every toolbar button,
 *    context menu, shortcut and palette entry runs through, and the four value setters call the same `navigate`,
 *    `setSelection` and `updatePane` the pane's own controls call. A second way of moving a file would be a second
 *    place for "did it ask first?" to be answered differently.
 *  - **What can be done is read, never listed.** The commands are `describeCommands()`, with Files' own titles,
 *    explanations and sense of how serious each one is. A command added to Files is one the window can do in the same
 *    change.
 *  - **A command still waiting for a person is said to be waiting.** Several commands open a dialog and finish when
 *    somebody answers it. Waiting for that for ever would look exactly like a broken bridge, so after a few seconds
 *    the answer goes back saying Files is asking something on screen.
 *
 * Inert with no host: if this document is not in a frame, nothing is sent and nothing is listened for. Orbis Files is
 * fully usable on its own, which is the rule this file is not allowed to break.
 */

/** How long a command is given before the answer says it is still waiting for somebody. */
const WAITING_MS = 6000;
/** How long a deletion's paths are watched for before the answer says how many are still listed. */
const GONE_MS = 2500;

let started = false;
let host: Window | null = null;

const post = (message: unknown): void => {
  // '*' because the frame and its host are the same application served from the same place; there is no third party
  // to leak to, and the host checks that every message it reads came from this frame.
  try {
    host?.postMessage(message, '*');
  } catch {
    // A host that has gone is not an error here. The next snapshot will fail the same harmless way.
  }
};

/** What is on screen now, as the window will read it. Nothing is computed; everything is read. */
function snapshot(): FilesViewState {
  const state = ws.get();
  const tab = activeTab(state);
  const pane = activePane(state);
  const location = currentLocation(pane);
  const listing = listings.get()[listingKeyFor(tab.id, pane)];
  // Going on, in the states Files itself treats as not finished.
  const busy = new Set(['queued', 'preparing', 'running', 'paused', 'awaiting_conflict', 'cancelling']);
  const ops = Object.values(app.get().ops ?? {}).filter((one) => busy.has(one.state));

  /** The part of a place that is not its kind, in the place's own words. */
  const detail = (): string => {
    if (location.kind === 'fs' || location.kind === 'editor') return location.path;
    if (location.kind === 'search') return location.query;
    if (location.kind === 'tool') return location.tool;
    if (location.kind === 'collection' || location.kind === 'savedSearch' || location.kind === 'project') return location.id;
    if (location.kind === 'library') return location.category;
    if (location.kind === 'archive') return location.archivePath;
    if (location.kind === 'remote') return `${location.connectionId}:${location.path}`;
    return '';
  };

  return {
    contract: FILES_CONTROL_CONTRACT,
    at: Date.now(),
    folder: location.kind === 'fs' ? location.path : null,
    place: location.kind,
    placeDetail: detail(),
    parent: location.kind === 'fs' ? parentPath(location.path) ?? null : null,
    view: pane.view,
    sortBy: pane.sort.key,
    sortDirection: pane.sort.dir,
    foldersFirst: pane.sort.foldersFirst,
    groupBy: pane.groupBy,
    filter: pane.filter,
    selection: [...pane.selection],
    /*
     * Null, not 0, while there is no listing.
     *
     * A pane whose folder is still being read has not got an empty folder in it. The window reports this as a value
     * it could not read, which is the truth, and 0 would read as a measurement nobody took.
     */
    entries: listing && listing.status === 'ready' ? listing.entries.length : null,
    listing: listing ? listing.status : 'none',
    ...(listing?.error ? { listingProblem: listing.error.message } : {}),
    tabs: state.tabs.length,
    panes: paneCount(tab),
    canGoBack: pane.index > 0,
    canGoForward: pane.index < pane.history.length - 1,
    operations: ops.length,
    // Null until this computer has been asked what it can do. "No Trash" and "not asked yet" are different answers.
    canTrash: app.get().capabilities ? app.get().capabilities!.trash === true : null,
    // Files' own lists, so there is no copy in the window to drift from them.
    offers: { views: [...VIEW_MODES], sortKeys: [...SORT_KEYS], groupKeys: [...GROUP_KEYS] },
  };
}

/** What Files can be asked to do, as Files describes it. A title that trails off is one that asks for something. */
function commands(): FilesCommand[] {
  return describeCommands().map((one) => ({
    id: one.id,
    title: one.title,
    description: one.description,
    permission: one.permission,
    // Files' own mark for a command that opens a dialog: its title trails off, as a menu item's does.
    asksFirst: /[.…]$/.test(one.title) && !/\.$/.test(one.title),
  }));
}

/** Runs one Files command through the registry, and says what happened rather than that it was started. */
async function runCommand(id: string): Promise<FilesCommandOutcome> {
  const found = commandById(id);
  if (!found) throw new Error(`Files has no command called “${id}”.`);
  const context = getContext();
  const can = availability(found, context);
  // Files' own sentence for why not, which is the one its own menu would have greyed the item out with.
  if (!can.enabled) throw new Error(can.reason ?? `${found.title} cannot be done right now.`);

  const acted = context.selection.map((one) => one.path);
  const permission = commands().find((one) => one.id === id)?.permission ?? 'modify';

  let waiting: string | undefined;
  await Promise.race([
    Promise.resolve(found.run(context)).then(() => undefined),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        waiting = `${found.title} is waiting for an answer on screen in Files.`;
        resolve();
      }, WAITING_MS)
    ),
  ]);

  const outcome: FilesCommandOutcome = {
    id,
    title: found.title,
    permission,
    finished: waiting === undefined,
    ...(waiting ? { waiting } : {}),
    acted: acted.length,
  };
  // A deletion is only done when the things are gone, so they are watched for rather than assumed.
  if (permission === 'destructive' && acted.length > 0 && waiting === undefined) {
    outcome.stillThere = await watchGone(acted);
  }
  return outcome;
}

/** How many of these paths the active pane still lists, after giving the operation a moment to finish. */
async function watchGone(paths: string[]): Promise<number> {
  const until = Date.now() + GONE_MS;
  let left = stillThere(paths);
  while (left > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    left = stillThere(paths);
  }
  return left;
}

function stillThere(paths: string[]): number {
  const tab = activeTab();
  const pane = activePane();
  const listing = listings.get()[listingKeyFor(tab.id, pane)];
  if (!listing || listing.status !== 'ready') return paths.length;
  const have = new Set(listing.entries.map((one) => one.path));
  return paths.filter((one) => have.has(one)).length;
}

/** The value setters: each one calls exactly what the pane's own control calls. */
async function answer(name: string, params: Record<string, unknown>): Promise<unknown> {
  const pane = activePane();
  switch (name) {
    case FILES_CONTROLS.goTo: {
      const path = String(params.path ?? '');
      if (path === '') throw new Error('No folder was given.');
      const location: Location = { kind: 'fs', path };
      // The pane's own navigate: it still asks before leaving an editor with unsaved work, and still refuses a folder
      // it cannot read. False here means it did not go, which is reported rather than smoothed over.
      const went = await navigate(pane.id, location);
      if (!went) throw new Error(`Files did not go to ${path}.`);
      return { folder: path };
    }
    case FILES_CONTROLS.select: {
      const wanted = Array.isArray(params.paths) ? params.paths.filter((one): one is string => typeof one === 'string') : [];
      setSelection(pane.id, wanted);
      return { selected: wanted.length };
    }
    case FILES_CONTROLS.setView: {
      const view = String(params.view ?? '');
      if (!(VIEW_MODES as readonly string[]).includes(view)) throw new Error(`Files has no view called “${view}”.`);
      updatePane(pane.id, { view: view as ViewMode });
      return { view };
    }
    case FILES_CONTROLS.setSort: {
      const key = params.key === undefined ? pane.sort.key : String(params.key);
      if (!(SORT_KEYS as readonly string[]).includes(key)) throw new Error(`Files cannot sort by “${key}”.`);
      const sort: SortSpec = {
        key: key as SortSpec['key'],
        dir: params.direction === undefined ? pane.sort.dir : params.direction === 'asc' ? 'asc' : 'desc',
        foldersFirst: params.foldersFirst === undefined ? pane.sort.foldersFirst : params.foldersFirst === true,
      };
      // The same patch the sort menu makes, including dropping the key from the tie-breakers.
      updatePane(pane.id, { sort, thenBy: pane.thenBy.filter((one) => one.key !== sort.key) });
      return { sortBy: sort.key, direction: sort.dir, foldersFirst: sort.foldersFirst };
    }
    case FILES_CONTROLS.setGroup: {
      const key = String(params.key ?? '');
      if (!(GROUP_KEYS as readonly string[]).includes(key)) throw new Error(`Files cannot group by “${key}”.`);
      updatePane(pane.id, { groupBy: key as GroupKey });
      return { groupBy: key };
    }
    case FILES_CONTROLS.setFilter: {
      const text = String(params.text ?? '');
      updatePane(pane.id, { filter: text });
      return { filter: text };
    }
    case FILES_CONTROLS.runCommand:
      return runCommand(String(params.id ?? ''));
    case FILES_CONTROLS.stillThere: {
      const paths = Array.isArray(params.paths) ? params.paths.filter((one): one is string => typeof one === 'string') : [];
      return { stillThere: stillThere(paths), asked: paths.length };
    }
    default:
      throw new Error(`Files was asked for “${name}”, which it does not know.`);
  }
}

/**
 * Starts saying what is on screen, if there is a host to say it to.
 *
 * Called once from `App`. Everything arriving is somebody else's text until it has been looked at: only messages from
 * the window this frame is in are read, and every field is checked before it is used.
 */
export function startHostControl(): void {
  if (started) return;
  if (typeof window === 'undefined' || window.parent === window) return;
  started = true;
  host = window.parent;

  let last = '';
  const say = (): void => {
    const now = snapshot();
    // Sent only when something really changed, apart from the clock: a store that fires on every scroll would
    // otherwise be posting forty messages a second at a window that only wants to know what is on screen.
    const same = JSON.stringify({ ...now, at: 0 });
    if (same === last) return;
    last = same;
    post({ type: FILES_STATE_MESSAGE, state: now });
  };

  ws.subscribe(say);
  listings.subscribe(say);
  app.subscribe(say);

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== host) return;
    const message = event.data as { type?: unknown; id?: unknown; name?: unknown; params?: unknown } | null;
    if (typeof message !== 'object' || message === null) return;

    if (message.type === FILES_ASK_STATE_MESSAGE) {
      post({ type: FILES_COMMANDS_MESSAGE, commands: commands() });
      last = '';
      say();
      return;
    }
    if (message.type !== FILES_CONTROL_MESSAGE || typeof message.id !== 'string' || typeof message.name !== 'string') return;

    const id = message.id;
    const params = typeof message.params === 'object' && message.params !== null ? (message.params as Record<string, unknown>) : {};
    void answer(message.name, params)
      .then((data) => post({ type: FILES_RESULT_MESSAGE, id, ok: true, data }))
      .catch((err: unknown) => post({ type: FILES_RESULT_MESSAGE, id, ok: false, message: err instanceof Error ? err.message : String(err) }))
      // Whatever the answer was, what is on screen has probably changed, and the window is waiting to read it back.
      .finally(() => {
        last = '';
        say();
      });
  });

  // Said once unasked, so a window that was already listening does not have to ask.
  post({ type: FILES_COMMANDS_MESSAGE, commands: commands() });
  say();
}
