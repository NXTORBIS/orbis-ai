// src/shared/music/fulltab.ts
var SCREENS = [
  "home",
  "search",
  "library",
  "playing",
  "album",
  "artist",
  "genre",
  "playlist",
  "playlists",
  "queue",
  "recent",
  "liked",
  "discover",
  "noticed",
  "bring-in",
  "tidy",
  "settings"
];
var MUSIC_HOME = Object.freeze({ screen: "home", of: "", said: "" });
var isMusicScreen = (name) => typeof name === "string" && SCREENS.includes(name);
function parseRoute(hash) {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path, query = ""] = text.split("?");
  const parts = path.split("/").filter((piece) => piece !== "");
  const name = parts[0] ?? "";
  if (!isMusicScreen(name)) return MUSIC_HOME;
  let of = "";
  if (parts.length > 1) {
    try {
      of = decodeURIComponent(parts.slice(1).join("/"));
    } catch {
      of = "";
    }
  }
  let said = "";
  for (const pair of query.split("&")) {
    if (!pair.startsWith("q=")) continue;
    try {
      said = decodeURIComponent(pair.slice(2).replace(/\+/g, " "));
    } catch {
      said = "";
    }
  }
  return { screen: name, of: of.slice(0, 400), said: said.slice(0, 300) };
}
function routeHash(route2) {
  const of = route2.of ? `/${encodeURIComponent(route2.of)}` : "";
  const said = route2.said ? `?q=${encodeURIComponent(route2.said)}` : "";
  return `#/${route2.screen}${of}${said}`;
}
var sameRoute = (a, b) => a.screen === b.screen && a.of === b.of && a.said === b.said;
var MUSIC_NAV = Object.freeze([
  { screen: "home", label: "Home", icon: "home" },
  { screen: "search", label: "Search", icon: "search" },
  { screen: "library", label: "Your music", icon: "library" },
  // Playing now is a screen of its own, not only the column on the right: it is the one place with room for the big
  // cover, the colours measured out of it, and everything the music service really knows about the track.
  { screen: "playing", label: "Playing now", icon: "note" },
  { screen: "liked", label: "Favourites", icon: "heart", secondary: true },
  { screen: "queue", label: "Up next", icon: "list", secondary: true },
  { screen: "recent", label: "Played lately", icon: "clock", secondary: true },
  { screen: "discover", label: "Discover", icon: "compass", secondary: true },
  { screen: "noticed", label: "Noticed while browsing", icon: "ear", secondary: true },
  { screen: "bring-in", label: "Bring music in", icon: "folder", secondary: true },
  { screen: "tidy", label: "Export and tidy", icon: "file", secondary: true },
  { screen: "settings", label: "Settings", icon: "settings", secondary: true }
]);
function clockText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "\u2014";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole % 3600 / 60);
  const rest = whole % 60;
  const pad = (value2) => String(value2).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}
var positionText = (seconds) => Number.isFinite(seconds) && seconds > 0 ? clockText(seconds) : "0:00";
function spanText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 60) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
var countText = (count, one, many) => `${count} ${count === 1 ? one : many}`;
function hueFor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 36e4;
  return hash % 360;
}
function tileLetter(title) {
  for (const character of title.trim()) {
    if (/[\p{L}\p{N}]/u.test(character)) return character.toUpperCase();
  }
  return "\u266A";
}
function progressAt(playback, answeredAt, now2) {
  const from = Number.isFinite(playback.position) && playback.position > 0 ? playback.position : 0;
  if (!playback.playing) return from;
  const gap = now2 - answeredAt;
  const carried2 = from + Math.min(Math.max(gap, 0), 5e3) / 1e3;
  const end = Number.isFinite(playback.duration) && playback.duration > 0 ? playback.duration : Infinity;
  return Math.min(carried2, end);
}
function seekTarget(fraction, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(fraction)) return null;
  return Math.min(Math.max(fraction, 0), 1) * duration;
}
function fillFraction(position, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(position) || position <= 0) return 0;
  return Math.min(position / duration, 1);
}
function playbackMark(playback) {
  return {
    owner: playback.owner,
    trackId: playback.trackId,
    playing: playback.playing,
    duration: playback.duration,
    volume: playback.volume,
    muted: playback.muted,
    shuffle: playback.shuffle,
    repeat: playback.repeat,
    queue: playback.queue.join(","),
    at: playback.at,
    problem: playback.problem ?? null
  };
}
function sameMark(a, b) {
  if (a === null || b === null) return a === b;
  return a.owner === b.owner && a.trackId === b.trackId && a.playing === b.playing && a.duration === b.duration && a.volume === b.volume && a.muted === b.muted && a.shuffle === b.shuffle && a.repeat === b.repeat && a.queue === b.queue && a.at === b.at && a.problem === b.problem;
}
var ARTWORK_BATCH = 60;
function artworkBatches(wanted, held4, tried3, batches = 1) {
  const seen = /* @__PURE__ */ new Set();
  const needed = [];
  for (const id of wanted) {
    if (typeof id !== "string" || id === "" || id.length > 64) continue;
    if (held4.has(id) || tried3.has(id) || seen.has(id)) continue;
    seen.add(id);
    needed.push(id);
    if (needed.length >= ARTWORK_BATCH * Math.max(batches, 1)) break;
  }
  const out = [];
  for (let i = 0; i < needed.length; i += ARTWORK_BATCH) out.push(needed.slice(i, i + ARTWORK_BATCH));
  return out;
}
var ARTWORK_KEPT = 600;
var okTrackId = (value2) => typeof value2 === "string" && value2.length > 0 && value2.length <= 64 ? value2 : null;
function okTrackIds(value2) {
  if (!Array.isArray(value2)) return [];
  const out = [];
  for (const one of value2) {
    const id = okTrackId(one);
    if (id) out.push(id);
    if (out.length >= 500) break;
  }
  return out;
}
var okName = (value2, max = 200) => {
  if (typeof value2 !== "string") return null;
  const trimmed = value2.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
};
var okSeconds = (value2) => typeof value2 === "number" && Number.isFinite(value2) && value2 >= 0 && value2 <= 86400 ? Math.round(value2 * 1e3) / 1e3 : null;
var okVolume = (value2) => typeof value2 === "number" && Number.isFinite(value2) && value2 >= 0 && value2 <= 1 ? value2 : null;
var okIndex = (value2) => typeof value2 === "number" && Number.isInteger(value2) && value2 >= 0 && value2 <= 5e3 ? value2 : null;
var okRepeat = (value2) => value2 === "off" || value2 === "all" || value2 === "one" ? value2 : null;
var nextRepeat = (mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off";
function emptyWords(reason, what, problem) {
  switch (reason) {
    case "loading":
      return { title: `Reading your ${what}\u2026`, detail: "", retry: false };
    case "unreachable":
      return {
        title: "Orbis Music is not open",
        detail: "Open the Orbis window and your music connects by itself. Nothing here means your music is gone.",
        retry: true
      };
    case "failed":
      return { title: `Orbis could not read your ${what}`, detail: problem?.trim() || "Nothing was changed. Try again in a moment.", retry: true };
    default:
      return { title: `No ${what} yet`, detail: "", retry: false };
  }
}

// extension-src/music/router.ts
var listeners = [];
var showing = parseRoute(location.hash);
var route = () => showing;
function onRoute(listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((one) => one !== listener);
  };
}
function settle() {
  const fresh = parseRoute(location.hash);
  if (sameRoute(fresh, showing)) return;
  showing = fresh;
  for (const listener of listeners) listener(showing);
}
function go(screen, of = "", said = "") {
  const next2 = routeHash({ screen, of, said });
  if (location.hash === next2) return;
  location.hash = next2;
}
function replace(screen, of = "", said = "") {
  const next2 = routeHash({ screen, of, said });
  if (location.hash === next2) return;
  history.replaceState(null, "", next2);
  settle();
}
var back = () => history.back();
var forward = () => history.forward();
function startRouting() {
  if (!location.hash || location.hash === "#") history.replaceState(null, "", routeHash({ screen: "home" }));
  showing = parseRoute(location.hash);
  addEventListener("hashchange", settle);
}

// src/shared/music/playlistOrder.ts
function dropBefore(middles, pointerY) {
  let before = 0;
  while (before < middles.length && pointerY > middles[before]) before += 1;
  return before;
}
function landingMove(landing, count) {
  const { from, before } = landing;
  if (from < 0 || from >= count) return null;
  if (before < 0 || before > count) return null;
  if (before === from || before === from + 1) return null;
  return { from, to: before > from ? before - 1 : before };
}
function stepMove(from, direction, count) {
  if (from < 0 || from >= count) return null;
  const to = from + direction;
  if (to < 0 || to >= count) return null;
  return { from, to };
}
function realMove(order, shown, move) {
  const id = shown[move.from];
  const landedBefore = move.to >= move.from ? shown[move.to + 1] : shown[move.to];
  if (id === void 0) return null;
  const from = order.indexOf(id);
  if (from < 0) return null;
  const without = order.filter((_, at) => at !== from);
  let to = landedBefore === void 0 ? without.length : without.indexOf(landedBefore);
  if (to < 0) return null;
  if (to > without.length) to = without.length;
  if (to === from) return null;
  return { from, to };
}
function playlistSums(tracks) {
  let seconds = 0;
  let unknown = 0;
  let playable = 0;
  for (const track of tracks) {
    if (Number.isFinite(track.duration) && track.duration > 0) seconds += track.duration;
    else unknown += 1;
    if (track.availability === "local" && typeof track.file === "string" && track.file.length > 0) playable += 1;
  }
  return { count: tracks.length, seconds, unknown, playable };
}
function sumsWords(sums, spanText2) {
  const parts = [`${sums.count} ${sums.count === 1 ? "song" : "songs"}`];
  const span = spanText2(sums.seconds);
  if (span) parts.push(sums.unknown > 0 ? `at least ${span}` : span);
  if (sums.count > 0 && sums.playable < sums.count) parts.push(`${sums.playable} playable here`);
  return parts.join(" \xB7 ");
}
function notAlready(found, already) {
  const held4 = new Set(already);
  return found.filter((one) => !held4.has(one.id));
}
function renameTo(said, was) {
  if (typeof said !== "string") return null;
  const name = said.trim().slice(0, 200);
  if (name.length === 0) return null;
  if (name === was.trim()) return null;
  return name;
}

// src/shared/music/queue.ts
function queueParts(queue, at) {
  const slots = queue.map((trackId, index) => ({ trackId, index }));
  if (!Number.isInteger(at) || at < 0 || at >= slots.length) return { gone: [], playing: null, next: slots };
  return { gone: slots.slice(0, at), playing: slots[at] ?? null, next: slots.slice(at + 1) };
}
var canMove = (index, at) => Number.isInteger(index) && index > at && index >= 0;
function queueMoveTo(from, gap, length) {
  if (!Number.isInteger(from) || !Number.isInteger(gap)) return null;
  if (from < 0 || from >= length || gap < 0 || gap > length) return null;
  if (gap === from || gap === from + 1) return null;
  return gap > from ? gap - 1 : gap;
}
function gapNearest(middles, y) {
  let gap = 0;
  for (const middle of middles) {
    if (y < middle) break;
    gap += 1;
  }
  return gap;
}
function queueLength(durations) {
  let seconds = 0;
  let unknown = 0;
  for (const one of durations) {
    if (Number.isFinite(one) && one > 0) seconds += one;
    else unknown += 1;
  }
  return { seconds: Math.round(seconds), unknown };
}

// src/shared/music.ts
var playableOffline = (track) => track.availability === "local" && Boolean(track.file);
function whyNotPlayable(track) {
  switch (track.availability) {
    case "local":
      return track.file ? null : "Orbis has no file for this track.";
    case "reference":
      return "Orbis knows this song but has no audio for it. Import your own copy to play it here.";
    case "missing":
      return "The file for this track is not where it was. Point Orbis at it again to play it.";
    case "unsupported":
      return "This computer cannot play this kind of audio file.";
  }
}
function plainly(text) {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[([][^)\]]*(remaster|remastered|official|video|audio|lyrics|hd|hq|explicit|clean|mono|stereo)[^)\]]*[)\]]/g, " ").replace(/\b(feat|ft|featuring|with)\b\.?[^-]*$/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
var NOTHING_PLAYING = Object.freeze({
  owner: "none",
  trackId: null,
  playing: false,
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: "off",
  queue: Object.freeze([]),
  at: -1
});

// extension-src/music/helper.ts
var helper = null;
var OrbisNotRunning = class extends Error {
  constructor(message = "Orbis is not running. Start it and this page connects by itself.") {
    super(message);
    this.name = "OrbisNotRunning";
  }
};
async function connection(again = false) {
  if (helper && !again) return helper;
  helper = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const stored = (await chrome.storage.session.get("orbis.helper"))["orbis.helper"];
      if (stored && typeof stored.port === "number" && typeof stored.token === "string") {
        helper = { port: stored.port, token: stored.token };
        return helper;
      }
    } catch {
      break;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new OrbisNotRunning();
}
async function call(channel, args = [], options = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { port, token } = await connection(attempt > 0);
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel, args }),
        signal: options.signal
      });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      if (attempt === 0) continue;
      throw new OrbisNotRunning();
    }
    if ((response.status === 401 || response.status === 403) && attempt === 0) continue;
    if (response.status === 401 || response.status === 403) throw new OrbisNotRunning();
    if (!response.body) {
      const body = await response.json().catch(() => null);
      throw body?.error ?? { code: `http-${response.status}`, message: "The helper refused that." };
    }
    const reader = response.body.getReader();
    const decode = new TextDecoder();
    let rest = "";
    let outcome = null;
    const take = (line) => {
      if (line.trim() === "") return;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if ("event" in parsed) return;
      outcome = parsed;
    };
    for (; ; ) {
      const { value: value2, done } = await reader.read();
      if (done) break;
      rest += decode.decode(value2, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) take(line);
    }
    take(rest);
    const answer = outcome;
    if (!answer) throw { code: "no-answer", message: "The helper stopped without answering." };
    if (answer.error) throw answer.error;
    return answer.result;
  }
  throw new OrbisNotRunning();
}
function problemWords(err) {
  if (err instanceof OrbisNotRunning) return err.message;
  if (err && typeof err === "object" && typeof err.message === "string") return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Orbis could not do that.";
}

// extension-src/music/client.ts
var value = (one) => ({ got: true, value: one });
var refused = (why, shut = false) => ({ got: false, why, shut });
var wontSend = (why) => refused(why, false);
async function ask(channel, args = []) {
  try {
    return value(await call(channel, args));
  } catch (err) {
    const why = problemWords(err);
    const shut = err instanceof OrbisNotRunning || /not available/i.test(why);
    return refused(why, shut);
  }
}
var run = (op, a, b, c) => ask("music:do", [op, a, b, c]);
var now = () => ask("music:state");
var heard = () => ask("music:heard");
var lookAgain = (tabId) => ask("music:listen", tabId === void 0 ? [] : [tabId]);
var library = (query = {}) => ask("music:search", [query]);
var albums = () => ask("music:albums");
var artists = () => ask("music:artists");
var genres = () => ask("music:genres");
var playlists = () => ask("music:playlists");
function playlistTracks(id) {
  const one = okTrackId(id);
  return one ? ask("music:playlist-tracks", [one]) : Promise.resolve(wontSend("That playlist could not be opened."));
}
var playedLately = () => ask("music:recent");
var noticed = () => ask("music:recognised");
var settings = () => ask("music:settings");
var find = (said, limit = 60) => {
  const words = okName(said, 300);
  return words ? run("find", words, limit) : Promise.resolve(wontSend("Type something to search for."));
};
function play(trackId) {
  const one = okTrackId(trackId);
  return one ? ask("music:play", [one]) : Promise.resolve(wontSend("That song could not be played."));
}
function playAll(trackIds, startAt = 0) {
  const list = okTrackIds(trackIds);
  if (list.length === 0) return Promise.resolve(wontSend("There is nothing here to play."));
  const from = okIndex(startAt) ?? 0;
  return ask("music:play-all", [list, Math.min(from, list.length - 1)]);
}
function playPlaylist(id) {
  const one = okTrackId(id);
  return one ? ask("music:play-playlist", [one]) : Promise.resolve(wontSend("That playlist could not be played."));
}
var playOrPause = () => ask("music:toggle");
var next = () => ask("music:next");
var previous = () => ask("music:previous");
function seek(seconds) {
  const to = okSeconds(seconds);
  return to === null ? Promise.resolve(wontSend("That is not a place in the track.")) : ask("music:seek", [to]);
}
function setVolume(level) {
  const to = okVolume(level);
  return to === null ? Promise.resolve(wontSend("That is not a volume.")) : ask("music:volume", [to]);
}
var setMuted = (on) => ask("music:mute", [on === true]);
var setShuffle = (on) => ask("music:shuffle", [on === true]);
function setRepeat(mode) {
  const one = okRepeat(mode);
  return one ? ask("music:repeat", [one]) : Promise.resolve(wontSend("That is not a way to repeat."));
}
function queueNext(trackIds) {
  const list = okTrackIds(trackIds);
  return list.length ? ask("music:queue-next", [list]) : Promise.resolve(wontSend("There is nothing to put next."));
}
function queueEnd(trackIds) {
  const list = okTrackIds(trackIds);
  return list.length ? ask("music:queue-end", [list]) : Promise.resolve(wontSend("There is nothing to add."));
}
function queueRemove(index) {
  const at = okIndex(index);
  return at === null ? Promise.resolve(wontSend("That is not a place in the queue.")) : ask("music:queue-remove", [at]);
}
function queueReorder(from, to) {
  const a = okIndex(from);
  const b = okIndex(to);
  if (a === null || b === null) return Promise.resolve(wontSend("That is not a place in the queue."));
  if (a === b) return Promise.resolve(value(true));
  return ask("music:queue-reorder", [a, b]);
}
var queueClear = () => ask("music:queue-clear");
function setFavourite(trackId, on) {
  const one = okTrackId(trackId);
  return one ? ask("music:favourite", [one, on === true]) : Promise.resolve(wontSend("That song could not be changed."));
}
function createPlaylist(name, trackIds = []) {
  const words = okName(name);
  if (!words) return Promise.resolve(wontSend("Give the playlist a name."));
  const list = okTrackIds(trackIds);
  return run("create-playlist", words, list);
}
function renamePlaylist(id, name) {
  const one = okTrackId(id);
  const words = okName(name);
  if (!one || !words) return Promise.resolve(wontSend("Give the playlist a name."));
  return run("rename-playlist", one, words);
}
function removePlaylist(id) {
  const one = okTrackId(id);
  return one ? run("remove-playlist", one) : Promise.resolve(wontSend("That playlist could not be removed."));
}
function addToPlaylist(id, trackIds) {
  const one = okTrackId(id);
  const list = okTrackIds(trackIds);
  if (!one || list.length === 0) return Promise.resolve(wontSend("There is nothing to add."));
  return ask("music:add-to-playlist", [one, list]);
}
function removeFromPlaylist(id, trackId) {
  const one = okTrackId(id);
  const track = okTrackId(trackId);
  if (!one || !track) return Promise.resolve(wontSend("That song could not be taken out."));
  return ask("music:remove-from-playlist", [one, track]);
}
function reorderPlaylist(id, from, to) {
  const one = okTrackId(id);
  const a = okIndex(from);
  const b = okIndex(to);
  if (!one || a === null || b === null) return Promise.resolve(wontSend("That song could not be moved."));
  if (a === b) return Promise.resolve(value(null));
  return run("reorder-playlist", one, a, b);
}
function keepNoticed(names, duration, source) {
  if (!okName(names?.title) || !names?.artist) return Promise.resolve(wontSend("Orbis does not have a name for this one yet."));
  return ask("music:keep-heard", [names, okSeconds(duration) ?? 0, source]);
}
var importFiles = () => ask("music:import");
var watchFolder = () => ask("music:scan-folder");
var sendFilePiece = (piece) => run("drop-chunk", piece);
var setDj = (on) => run("dj", on === true);
function station(seedTrackId) {
  const seed = seedTrackId === void 0 ? void 0 : okTrackId(seedTrackId);
  if (seedTrackId !== void 0 && !seed) return Promise.resolve(wontSend("A station could not be started from that song."));
  return run("radio", seed);
}
var explorations = () => run("explorations");
function explore(id) {
  const one = okTrackId(id);
  return one ? run("explore", one) : Promise.resolve(wontSend("That is not something to explore."));
}
var taste = () => run("dna");
function whyThis(trackId) {
  const one = okTrackId(trackId);
  return one ? run("why", one) : Promise.resolve(wontSend("There is nothing to explain."));
}
var unexplored = () => run("exploration");
function setDiscovery(level) {
  const allowed = ["familiar", "balanced", "explore", "adventurous", "experimental"];
  return allowed.includes(level) ? run("discovery-level", level) : Promise.resolve(wontSend("That is not a level."));
}
function askFor(said) {
  const words = okName(said, 300);
  return words ? run("request", words) : Promise.resolve(wontSend("Say what you feel like."));
}
function forgetLearning(scope) {
  const allowed = ["session", "recent", "recommendations", "everything"];
  return allowed.includes(scope) ? run("reset-learning", scope) : Promise.resolve(wontSend("That is not something to forget."));
}
var saveSettings = (patch) => ask("music:save-settings", [patch]);
function covers(trackIds) {
  const list = okTrackIds(trackIds).slice(0, 60);
  return list.length ? run("artwork", list) : Promise.resolve(value({}));
}

// extension-src/music/dom.ts
function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.cls) node.className = options.cls;
  if (options.text !== void 0) node.textContent = options.text;
  if (options.title) node.title = options.title;
  if (options.label) node.setAttribute("aria-label", options.label);
  for (const [name, item] of Object.entries(options.attrs ?? {})) {
    if (item === null || item === void 0 || item === false) continue;
    node.setAttribute(name, item === true ? "" : String(item));
  }
  for (const [name, item] of Object.entries(options.style ?? {})) node.style.setProperty(name, item);
  for (const [name, handler] of Object.entries(options.on ?? {})) node.addEventListener(name, handler);
  for (const child of children) {
    if (child === null || child === void 0 || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}
function fill(node, ...children) {
  clear(node);
  for (const child of children) {
    if (child === null || child === void 0 || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}
function button(options, children = []) {
  const node = el("button", { ...options, attrs: { type: "button", ...options.attrs } }, children);
  if (options.onClick) node.addEventListener("click", options.onClick);
  if (!options.label && !options.text && options.title) node.setAttribute("aria-label", options.title);
  return node;
}
function says(title, detail = "", action) {
  return el("div", { cls: "om-says", attrs: { role: "status" } }, [
    el("p", { cls: "om-says-title", text: title }),
    detail ? el("p", { cls: "om-says-detail", text: detail }) : null,
    action ? button({ cls: "om-btn om-btn-quiet", text: action.label, onClick: action.onClick }) : null
  ]);
}

// extension-src/music/art.ts
var held = /* @__PURE__ */ new Map();
var tried = /* @__PURE__ */ new Set();
var listeners2 = [];
var asking = false;
function onCovers(listener) {
  listeners2.push(listener);
  return () => {
    listeners2 = listeners2.filter((one) => one !== listener);
  };
}
var coverFor = (trackId) => trackId ? held.get(trackId) : void 0;
async function want(trackIds) {
  if (asking) return;
  const batches = artworkBatches(trackIds, new Set(held.keys()), tried);
  if (batches.length === 0) return;
  asking = true;
  try {
    for (const batch of batches) {
      const answer = await covers(batch);
      for (const id of batch) tried.add(id);
      if (!answer.got) return;
      for (const [id, picture] of Object.entries(answer.value)) held.set(id, picture);
      while (held.size > ARTWORK_KEPT) {
        const oldest = held.keys().next();
        if (oldest.done) break;
        held.delete(oldest.value);
      }
      for (const listener of listeners2) listener();
    }
  } finally {
    asking = false;
  }
}
function tile(of, options = {}) {
  const picture = coverFor(of.id);
  const words = `${of.album ?? ""}|${of.artist ?? ""}|${of.title}`;
  const node = el("div", {
    cls: `om-tile om-tile-${options.size ?? "md"}${options.round ? " om-tile-round" : ""}${picture ? " om-tile-has" : ""}`,
    style: { "--om-hue": String(hueFor(words)) },
    attrs: { "aria-hidden": "true" }
  });
  if (picture) {
    const image = el("img", { cls: "om-tile-img", attrs: { src: picture, alt: "", decoding: "async", loading: "lazy" } });
    node.append(image);
  } else {
    node.append(el("span", { cls: "om-tile-letter", text: tileLetter(of.title) }));
  }
  return node;
}
function wash(trackId) {
  const picture = coverFor(trackId);
  const node = el("div", { cls: "om-wash", attrs: { "aria-hidden": "true" } });
  if (picture && /^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/.test(picture)) node.style.setProperty("--om-wash-image", `url("${picture}")`);
  return node;
}

// extension-src/music/icons.ts
var SVG = "http://www.w3.org/2000/svg";
var PATHS = {
  home: ["M3 10.5 12 3l9 7.5", "M5.5 9.5V21h13V9.5"],
  search: ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z", "m15.5 15.5 5 5"],
  library: ["M4 4h4v16H4z", "M10 4h4v16h-4z", "m16.5 5 3.5 1-3 14-3.5-1z"],
  heart: ["M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 7.8a4.1 4.1 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20Z"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3.5 6h.01", "M3.5 12h.01", "M3.5 18h.01"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5V12l3.5 2"],
  compass: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "m15.5 8.5-2 5-5 2 2-5z"],
  ear: ["M8 9a4 4 0 1 1 8 0c0 2-1.5 2.8-2.5 4-.8 1-.5 2.5-2 2.5", "M8.5 18.5a3 3 0 0 0 3 2.5"],
  folder: ["M3.5 7.5h5l2 2.5h10v9.5h-17z", "M3.5 7.5V5.5h5"],
  file: ["M6 3.5h7l5 5v15H6z", "M13 3.5v5h5"],
  settings: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M12 2.5v3", "M12 18.5v3", "M2.5 12h3", "M18.5 12h3", "m5.2 5.2 2.1 2.1", "m16.7 16.7 2.1 2.1", "m18.8 5.2-2.1 2.1", "m7.3 16.7-2.1 2.1"],
  play: ["M8 5.5v13l11-6.5z"],
  pause: ["M9 5.5v13", "M15 5.5v13"],
  prev: ["M18 5.5v13L8 12z", "M6 5.5v13"],
  next: ["M6 5.5v13L16 12z", "M18 5.5v13"],
  shuffle: ["M3.5 7h4l9 10h4", "m18 14 2.5 3-2.5 3", "M3.5 17h4l2-2.2", "m14.5 9.2 2-2.2h4", "m18 4 2.5 3-2.5 3"],
  repeat: ["M7 5.5h10l-2.5-2.5", "M20 8.5v7a3 3 0 0 1-3 3H7l2.5 2.5", "M4 15.5v-7a3 3 0 0 1 3-3"],
  volume: ["M4 10v4h3l4 3.5v-15L7 10z", "M14.5 9a4 4 0 0 1 0 6", "M17 6.5a7.5 7.5 0 0 1 0 11"],
  mute: ["M4 10v4h3l4 3.5v-15L7 10z", "m15 10 5 5", "m20 10-5 5"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  back: ["m11 5-7 7 7 7", "M4 12h16"],
  forward: ["m13 5 7 7-7 7", "M20 12H4"],
  note: ["M9 18V6l9-2v12", "M6.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", "M15.5 19a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
  panel: ["M3.5 4.5h17v15h-17z", "M14.5 4.5v15"],
  edit: ["M4 20h4l11-11-4-4L4 16z"],
  more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
  dj: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
  refresh: ["M20 12a8 8 0 1 1-2.6-5.9", "M20 4v4h-4"]
};
var ICON_NAMES = Object.freeze(Object.keys(PATHS));
function icon(name, size = 20) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const filled = name === "play";
  if (filled) {
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("stroke", "none");
  }
  for (const data of PATHS[name] ?? []) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  return svg;
}

// extension-src/music/player.ts
var EVERY = 1e3;
var AFTER_A_PRESS = 200;
var state = { music: null, answeredAt: 0, problem: null, shut: false, starting: true };
var mark = null;
var listeners3 = [];
var timer = null;
var asking2 = false;
var held2 = {};
var current = () => state;
function positionNow() {
  if (held2.seek !== void 0) return held2.seek;
  const playback = state.music?.playback;
  if (!playback) return 0;
  if (state.problem !== null || state.shut) return playback.position;
  return progressAt(playback, state.answeredAt, Date.now());
}
var volumeNow = () => held2.volume ?? state.music?.playback.volume ?? 1;
function holding(what, at) {
  if (at === null) delete held2[what];
  else held2[what] = at;
  tell();
}
function tell() {
  for (const listener of listeners3) listener(state);
}
function watch(listener) {
  listeners3.push(listener);
  return () => {
    listeners3 = listeners3.filter((one) => one !== listener);
  };
}
async function askOnce() {
  if (asking2) return;
  asking2 = true;
  let answer;
  try {
    answer = await now();
  } finally {
    asking2 = false;
  }
  if (answer.got) {
    const fresh = playbackMark(answer.value.playback);
    const changed = !sameMark(mark, fresh) || state.problem !== null || state.starting;
    mark = fresh;
    state = { music: answer.value, answeredAt: Date.now(), problem: null, shut: false, starting: false };
    if (changed) tell();
    return;
  }
  state = { music: state.music, answeredAt: state.answeredAt, problem: answer.why, shut: answer.shut, starting: false };
  tell();
}
var refresh = () => askOnce();
function refreshAfterPress() {
  setTimeout(() => void askOnce(), AFTER_A_PRESS);
}
function tick() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    if (!document.hidden) void askOnce();
    tick();
  }, EVERY);
}
var started = false;
function startWatching() {
  if (started) return;
  started = true;
  void askOnce();
  tick();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void askOnce();
  });
}

// extension-src/music/screens.ts
var registry = /* @__PURE__ */ new Map();
function registerScreen(shape) {
  if (registry.has(shape.screen)) {
    console.error(`Orbis Music: two screens are registered for "${shape.screen}". Only one file may draw a screen.`);
    return;
  }
  registry.set(shape.screen, shape);
}
var screenFor = (name) => registry.get(name);

// extension-src/music/shell.ts
var bar = null;
var noteStrip = null;
var host = null;
var sidePlaylists = null;
var navList = null;
var nowColumn = null;
var root = null;
var mounted = null;
var mountedKey = "";
var nowPlayingChosen = true;
var noteTimer = null;
function note(words) {
  if (!noteStrip) return;
  noteStrip.textContent = words;
  noteStrip.classList.toggle("om-note-on", words !== "");
  if (noteTimer) clearTimeout(noteTimer);
  if (words) noteTimer = setTimeout(() => note(""), 5e3);
}
async function tried2(doing) {
  const answer = await doing;
  if (!answer.got) note(answer.why);
  else {
    const said = answer.value;
    if (said && typeof said === "object" && said.ok === false) note(said.why ?? "Orbis could not do that.");
  }
  refreshAfterPress();
}
function navEntry(entry, current2) {
  const built = screenFor(entry.screen) !== void 0;
  return button(
    {
      cls: `om-nav-item${entry.screen === current2 ? " om-on" : ""}${built ? "" : " om-nav-unbuilt"}`,
      attrs: { "aria-current": entry.screen === current2 ? "page" : null },
      title: built ? void 0 : "This screen is not built yet.",
      onClick: () => go(entry.screen)
    },
    [icon(entry.icon, 18), el("span", { cls: "om-nav-label", text: entry.label })]
  );
}
function drawNav() {
  if (!navList) return;
  const current2 = route().screen;
  const main = MUSIC_NAV.filter((one) => !one.secondary);
  const rest = MUSIC_NAV.filter((one) => one.secondary);
  fill(
    navList,
    ...main.map((one) => navEntry(one, current2)),
    el("div", { cls: "om-nav-line", attrs: { role: "separator" } }),
    ...rest.map((one) => navEntry(one, current2))
  );
}
async function drawPlaylists() {
  if (!sidePlaylists) return;
  const answer = await playlists();
  if (!sidePlaylists) return;
  if (!answer.got) {
    fill(sidePlaylists, el("p", { cls: "om-side-says", text: answer.shut ? "Open the Orbis window to see your playlists." : answer.why }));
    return;
  }
  const lists = answer.value;
  if (lists.length === 0) {
    fill(sidePlaylists, el("p", { cls: "om-side-says", text: "No playlists yet." }));
    return;
  }
  const here = route();
  fill(
    sidePlaylists,
    ...lists.map(
      (list) => button(
        {
          cls: `om-side-row${here.screen === "playlist" && here.of === list.id ? " om-on" : ""}`,
          onClick: () => go("playlist", list.id)
        },
        [
          tile({ title: list.name }, { size: "sm" }),
          el("span", { cls: "om-side-words" }, [
            el("span", { cls: "om-side-name", text: list.name }),
            el("span", { cls: "om-side-sub", text: list.rule ? "Worked out from your music" : countText(list.tracks.length, "song", "songs") })
          ])
        ]
      )
    )
  );
}
function drawNowColumn(state2) {
  if (!nowColumn) return;
  const music_ = state2.music;
  if (!music_) {
    fill(nowColumn, says(state2.starting ? "Reading what is playing\u2026" : state2.shut ? "Orbis Music is not open" : "Nothing is playing"));
    return;
  }
  if (music_.playback.owner === "website") {
    fill(
      nowColumn,
      el("div", { cls: "om-col-head" }, [el("h2", { cls: "om-col-title", text: "Playing on a web page" })]),
      says("That player belongs to the page", "Orbis leaves it alone. It can tell you what the song is, and keep the name if you want it.")
    );
    return;
  }
  const track = music_.track;
  const byId = new Map(music_.queue.map((one) => [one.id, one]));
  const coming = queueParts(music_.playback.queue, music_.playback.at).next.slice(0, 20);
  fill(
    nowColumn,
    el("div", { cls: "om-col-head" }, [
      el("h2", { cls: "om-col-title", text: "Playing now" }),
      button({ cls: "om-icon", title: "Close this column", onClick: () => showNowPlaying(false) }, [icon("close", 18)])
    ]),
    track ? el("div", { cls: "om-col-now" }, [
      tile({ id: track.id, title: track.title, artist: track.artist, album: track.album, artwork: track.artwork }, { size: "xl" }),
      el("p", { cls: "om-col-track", text: track.title }),
      el("p", { cls: "om-col-artist", text: [track.artist, track.album].filter((one) => one).join(" \u2014 ") || "No artist named" }),
      whyNotPlayable(track) ? el("p", { cls: "om-col-warn", text: whyNotPlayable(track) }) : null
    ]) : says("Nothing is playing"),
    el("h3", { cls: "om-col-sub", text: "Up next" }),
    coming.length === 0 ? el("p", { cls: "om-side-says", text: "Nothing is lined up." }) : el(
      "ol",
      { cls: "om-col-queue" },
      coming.map((slot) => {
        const one = byId.get(slot.trackId);
        return el("li", { cls: "om-col-queue-row" }, [
          one ? button({ cls: "om-col-queue-play", title: `Play ${one.title}`, onClick: () => void tried2(play(one.id)) }, [
            tile({ id: one.id, title: one.title, artist: one.artist, album: one.album }, { size: "sm" }),
            el("span", { cls: "om-side-words" }, [
              el("span", { cls: "om-side-name", text: one.title }),
              el("span", { cls: "om-side-sub", text: one.artist || "No artist named" })
            ])
          ]) : (
            // An id the library no longer has a song for. Drawn as itself rather than skipped: dropping it
            // would shorten the list and put every take-out button below it on the wrong track.
            el("span", { cls: "om-side-words" }, [
              el("span", { cls: "om-side-name", text: "A song that is no longer in your music" }),
              el("span", { cls: "om-side-sub", text: "It is still in what is coming next. Take it out to be rid of it." })
            ])
          ),
          button(
            {
              cls: "om-icon om-icon-sm",
              title: "Take out of what is coming next",
              onClick: () => void tried2(queueRemove(slot.index))
            },
            [icon("close", 15)]
          )
        ]);
      })
    )
  );
  if (track) void want([track.id, ...coming.map((slot) => slot.trackId)]);
}
function showNowPlaying(on) {
  nowPlayingChosen = on;
  applyNowPlaying();
}
function applyNowPlaying() {
  if (!root) return;
  const wants = screenFor(route().screen)?.wants?.nowPlaying ?? "as-chosen";
  const on = wants === "show" ? true : wants === "hide" ? false : nowPlayingChosen;
  root.classList.toggle("om-no-column", !on);
  if (on) drawNowColumn(current());
}
function buildBar() {
  const art = el("div", { cls: "om-bar-art" });
  const title = el("span", { cls: "om-bar-title", text: "Nothing is playing" });
  const artist = el("span", { cls: "om-bar-artist", text: "" });
  const whose = el("span", { cls: "om-bar-whose", text: "" });
  const heart = button({ cls: "om-icon", title: "Favourite" }, [icon("heart", 18)]);
  const shuffle = button({ cls: "om-icon", title: "Shuffle" }, [icon("shuffle", 18)]);
  const prev = button({ cls: "om-icon", title: "Previous", onClick: () => void tried2(previous()) }, [icon("prev", 18)]);
  const playPause = button({ cls: "om-play", title: "Play" }, [icon("play", 20)]);
  const nextOne = button({ cls: "om-icon", title: "Next", onClick: () => void tried2(next()) }, [icon("next", 18)]);
  const repeat = button({ cls: "om-icon", title: "Repeat" }, [icon("repeat", 18)]);
  const elapsed = el("span", { cls: "om-time", text: "0:00" });
  const total = el("span", { cls: "om-time", text: "\u2014" });
  const seekFill = el("div", { cls: "om-rail-fill" });
  const seek2 = el("input", { cls: "om-rail-input", attrs: { type: "range", min: "0", max: "1000", value: "0", "aria-label": "How far through the track" } });
  const volume = el("input", { cls: "om-rail-input", attrs: { type: "range", min: "0", max: "100", value: "100", "aria-label": "Volume" } });
  const volumeFill = el("div", { cls: "om-rail-fill" });
  const volumeIcon = button({ cls: "om-icon", title: "Mute" }, [icon("volume", 18)]);
  const problem = el("p", { cls: "om-bar-problem" });
  const seekRail = el("div", { cls: "om-rail" }, [el("div", { cls: "om-rail-track" }), seekFill, seek2]);
  const volumeRail = el("div", { cls: "om-rail om-rail-short" }, [el("div", { cls: "om-rail-track" }), volumeFill, volume]);
  const seekAt = () => {
    const played = current().music?.playback;
    return seekTarget(Number(seek2.value) / 1e3, played?.duration ?? 0);
  };
  seek2.addEventListener("input", () => {
    const at = seekAt();
    if (at === null) return;
    holding("seek", at);
    elapsed.textContent = positionText(at);
    seekFill.style.setProperty("--om-fill", `${Number(seek2.value) / 10}%`);
  });
  const letGoOfSeek = () => {
    const at = seekAt();
    holding("seek", null);
    if (at === null) {
      note("This track has no known length, so there is nowhere to seek to.");
      return;
    }
    void tried2(seek(at));
  };
  seek2.addEventListener("change", letGoOfSeek);
  volume.addEventListener("input", () => {
    const level = Number(volume.value) / 100;
    holding("volume", level);
    volumeFill.style.setProperty("--om-fill", `${Number(volume.value)}%`);
  });
  volume.addEventListener("change", () => {
    const level = Number(volume.value) / 100;
    holding("volume", null);
    void tried2(setVolume(level));
  });
  playPause.addEventListener("click", () => void tried2(playOrPause()));
  shuffle.addEventListener("click", () => {
    const on = current().music?.playback.shuffle === true;
    void tried2(setShuffle(!on));
  });
  repeat.addEventListener("click", () => {
    const mode = current().music?.playback.repeat ?? "off";
    void tried2(setRepeat(nextRepeat(mode)));
  });
  volumeIcon.addEventListener("click", () => {
    const on = current().music?.playback.muted === true;
    void tried2(setMuted(!on));
  });
  heart.addEventListener("click", () => {
    const track = current().music?.track;
    if (!track) {
      note("Nothing is playing.");
      return;
    }
    void tried2(setFavourite(track.id, track.favourite !== true));
  });
  const whatsPlaying = button({ cls: "om-bar-who", title: "Show what is playing", onClick: () => showNowPlaying(true) }, [
    art,
    el("span", { cls: "om-bar-words" }, [title, artist, whose])
  ]);
  const rootNode = el("footer", { cls: "om-bar", attrs: { "aria-label": "Player" } }, [
    el("div", { cls: "om-bar-left" }, [whatsPlaying, heart]),
    el("div", { cls: "om-bar-middle" }, [
      el("div", { cls: "om-transport" }, [shuffle, prev, playPause, nextOne, repeat]),
      el("div", { cls: "om-seek" }, [elapsed, seekRail, total]),
      problem
    ]),
    el("div", { cls: "om-bar-right" }, [
      button({ cls: "om-icon", title: "Up next", onClick: () => go("queue") }, [icon("list", 18)]),
      button({ cls: "om-icon", title: "Show or hide the column on the right", onClick: () => showNowPlaying(!nowPlayingChosen) }, [icon("panel", 18)]),
      volumeIcon,
      volumeRail
    ])
  ]);
  return {
    root: rootNode,
    art,
    title,
    artist,
    heart,
    playPause,
    shuffle,
    repeat,
    elapsed,
    total,
    seek: seek2,
    seekFill,
    volume,
    volumeIcon,
    problem,
    whose,
    previous: prev,
    next: nextOne
  };
}
function drawBar(state2) {
  if (!bar) return;
  const music_ = state2.music;
  const playback = music_?.playback;
  const track = music_?.track ?? null;
  const website = playback?.owner === "website";
  fill(bar.art, tile({ id: track?.id, title: track?.title ?? "", artist: track?.artist, album: track?.album }, { size: "md" }));
  bar.title.textContent = track ? track.title : website ? "A web page is playing" : state2.starting ? "Reading what is playing\u2026" : "Nothing is playing";
  bar.artist.textContent = track ? track.artist || "No artist named" : "";
  const stale = !website && music_ !== null && (state2.shut || state2.problem !== null);
  bar.whose.textContent = website ? "Orbis leaves that player alone" : state2.shut ? "Orbis Music is not open" : stale ? "Last read did not answer, so this may be out of date" : "";
  const playing = playback?.playing === true && !stale;
  fill(bar.playPause, icon(playing ? "pause" : "play", 20));
  bar.playPause.title = playing ? "Pause" : "Play";
  bar.playPause.setAttribute("aria-label", bar.playPause.title);
  bar.playPause.disabled = website || !music_ || stale;
  bar.previous.disabled = stale;
  bar.next.disabled = stale;
  bar.root.classList.toggle("om-bar-stale", stale);
  bar.shuffle.classList.toggle("om-on", playback?.shuffle === true);
  bar.shuffle.setAttribute("aria-pressed", String(playback?.shuffle === true));
  const repeat = playback?.repeat ?? "off";
  bar.repeat.classList.toggle("om-on", repeat !== "off");
  bar.repeat.title = repeat === "off" ? "Repeat" : repeat === "all" ? "Repeating everything" : "Repeating this one";
  bar.repeat.setAttribute("aria-label", bar.repeat.title);
  bar.repeat.setAttribute("aria-pressed", String(repeat !== "off"));
  bar.repeat.classList.toggle("om-repeat-one", repeat === "one");
  bar.heart.classList.toggle("om-on", track?.favourite === true);
  bar.heart.title = track?.favourite === true ? "Take out of favourites" : "Add to favourites";
  bar.heart.setAttribute("aria-label", bar.heart.title);
  bar.heart.disabled = !track;
  fill(bar.volumeIcon, icon(playback?.muted ? "mute" : "volume", 18));
  bar.volumeIcon.title = playback?.muted ? "Turn the sound back on" : "Mute";
  bar.volumeIcon.setAttribute("aria-label", bar.volumeIcon.title);
  if (document.activeElement !== bar.volume) {
    const level = Math.round(volumeNow() * 100);
    bar.volume.value = String(level);
    const fillNode = bar.volume.parentElement?.querySelector(".om-rail-fill");
    if (fillNode instanceof HTMLElement) fillNode.style.setProperty("--om-fill", `${level}%`);
  }
  bar.problem.textContent = playback?.problem ?? (state2.problem && !state2.shut ? state2.problem : "");
  bar.problem.classList.toggle("om-on", bar.problem.textContent !== "");
  drawSeek();
  bar.root.classList.toggle("om-bar-website", website);
}
function drawSeek() {
  if (!bar) return;
  const playback = current().music?.playback;
  const duration = playback?.duration ?? 0;
  const at = positionNow();
  bar.total.textContent = clockText(duration);
  if (document.activeElement !== bar.seek) {
    bar.elapsed.textContent = positionText(at);
    const fraction = fillFraction(at, duration);
    bar.seek.value = String(Math.round(fraction * 1e3));
    bar.seekFill.style.setProperty("--om-fill", `${fraction * 100}%`);
  }
  bar.seek.disabled = !(duration > 0);
  bar.seek.setAttribute("aria-valuetext", duration > 0 ? `${positionText(at)} of ${clockText(duration)}` : "This track has no known length");
}
function mount() {
  if (!host) return;
  const here = route();
  const key = `${here.screen}|${here.of}`;
  const shape = screenFor(here.screen);
  document.title = shape?.title ? `${shape.title(here)} \u2014 Orbis Music` : "Orbis Music";
  applyNowPlaying();
  drawNav();
  void drawPlaylists();
  if (key === mountedKey && mounted) return;
  mounted?.leave?.();
  mounted = null;
  mountedKey = key;
  fill(host);
  if (!shape) {
    host.append(
      says(
        "This screen is not built yet",
        "The frame around it is: the player below, the list on the left and the browser\u2019s own back and forward all work.",
        { label: "Go to Home", onClick: () => go("home") }
      )
    );
    return;
  }
  host.classList.toggle("om-wide", shape.wants?.wide === true);
  mounted = shape.mount({
    into: host,
    route: here,
    go,
    replace,
    note,
    wantCovers: (ids) => void want(ids),
    refresh: () => void refresh(),
    showNowPlaying
  }) || null;
}
function startShell(into2) {
  bar = buildBar();
  navList = el("nav", { cls: "om-nav", attrs: { "aria-label": "Orbis Music" } });
  sidePlaylists = el("div", { cls: "om-side-list" });
  host = el("div", { cls: "om-screen" });
  nowColumn = el("aside", { cls: "om-column", attrs: { "aria-label": "What is playing" } });
  noteStrip = el("div", { cls: "om-note", attrs: { role: "status", "aria-live": "polite" } });
  const side = el("div", { cls: "om-side" }, [
    el("div", { cls: "om-brand" }, [icon("note", 22), el("span", { cls: "om-brand-name", text: "Orbis Music" })]),
    navList,
    el("div", { cls: "om-side-head" }, [
      // The heading opens the whole lot and the button beside it makes a new one. Both go to the same screen, which
      // is where a playlist is made: the heading is pressable because that is the first thing somebody tries.
      button({ cls: "om-side-title om-side-title-press", title: "All your playlists", onClick: () => go("playlists") }, [el("span", { text: "Your playlists" })]),
      button({ cls: "om-icon om-icon-sm", title: "New playlist", onClick: () => go("playlists") }, [icon("plus", 16)])
    ]),
    sidePlaylists
  ]);
  const main = el("main", { cls: "om-main" }, [
    el("div", { cls: "om-top" }, [
      button({ cls: "om-icon", title: "Back", onClick: back }, [icon("back", 18)]),
      button({ cls: "om-icon", title: "Forward", onClick: forward }, [icon("forward", 18)]),
      button({ cls: "om-top-search", onClick: () => go("search") }, [icon("search", 16), el("span", { text: "Search your music" })])
    ]),
    host
  ]);
  root = el("div", { cls: "om" }, [side, main, nowColumn, bar.root, noteStrip]);
  fill(into2, root);
  onRoute(mount);
  watch((state2) => {
    drawBar(state2);
    applyNowPlaying();
    mounted?.onPlayer?.(state2);
  });
  onCovers(() => {
    drawBar(current());
    applyNowPlaying();
    mounted?.onCovers?.();
  });
  setInterval(() => {
    if (!document.hidden) drawSeek();
  }, 250);
  startWatching();
  mount();
  drawBar(current());
}
function trackRow(track, options = {}) {
  const playable = playableOffline(track);
  const why = whyNotPlayable(track);
  const row = el("li", { cls: `om-row${options.playing ? " om-row-now" : ""}${playable ? "" : " om-row-off"}` });
  row.append(
    button(
      {
        cls: "om-row-play",
        title: playable ? `Play ${track.title}` : why ?? "This cannot be played",
        onClick: () => {
          if (!playable) {
            note(why ?? "Orbis has no audio for this track.");
            return;
          }
          if (options.onPlay) options.onPlay();
          else void tried2(play(track.id));
        }
      },
      [
        tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: "md" }),
        el("span", { cls: "om-row-words" }, [
          el("span", { cls: "om-row-title", text: track.title || "No title" }),
          el("span", { cls: "om-row-artist", text: [track.artist, track.album].filter((one) => one).join(" \u2014 ") || "No artist named" })
        ])
      ]
    ),
    // Always a node, even when there is nothing to say: the row is a grid of fixed columns, and leaving one out
    // would shift the length and the two buttons left on every playable track.
    why ? el("span", {
      cls: "om-pill om-pill-warn",
      text: track.availability === "reference" ? "No audio here" : track.availability === "missing" ? "File missing" : "Cannot be played"
    }) : el("span", { cls: "om-row-gap" }),
    el("span", { cls: "om-row-length", text: clockText(track.duration) }),
    button(
      {
        cls: `om-icon om-icon-sm${track.favourite ? " om-on" : ""}`,
        title: track.favourite ? "Take out of favourites" : "Add to favourites",
        onClick: () => void tried2(setFavourite(track.id, track.favourite !== true))
      },
      [icon("heart", 15)]
    ),
    options.queueAt === void 0 ? button({ cls: "om-icon om-icon-sm", title: "Add to what is coming next", onClick: () => void tried2(queueEnd([track.id])) }, [icon("plus", 15)]) : button({ cls: "om-icon om-icon-sm", title: "Take out of what is coming next", onClick: () => void tried2(queueRemove(options.queueAt)) }, [
      icon("close", 15)
    ])
  );
  return row;
}
var doAndSay = tried2;

// src/shared/music/record.ts
var BETWEEN = "";
var albumKey = (name, by) => `${name}${BETWEEN}${by}`;
function readAlbumKey(key) {
  const at = key.indexOf(BETWEEN);
  if (at < 0) return { name: key.trim(), by: "" };
  return { name: key.slice(0, at).trim(), by: key.slice(at + BETWEEN.length).trim() };
}
function isAlbum(group, key) {
  const wanted = readAlbumKey(key);
  if (plainly(group.name) !== plainly(wanted.name)) return false;
  if (wanted.by === "") return true;
  return plainly(group.by ?? "") === plainly(wanted.by);
}
var isArtist = (name, key) => plainly(name) === plainly(key.trim());
var hasFile = (track) => track.availability === "local" && typeof track.file === "string" && track.file !== "";
function factsOf(tracks) {
  let seconds = 0;
  let anyUnknown = false;
  const years = /* @__PURE__ */ new Set();
  const playableIds3 = [];
  for (const track of tracks) {
    if (Number.isFinite(track.duration) && track.duration > 0) seconds += track.duration;
    else anyUnknown = true;
    if (typeof track.year === "number" && Number.isFinite(track.year)) years.add(track.year);
    if (hasFile(track)) playableIds3.push(track.id);
  }
  return {
    tracks: tracks.length,
    seconds: anyUnknown || tracks.length === 0 ? null : seconds,
    year: years.size === 1 ? [...years][0] : null,
    playable: playableIds3.length,
    playableIds: playableIds3
  };
}
function mostPlayed(tracks, limit = 5) {
  const played = tracks.filter((track) => typeof track.playCount === "number" && track.playCount > 0);
  const sorted = [...played].sort(
    (a, b) => (b.playCount ?? 0) - (a.playCount ?? 0) || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || a.title.localeCompare(b.title)
  );
  return sorted.slice(0, Math.max(0, limit));
}
function albumsOf(tracks) {
  const byKey = /* @__PURE__ */ new Map();
  for (const track of tracks) {
    const name = track.album.trim() || "Unknown album";
    const key = plainly(name);
    const held4 = byKey.get(key);
    if (held4) {
      held4.tracks.push(track);
      held4.year ??= track.year;
    } else byKey.set(key, { name, by: (track.albumArtist ?? track.artist).trim(), tracks: [track], year: track.year });
  }
  const groups = [...byKey.values()];
  for (const group of groups) {
    group.tracks.sort((a, b) => (a.discNumber ?? 0) - (b.discNumber ?? 0) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0) || a.title.localeCompare(b.title));
  }
  return groups.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name));
}
function genresOf(tracks, limit = 4) {
  const counts = /* @__PURE__ */ new Map();
  for (const track of tracks) {
    const name = (track.genre ?? "").trim();
    if (name === "") continue;
    const key = plainly(name);
    const held4 = counts.get(key);
    if (held4) held4.count += 1;
    else counts.set(key, { name, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, Math.max(0, limit)).map((one) => one.name);
}
function yearsText(tracks) {
  const years = tracks.map((track) => track.year).filter((year) => typeof year === "number" && Number.isFinite(year));
  if (years.length === 0) return "";
  const low = Math.min(...years);
  const high = Math.max(...years);
  return low === high ? String(low) : `${low}\u2013${high}`;
}
function faceOf(tracks) {
  if (tracks.length === 0) return null;
  return tracks.find((track) => typeof track.artwork === "string" && track.artwork !== "") ?? tracks[0];
}

// extension-src/music/screens/album.ts
registerScreen({
  screen: "album",
  title: (route2) => readAlbumKey(route2.of).name || "Album",
  mount: (place2) => mountAlbum(place2)
});
function mountAlbum(place2) {
  const head = el("div", { cls: "om-rec-head" });
  const list = el("ul", { cls: "om-rows", attrs: { "aria-label": "The tracks on this album" } });
  const body = el("div", { cls: "om-rec" }, [head, list]);
  fill(place2.into, body);
  let group = null;
  let playingId = null;
  const wanted = readAlbumKey(place2.route.of);
  if (wanted.name === "") {
    fill(place2.into, says("That address does not name an album", "Open an album from Your music and the address will be right."));
    return {};
  }
  function drawRows() {
    if (!group) return;
    const facts = factsOf(group.tracks);
    fill(
      list,
      ...group.tracks.map((track) => {
        const row = trackRow(track, {
          playing: track.id === playingId,
          // Pressing a track plays the album from there, which is what a tracklist is for. Only the tracks with
          // audio on this computer go into the run: the service would skip the others, and a queue that silently
          // drops half of what you asked for is worse than one that was honest about what it could play.
          onPlay: () => {
            const at = facts.playableIds.indexOf(track.id);
            if (at < 0) {
              place2.note("Orbis has no audio for this track.");
              return;
            }
            void doAndSay(playAll(facts.playableIds, at));
          }
        });
        row.setAttribute("data-om-track", track.id);
        return row;
      })
    );
  }
  function drawHead() {
    if (!group) return;
    const facts = factsOf(group.tracks);
    const face = faceOf(group.tracks);
    const lines = [group.by ?? ""];
    lines.push(facts.year === null ? "No year in these files" : String(facts.year));
    lines.push(countText(facts.tracks, "track", "tracks"));
    if (facts.seconds !== null) lines.push(spanText(facts.seconds));
    fill(
      head,
      wash(face?.id),
      el("div", { cls: "om-rec-art" }, [face ? tile({ id: face.id, title: group.name, artist: group.by, album: group.name }, { size: "xl" }) : null]),
      el("div", { cls: "om-rec-words" }, [
        el("p", { cls: "om-rec-kicker", text: "Album" }),
        el("h1", { cls: "om-rec-title", text: group.name }),
        el("p", { cls: "om-rec-line", text: lines.filter((one) => one !== "").join(" \xB7 ") }),
        // Said plainly rather than left to the rows: a record you can open but cannot play is a thing somebody needs
        // to be told about once, at the top, not worked out by reading every row's pill.
        facts.playable === 0 ? el("p", { cls: "om-rec-note", text: "None of these tracks has audio on this computer. Import your own copies to play them here." }) : facts.playable < facts.tracks ? el("p", { cls: "om-rec-note", text: `${countText(facts.playable, "track", "tracks")} here can be played; the rest Orbis only knows by name.` }) : null,
        el("div", { cls: "om-rec-buttons" }, [
          button(
            {
              cls: "om-btn om-btn-primary",
              attrs: { disabled: facts.playable === 0 },
              title: facts.playable === 0 ? "There is no audio here to play" : void 0,
              onClick: () => void doAndSay(playAll(facts.playableIds, 0))
            },
            [icon("play", 16), el("span", { text: "Play" })]
          ),
          button(
            {
              cls: "om-btn",
              attrs: { disabled: facts.playable < 2 },
              // Shuffle is a setting on the player, not a way of starting something, so this turns it on and then
              // starts the album. Read back afterwards like every other press, so the bar and this button agree.
              onClick: async () => {
                await doAndSay(setShuffle(true));
                await doAndSay(playAll(facts.playableIds, 0));
              }
            },
            [icon("shuffle", 16), el("span", { text: "Shuffle" })]
          ),
          button({ cls: "om-btn om-btn-quiet", onClick: () => void doAndSay(queueEnd(facts.playableIds)) }, [
            icon("plus", 16),
            el("span", { text: "Add to what is coming next" })
          ]),
          group.by ? button({ cls: "om-btn om-btn-quiet", onClick: () => place2.go("artist", group?.by ?? "") }, [el("span", { text: `Go to ${group.by}` })]) : null
        ])
      ])
    );
  }
  function draw() {
    drawHead();
    drawRows();
    if (group) place2.wantCovers(group.tracks.map((one) => one.id));
  }
  async function load() {
    fill(place2.into, says(`Reading ${wanted.name}\u2026`));
    const answer = await albums();
    if (!answer.got) {
      const words = emptyWords(answer.shut ? "unreachable" : "failed", "albums", answer.why);
      fill(place2.into, says(words.title, words.detail, words.retry ? { label: "Try again", onClick: () => void load() } : void 0));
      return;
    }
    const found = answer.value.find((one) => isAlbum(one, place2.route.of));
    if (!found) {
      fill(
        place2.into,
        says(
          `There is no album called ${wanted.name} in your music`,
          "It may have been renamed, or the link may be from before it was taken out.",
          { label: "Try again", onClick: () => void load() }
        )
      );
      return;
    }
    group = found;
    fill(place2.into, body);
    draw();
  }
  void load();
  return {
    onPlayer: (state2) => {
      const id = state2.music?.playback.trackId ?? null;
      if (id === playingId) return;
      playingId = id;
      for (const row of list.querySelectorAll(".om-row")) row.classList.toggle("om-row-now", row.getAttribute("data-om-track") === playingId);
    },
    onCovers: () => {
      if (group) draw();
    }
  };
}

// extension-src/music/screens/artist.ts
registerScreen({
  screen: "artist",
  title: (route2) => route2.of || "Artist",
  mount: (place2) => mountArtist(place2)
});
var TOP = 5;
function mountArtist(place2) {
  const head = el("div", { cls: "om-rec-head" });
  const sections = el("div", { cls: "om-rec-sections" });
  const body = el("div", { cls: "om-rec" }, [head, sections]);
  let group = null;
  let playingId = null;
  const wanted = place2.route.of.trim();
  if (wanted === "") {
    fill(place2.into, says("That address does not name an artist", "Open an artist from Your music and the address will be right."));
    return {};
  }
  function rowsOf(tracks, label, plays = false) {
    const ids = factsOf(tracks).playableIds;
    const list = el("ul", { cls: `om-rows${plays ? " om-rec-top" : ""}`, attrs: { "aria-label": label } });
    for (const track of tracks) {
      const row = trackRow(track, {
        playing: track.id === playingId,
        onPlay: () => {
          const at = ids.indexOf(track.id);
          if (at < 0) {
            place2.note("Orbis has no audio for this track.");
            return;
          }
          void doAndSay(playAll(ids, at));
        }
      });
      if (plays) {
        const count = track.playCount ?? 0;
        const length = row.querySelector(".om-row-length");
        const said = el("span", { cls: "om-rec-plays", text: countText(count, "play", "plays") });
        if (length) row.insertBefore(said, length);
        else row.append(said);
      }
      row.setAttribute("data-om-track", track.id);
      list.append(row);
    }
    return list;
  }
  function albumCard(album) {
    const facts = factsOf(album.tracks);
    const face = faceOf(album.tracks);
    const lines = [facts.year === null ? "No year in these files" : String(facts.year), countText(facts.tracks, "track", "tracks")];
    return button(
      {
        cls: `om-card${facts.playable === 0 ? " om-card-off" : ""}`,
        onClick: () => place2.go("album", albumKey(album.name, album.by ?? group?.name ?? ""))
      },
      [
        el("div", { cls: "om-card-cover" }, [
          face ? tile({ id: face.id, title: album.name, artist: album.by, album: album.name }, { size: "lg" }) : null,
          el("span", { cls: "om-card-play", attrs: { "aria-hidden": "true" } }, [icon("play", 18)])
        ]),
        el("span", { cls: "om-card-words" }, [
          el("span", { cls: "om-card-name", text: album.name }),
          el("span", { cls: "om-card-under", text: lines.join(" \xB7 ") })
        ])
      ]
    );
  }
  function section(title, detail, inner) {
    return el("section", { cls: "om-rec-section" }, [
      el("h2", { cls: "om-rec-section-title", text: title }),
      detail ? el("p", { cls: "om-rec-section-detail", text: detail }) : null,
      inner
    ]);
  }
  function draw() {
    if (!group) return;
    const facts = factsOf(group.tracks);
    const theirAlbums = albumsOf(group.tracks);
    const face = faceOf(group.tracks);
    const top = mostPlayed(group.tracks, TOP);
    const years = yearsText(group.tracks);
    const kinds = genresOf(group.tracks);
    const lines = [countText(theirAlbums.length, "album", "albums"), countText(facts.tracks, "track", "tracks")];
    if (years !== "") lines.push(years);
    if (kinds.length > 0) lines.push(kinds.join(", "));
    fill(
      head,
      wash(face?.id),
      el("div", { cls: "om-rec-art" }, [face ? tile({ id: face.id, title: group.name, artist: group.name }, { size: "xl", round: true }) : null]),
      el("div", { cls: "om-rec-words" }, [
        el("p", { cls: "om-rec-kicker", text: "Artist" }),
        el("h1", { cls: "om-rec-title", text: group.name }),
        el("p", { cls: "om-rec-line", text: lines.join(" \xB7 ") }),
        // The cover of one of their records, not a picture of them: Orbis has no artist pictures at all, and a
        // record sleeve standing in for a face would be read as a face.
        el("p", { cls: "om-rec-note", text: "The picture is one of their covers. Orbis has no artist photographs." }),
        facts.playable === 0 ? el("p", { cls: "om-rec-note", text: "None of these tracks has audio on this computer yet." }) : null,
        el("div", { cls: "om-rec-buttons" }, [
          button(
            {
              cls: "om-btn om-btn-primary",
              attrs: { disabled: facts.playable === 0 },
              title: facts.playable === 0 ? "There is no audio here to play" : void 0,
              onClick: () => void doAndSay(playAll(facts.playableIds, 0))
            },
            [icon("play", 16), el("span", { text: "Play" })]
          ),
          button(
            {
              cls: "om-btn",
              attrs: { disabled: facts.playable < 2 },
              onClick: async () => {
                await doAndSay(setShuffle(true));
                await doAndSay(playAll(facts.playableIds, 0));
              }
            },
            [icon("shuffle", 16), el("span", { text: "Shuffle" })]
          ),
          button({ cls: "om-btn om-btn-quiet", onClick: () => void doAndSay(queueEnd(facts.playableIds)) }, [
            icon("plus", 16),
            el("span", { text: "Add to what is coming next" })
          ])
        ])
      ])
    );
    fill(
      sections,
      // Left out rather than shown empty: a most-played list with nothing in it says something false about how much
      // Orbis knows, where no list at all says only that nothing has been played yet.
      top.length === 0 ? section("Most played", "Nothing by them has been played through Orbis Music yet, so there is nothing to count.", null) : section("Most played", "Counted from what really played, not from how often a button was pressed.", rowsOf(top, `The most played ${group.name} tracks`, true)),
      section(
        countText(theirAlbums.length, "Album", "Albums"),
        "",
        el("div", { cls: "om-rec-grid" }, theirAlbums.map((album) => albumCard(album)))
      ),
      section("Every track", "", rowsOf(group.tracks, `Every ${group.name} track in your music`))
    );
    place2.wantCovers(group.tracks.map((one) => one.id));
  }
  async function load() {
    fill(place2.into, says(`Reading ${wanted}\u2026`));
    const answer = await artists();
    if (!answer.got) {
      const words = emptyWords(answer.shut ? "unreachable" : "failed", "artists", answer.why);
      fill(place2.into, says(words.title, words.detail, words.retry ? { label: "Try again", onClick: () => void load() } : void 0));
      return;
    }
    const found = answer.value.find((one) => isArtist(one.name, wanted));
    if (!found) {
      fill(
        place2.into,
        says(`There is nothing by ${wanted} in your music`, "The name may have changed, or the link may be from before those tracks were taken out.", {
          label: "Try again",
          onClick: () => void load()
        })
      );
      return;
    }
    group = found;
    fill(place2.into, body);
    draw();
  }
  void load();
  return {
    onPlayer: (state2) => {
      const id = state2.music?.playback.trackId ?? null;
      if (id === playingId) return;
      playingId = id;
      for (const row of sections.querySelectorAll(".om-row")) row.classList.toggle("om-row-now", row.getAttribute("data-om-track") === playingId);
    },
    onCovers: () => {
      if (group) draw();
    }
  };
}

// extension-src/music/screens/own-parts.ts
function block(title, detail, children, action) {
  return el("section", { cls: "om-own-block" }, [
    el("div", { cls: "om-own-block-head" }, [
      el("div", {}, [el("h2", { cls: "om-own-block-title", text: title }), detail ? el("p", { cls: "om-own-block-detail", text: detail }) : null]),
      action ?? null
    ]),
    ...children
  ]);
}
var screenHead = (title, detail) => el("header", { cls: "om-own-head" }, [el("h1", { cls: "om-own-title", text: title }), detail ? el("p", { cls: "om-own-lead", text: detail }) : null]);
var card = (cls, children) => el("div", { cls: `om-own-card ${cls}`.trim() }, children);
var figure = (count, what) => el("div", { cls: "om-own-figure" }, [el("span", { cls: "om-own-figure-count", text: count }), el("span", { cls: "om-own-figure-what", text: what })]);
var figures = (children) => el("div", { cls: "om-own-figures" }, children);
function toggleRow(options) {
  const press2 = button(
    {
      cls: `om-own-switch${options.on ? " om-on" : ""}`,
      attrs: { role: "switch", "aria-checked": String(options.on), disabled: options.disabled ? true : null },
      label: options.label,
      onClick: () => options.onChange(!options.on)
    },
    [el("span", { cls: "om-own-switch-dot", attrs: { "aria-hidden": "true" } })]
  );
  return el("div", { cls: "om-own-row" }, [
    el("div", { cls: "om-own-row-words" }, [
      el("span", { cls: "om-own-row-label", text: options.label }),
      options.detail ? el("span", { cls: "om-own-row-detail", text: options.detail }) : null
    ]),
    press2
  ]);
}
function choices(options) {
  return el("div", { cls: "om-own-row om-own-row-stack" }, [
    el("div", { cls: "om-own-row-words" }, [
      el("span", { cls: "om-own-row-label", text: options.label }),
      options.detail ? el("span", { cls: "om-own-row-detail", text: options.detail }) : null
    ]),
    el(
      "div",
      { cls: "om-own-choices", attrs: { role: "group", "aria-label": options.label } },
      options.items.map(
        (item) => button(
          {
            cls: `om-own-choice${item.id === options.chosen ? " om-on" : ""}`,
            attrs: { "aria-pressed": options.chosen === null ? null : String(item.id === options.chosen) },
            title: item.blurb,
            onClick: () => options.onPick(item.id)
          },
          [el("span", { cls: "om-own-choice-label", text: item.label }), item.blurb ? el("span", { cls: "om-own-choice-blurb", text: item.blurb }) : null]
        )
      )
    )
  ]);
}
function readingBar(name, value2, firm) {
  return el("div", { cls: `om-own-reading${firm ? "" : " om-own-reading-soft"}` }, [
    el("span", { cls: "om-own-reading-name", text: name }),
    el("span", { cls: "om-own-reading-rail", attrs: { "aria-hidden": "true" } }, [
      el("span", { cls: "om-own-reading-fill", style: { "--om-own-fill": `${value2}%` } })
    ]),
    el("span", { cls: "om-own-reading-value", text: String(value2), attrs: { "aria-label": `${name}: ${value2} out of 100` } })
  ]);
}
var press = (label, onClick, kind = "normal", iconName) => button({ cls: `om-btn${kind === "primary" ? " om-btn-primary" : kind === "quiet" ? " om-btn-quiet" : ""}`, onClick }, [
  iconName ? icon(iconName, 16) : null,
  el("span", { text: label })
]);
function carefulPress(label, question, onYes, iconName) {
  let asking4 = false;
  let timer2 = null;
  const node = button({ cls: "om-btn om-btn-quiet" }, [iconName ? icon(iconName, 16) : null, el("span", { text: label })]);
  const settle2 = () => {
    asking4 = false;
    node.classList.remove("om-own-asking");
    fill(node, iconName ? icon(iconName, 16) : null, el("span", { text: label }));
  };
  node.addEventListener("click", () => {
    if (asking4) {
      if (timer2) clearTimeout(timer2);
      settle2();
      onYes();
      return;
    }
    asking4 = true;
    node.classList.add("om-own-asking");
    fill(node, el("span", { text: question }));
    timer2 = setTimeout(settle2, 6e3);
  });
  return node;
}
function unwrap(answer, what) {
  if (answer.got) return { value: answer.value };
  const reason = answer.shut ? "unreachable" : "failed";
  const words = emptyWords(reason, what, answer.why);
  return { problem: says(words.title, words.detail) };
}
var reading = (what) => says(emptyWords("loading", what).title);
var nothingYet = (what, detail = "") => says(emptyWords("empty", what).title, detail);

// extension-src/music/screens/bring-in.ts
var AUDIO = /* @__PURE__ */ new Set(["mp3", "m4a", "mp4", "aac", "flac", "ogg", "oga", "opus", "wav", "wave"]);
var PIECE = 3 * 1024 * 1024;
var endOf = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};
function asText(bytes) {
  let out = "";
  for (let at = 0; at < bytes.length; at += 8192) out += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(out);
}
function importWords(answer) {
  const added = answer?.added ?? 0;
  const already = answer?.already ?? 0;
  const failed = answer?.failed ?? 0;
  if (added === 0 && already === 0 && failed === 0) return "Nothing was added.";
  const parts = [`${countText(added, "song", "songs")} added`];
  if (already > 0) parts.push(`${already} already in your music`);
  if (failed > 0) parts.push(`${failed} could not be read`);
  return `${parts.join(", ")}.`;
}
registerScreen({
  screen: "bring-in",
  title: () => "Bring music in",
  mount: (place2) => {
    const countPlace = el("div", { cls: "om-own-slot" }, [reading("music")]);
    const dropPlace = el("div", { cls: "om-own-slot" });
    const folderPlace = el("div", { cls: "om-own-slot" }, [reading("settings")]);
    let busy = false;
    let depth = 0;
    async function drawCounts() {
      const answer = await now();
      const got = unwrap(answer, "music");
      if ("problem" in got) {
        fill(countPlace, got.problem);
        return;
      }
      const summary = got.value.summary;
      fill(
        countPlace,
        figures([
          figure(String(summary.tracks), summary.tracks === 1 ? "song" : "songs"),
          figure(String(summary.offline), "playable here"),
          // The reference count is how the "kept by name, no audio" idea stays visible wherever you are.
          figure(String(summary.reference), "kept by name only"),
          summary.missing > 0 ? figure(String(summary.missing), "files not where they were") : null
        ])
      );
    }
    async function drawFolders() {
      const answer = await settings();
      const got = unwrap(answer, "settings");
      if ("problem" in got) {
        fill(folderPlace, got.problem);
        return;
      }
      const folders = got.value.folders ?? [];
      fill(
        folderPlace,
        card("", [
          el("div", { cls: "om-own-row-words" }, [
            el("span", {
              cls: "om-own-row-label",
              text: folders.length === 0 ? "No folders are being watched" : `${countText(folders.length, "folder is", "folders are")} being watched`
            }),
            el("span", {
              cls: "om-own-row-detail",
              text: folders.length === 0 ? "Point Orbis at a folder and anything you put in it from then on turns up in your music by itself." : "Anything you put in them turns up in your music by itself. Which folders they are is not shown here: a browser page is never told where your files live."
            })
          ]),
          el("div", { cls: "om-own-acts" }, [
            press("Watch a folder", () => void withPicker(watchFolder()), "primary", "folder"),
            press("Stop reading", () => void doAndSay(run("stop-scan")), "quiet")
          ])
        ])
      );
    }
    async function withPicker(doing) {
      if (busy) return;
      busy = true;
      place2.note("The Orbis window is asking you to choose. Nothing is added until you do.");
      const answer = await doing;
      busy = false;
      if (!answer.got) {
        place2.note(answer.why);
        return;
      }
      place2.note(importWords(answer.value));
      await Promise.all([drawCounts(), drawFolders()]);
      place2.refresh();
    }
    function drawDrop() {
      fill(
        dropPlace,
        card("om-own-drop", [
          el("div", { cls: "om-own-row-words" }, [
            el("span", { cls: "om-own-row-label", text: "Drop songs here" }),
            el("span", {
              cls: "om-own-row-detail",
              text: "Or choose them yourself. Orbis reads mp3, m4a, aac, flac, ogg, opus and wav. The file itself is never changed."
            })
          ]),
          el("div", { cls: "om-own-acts" }, [press("Choose files", () => void withPicker(importFiles()), "primary", "file")])
        ])
      );
    }
    async function sendOne(file, which, total) {
      const key = `${Date.now().toString(36)}-${which}-${Math.random().toString(36).slice(2, 8)}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (let at = 0; at < Math.max(bytes.length, 1); at += PIECE) {
        const last = at + PIECE >= bytes.length;
        place2.note(`Adding ${which + 1} of ${total}: ${file.name}`);
        const answer = await sendFilePiece({ name: file.name, key, data: asText(bytes.subarray(at, at + PIECE)), last });
        if (!answer.got) {
          place2.note(answer.why);
          return false;
        }
        const said = answer.value;
        if (said && said.ok === false) {
          place2.note(said.why ?? `${file.name} could not be added.`);
          return false;
        }
      }
      return true;
    }
    async function dropped(files) {
      if (busy) return;
      const audio = files.filter((file) => AUDIO.has(endOf(file.name)));
      const skipped = files.length - audio.length;
      if (audio.length === 0) {
        place2.note(skipped > 0 ? "None of those are audio files Orbis can read." : "There was nothing to add.");
        return;
      }
      busy = true;
      let added = 0;
      for (let which = 0; which < audio.length; which++) {
        if (await sendOne(audio[which], which, audio.length)) added += 1;
      }
      busy = false;
      place2.note(
        `${countText(added, "song", "songs")} added${added < audio.length ? `, ${audio.length - added} could not be read` : ""}${skipped > 0 ? `, ${skipped} skipped as not audio` : ""}.`
      );
      await drawCounts();
      place2.refresh();
    }
    fill(
      place2.into,
      screenHead("Bring music in", "Your own files, and nothing else. Orbis has no catalogue, so nothing here downloads anything."),
      block("What you have now", "Counted off your library.", [countPlace]),
      block("Add songs", "One go, from files you choose or drop.", [dropPlace]),
      block("Watch a folder", "Added once, kept up with from then on.", [folderPlace])
    );
    drawDrop();
    void drawCounts();
    void drawFolders();
    const over = (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
    };
    const enter = (event) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      depth += 1;
      place2.into.classList.add("om-own-dropping");
    };
    const leave = () => {
      depth = Math.max(depth - 1, 0);
      if (depth === 0) place2.into.classList.remove("om-own-dropping");
    };
    const drop = (event) => {
      event.preventDefault();
      depth = 0;
      place2.into.classList.remove("om-own-dropping");
      void dropped([...event.dataTransfer?.files ?? []]);
    };
    place2.into.addEventListener("dragover", over);
    place2.into.addEventListener("dragenter", enter);
    place2.into.addEventListener("dragleave", leave);
    place2.into.addEventListener("drop", drop);
    return {
      leave: () => {
        place2.into.removeEventListener("dragover", over);
        place2.into.removeEventListener("dragenter", enter);
        place2.into.removeEventListener("dragleave", leave);
        place2.into.removeEventListener("drop", drop);
      }
    };
  }
});

// src/shared/music/listening.ts
var playsOf = (track) => typeof track.playCount === "number" && track.playCount > 0 ? Math.floor(track.playCount) : 0;
function listeningSummary(library2) {
  let songsPlayed = 0;
  let totalPlays = 0;
  let neverPlayed = 0;
  let lastAt = null;
  for (const track of library2) {
    const plays = playsOf(track);
    if (plays > 0) {
      songsPlayed += 1;
      totalPlays += plays;
    } else neverPlayed += 1;
    const at = track.lastPlayedAt;
    if (typeof at === "number" && Number.isFinite(at) && at > 0 && (lastAt === null || at > lastAt)) lastAt = at;
  }
  return { songsPlayed, totalPlays, neverPlayed, lastAt };
}
function topSongs(library2, limit = 10) {
  return library2.filter((track) => playsOf(track) > 0).sort((a, b) => playsOf(b) - playsOf(a) || (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0) || a.title.localeCompare(b.title)).slice(0, Math.max(limit, 0));
}
function tally(library2, nameOf2, limit) {
  const by = /* @__PURE__ */ new Map();
  for (const track of library2) {
    const plays = playsOf(track);
    if (plays === 0) continue;
    const name = nameOf2(track).trim();
    if (name === "") continue;
    const held4 = by.get(name) ?? { plays: 0, songs: 0 };
    held4.plays += plays;
    held4.songs += 1;
    by.set(name, held4);
  }
  return [...by.entries()].map(([name, held4]) => ({ name, plays: held4.plays, songs: held4.songs })).sort((a, b) => b.plays - a.plays || b.songs - a.songs || a.name.localeCompare(b.name)).slice(0, Math.max(limit, 0));
}
var topArtists = (library2, limit = 8) => tally(library2, (track) => track.artist, limit);
var topAlbums = (library2, limit = 8) => tally(library2, (track) => track.album, limit);
var topGenres = (library2, limit = 8) => tally(library2, (track) => track.genre ?? "", limit);
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateWords(at) {
  if (!Number.isFinite(at) || at <= 0) return "";
  const when = new Date(at);
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
}
function whenWords(at, now2) {
  if (!Number.isFinite(at) || at <= 0) return "";
  const gap = now2 - at;
  if (gap < 45e3) return "Just now";
  const minutes = Math.round(gap / 6e4);
  if (minutes < 60) return minutes === 1 ? "A minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(gap / 36e5);
  if (hours < 24) return hours === 1 ? "An hour ago" : `${hours} hours ago`;
  const days = Math.floor(gap / 864e5);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return dateWords(at);
}
function dayWords(at, now2) {
  if (!Number.isFinite(at) || at <= 0) return "Earlier";
  const midnight = (stamp) => {
    const when = new Date(stamp);
    return new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime();
  };
  const apart2 = Math.round((midnight(now2) - midnight(at)) / 864e5);
  if (apart2 <= 0) return "Today";
  if (apart2 === 1) return "Yesterday";
  return dateWords(at);
}
function byDay(things, now2) {
  const out = [];
  for (const one of [...things].sort((a, b) => b.at - a.at)) {
    const day = dayWords(one.at, now2);
    const last = out[out.length - 1];
    if (last && last.day === day) last.things.push(one);
    else out.push({ day, things: [one] });
  }
  return out;
}
var noticedOffer = (song) => typeof song.trackId === "string" && song.trackId.length > 0 ? "play" : "keep";
var DISCOVERY_LEVELS = Object.freeze([
  { id: "familiar", label: "Familiar", blurb: "Things you know." },
  { id: "balanced", label: "Balanced", blurb: "Mostly things you know, with something new now and then." },
  { id: "explore", label: "Explore", blurb: "An even mix of the known and the unheard." },
  { id: "adventurous", label: "Adventurous", blurb: "Mostly things you have not played." },
  { id: "experimental", label: "Experimental", blurb: "Whatever is furthest from your usual." }
]);
var FORGET_SCOPES = Object.freeze([
  { id: "session", label: "This sitting", blurb: "What Orbis has read into the last hour of listening." },
  { id: "recent", label: "Lately", blurb: "The recent layer of what it has learned. Your longer-term taste stays." },
  { id: "recommendations", label: "What it chooses", blurb: "The models behind what it picks next. Your taste stays." },
  { id: "everything", label: "Everything it has learned", blurb: "All of it, back to a blank. Your music and playlists are untouched." }
]);
function tasteBars(readings, limit = 8) {
  return readings.filter((one) => Number.isFinite(one.value) && one.evidence > 0).sort((a, b) => b.confidence - a.confidence || b.evidence - a.evidence).slice(0, Math.max(limit, 0)).map((one) => ({
    name: one.name,
    value: Math.min(Math.max(Math.round(one.value), 0), 100),
    confidence: one.confidence,
    firm: one.confidence >= 0.5
  }));
}
function howSure(confidence) {
  if (!confidence || !Number.isFinite(confidence.events) || confidence.events <= 0) {
    return "Orbis has not counted any listening yet, so there is nothing here to show.";
  }
  if (!confidence.ready) return `From ${confidence.events} ${confidence.events === 1 ? "play" : "plays"}. Still early, so treat these loosely.`;
  return `From ${confidence.events} plays.`;
}
function measuringWords(measurement) {
  if (!measurement || !Number.isFinite(measurement.total) || measurement.total <= 0) return null;
  const left = measurement.total - measurement.unmeasurable - measurement.measured;
  if (left <= 0) return null;
  return measurement.working ? `Listening to ${left} more ${left === 1 ? "song" : "songs"} to work out how they sound.` : `${left} ${left === 1 ? "song has" : "songs have"} not been listened to yet, so they are not in these figures.`;
}

// extension-src/music/screens/discover.ts
function corners(what, items) {
  const left = items.filter((one) => one.total > one.played).sort((a, b) => b.total - b.played - (a.total - a.played));
  if (left.length === 0) return el("p", { cls: "om-side-says", text: `You have played something from every ${what} in your music.` });
  return el(
    "ul",
    { cls: "om-own-tallies" },
    left.slice(0, 8).map(
      (one) => el("li", { cls: "om-own-tally" }, [
        el("span", { cls: "om-own-tally-name", text: String(one.name) }),
        el("span", { cls: "om-own-tally-rail", attrs: { "aria-hidden": "true" } }, [
          el("span", { cls: "om-own-tally-fill", style: { "--om-own-fill": `${one.total > 0 ? Math.round(one.played / one.total * 100) : 0}%` } })
        ]),
        el("span", { cls: "om-own-tally-count", text: `${one.played} of ${one.total} played` })
      ])
    )
  );
}
registerScreen({
  screen: "discover",
  title: () => "Discover",
  mount: (place2) => {
    const djPlace = el("div", { cls: "om-own-slot" });
    const waysPlace = el("div", { cls: "om-own-slot" }, [reading("ways to explore")]);
    const askPlace = el("div", { cls: "om-own-slot" });
    const whyPlace = el("div", { cls: "om-own-slot" });
    const tastePlace = el("div", { cls: "om-own-slot" }, [reading("taste")]);
    const cornersPlace = el("div", { cls: "om-own-slot" }, [reading("music")]);
    const sittingPlace = el("div", { cls: "om-own-slot" }, [reading("sitting")]);
    let playingId = null;
    let said = "";
    function drawDj() {
      fill(
        djPlace,
        card("om-own-dj", [
          el("div", { cls: "om-own-row-words" }, [
            el("span", { cls: "om-own-row-label", text: "The DJ keeps the music going" }),
            el("span", {
              cls: "om-own-row-detail",
              text: "It plans a few songs ahead and refills as they play, from your own music. Orbis does not keep whether it is on, so neither button is shown as the one in use."
            })
          ]),
          el("div", { cls: "om-own-acts" }, [
            press("Start the DJ", () => void doAndSay(setDj(true)), "primary", "dj"),
            press("Stop the DJ", () => void doAndSay(setDj(false)), "quiet"),
            press(
              playingId ? "Station from this song" : "Station from your taste",
              () => void doAndSay(station(playingId ?? void 0)),
              "normal",
              "compass"
            )
          ])
        ])
      );
    }
    async function drawWays() {
      const answer = await explorations();
      const got = unwrap(answer, "ways to explore");
      if ("problem" in got) {
        fill(waysPlace, got.problem);
        return;
      }
      const ways = got.value;
      if (ways.length === 0) {
        fill(waysPlace, nothingYet("ways to explore"));
        return;
      }
      fill(
        waysPlace,
        el(
          "div",
          { cls: "om-own-tiles" },
          ways.map(
            (way) => el("button", { cls: "om-own-tile", attrs: { type: "button" }, on: { click: () => void start2(way.id) } }, [
              el("span", { cls: "om-own-tile-label", text: way.label }),
              el("span", { cls: "om-own-tile-blurb", text: way.blurb })
            ])
          )
        )
      );
    }
    async function start2(id) {
      const answer = await explore(id);
      if (!answer.got) {
        place2.note(answer.why);
        return;
      }
      const said_ = answer.value;
      if (said_.ok === false) {
        place2.note(said_.why ?? "Orbis could not do that.");
        return;
      }
      const because = (said_.because ?? []).filter((one) => typeof one === "string");
      place2.note(because.length > 0 ? `${said_.label ?? "Playing"}: ${because.join(", ")}` : said_.label ?? "Playing.");
      place2.refresh();
    }
    function drawAsk() {
      const box = el("input", {
        cls: "om-own-input",
        attrs: { type: "search", placeholder: "Something calm I have not heard", "aria-label": "What do you feel like?", value: said, maxlength: "300" }
      });
      box.addEventListener("input", () => {
        said = box.value;
      });
      const send = async () => {
        const answer = await askFor(box.value);
        if (!answer.got) {
          place2.note(answer.why);
          return;
        }
        const read2 = answer.value;
        const missed = (read2?.notUnderstood ?? []).filter((one) => typeof one === "string");
        place2.note(
          missed.length > 0 ? `Orbis could not read: ${missed.join(", ")}` : read2?.intent?.intent ? `Read as ${String(read2.intent.intent).replace(/-/g, " ")}. It will choose that way from now on.` : "Orbis has taken that into account."
        );
      };
      box.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void send();
      });
      fill(
        askPlace,
        card("", [
          el("div", { cls: "om-own-asker" }, [box, press("Tell Orbis", () => void send(), "primary")]),
          el("div", { cls: "om-own-acts" }, [press("Forget what I asked for", () => void doAndSay(run("clear-request")), "quiet")]),
          choices({
            label: "How adventurous",
            detail: "Orbis keeps this as numbers rather than as a name, so none of these is shown as the one in use.",
            items: DISCOVERY_LEVELS.map((one) => ({ id: one.id, label: one.label, blurb: one.blurb })),
            chosen: null,
            onPick: (id) => void doAndSay(setDiscovery(id))
          })
        ])
      );
    }
    async function drawWhy2() {
      if (!playingId) {
        fill(whyPlace, el("p", { cls: "om-side-says", text: "Play something and Orbis will say why it chose it." }));
        return;
      }
      const answer = await whyThis(playingId);
      const got = unwrap(answer, "reasons");
      if ("problem" in got) {
        fill(whyPlace, got.problem);
        return;
      }
      const why = got.value;
      const because = (why?.because ?? []).slice(0, 6);
      if (because.length === 0) {
        fill(whyPlace, el("p", { cls: "om-side-says", text: "Orbis has no reasons for this one: you chose it yourself, or it has not measured enough yet." }));
        return;
      }
      fill(
        whyPlace,
        el(
          "ul",
          { cls: "om-own-whys" },
          because.map(
            (one) => el("li", { cls: "om-own-why" }, [
              el("span", { cls: "om-own-why-name", text: one.name ? `${one.dimension}: ${one.name}` : one.dimension }),
              el("span", { cls: "om-own-why-value", text: one.value > 0 ? "you like this" : "you avoid this" })
            ])
          )
        )
      );
    }
    async function drawTaste() {
      const answer = await taste();
      const got = unwrap(answer, "taste");
      if ("problem" in got) {
        fill(tastePlace, got.problem);
        return;
      }
      const dna = got.value;
      const bars = tasteBars(dna.readings ?? []);
      const measuring = measuringWords(dna.measurement);
      fill(
        tastePlace,
        el("p", { cls: "om-own-block-detail", text: howSure(dna.confidence) }),
        bars.length === 0 ? nothingYet("readings yet", "Play a few things and Orbis will have something to show here. It measures rather than asks.") : el("div", { cls: "om-own-readings" }, bars.map((one) => readingBar(one.name, one.value, one.firm))),
        (dna.topArtists ?? []).length > 0 ? el("p", { cls: "om-own-row-detail", text: `Most of your listening: ${dna.topArtists.slice(0, 5).join(", ")}` }) : null,
        (dna.topGenres ?? []).length > 0 ? el("p", { cls: "om-own-row-detail", text: `Mostly ${dna.topGenres.slice(0, 4).join(", ")}` }) : null,
        measuring ? el("p", { cls: "om-own-warn", text: measuring }) : null,
        el(
          "div",
          { cls: "om-own-acts" },
          // Asked first, in the words of what each one actually throws away, because none of this can be got back.
          FORGET_SCOPES.map(
            (scope) => carefulPress(`Forget: ${scope.label.toLowerCase()}`, `${scope.blurb} Press again.`, () => {
              void doAndSay(forgetLearning(scope.id));
            })
          )
        )
      );
    }
    async function drawCorners() {
      const answer = await unexplored();
      const got = unwrap(answer, "music");
      if ("problem" in got) {
        fill(cornersPlace, got.problem);
        return;
      }
      const map = got.value ?? {};
      const genres2 = map.genres ?? [];
      const eras = map.eras ?? [];
      const languages = map.languages ?? [];
      if (genres2.length === 0 && eras.length === 0 && languages.length === 0) {
        fill(cornersPlace, nothingYet("music to count", "This is counted off your own library, so it fills in as you bring music in."));
        return;
      }
      fill(
        cornersPlace,
        el("div", { cls: "om-own-three" }, [
          el("div", {}, [el("h3", { cls: "om-own-sub", text: "Genres" }), corners("genre", genres2)]),
          el("div", {}, [el("h3", { cls: "om-own-sub", text: "Years" }), corners("year", eras)]),
          el("div", {}, [el("h3", { cls: "om-own-sub", text: "Languages" }), corners("language", languages)])
        ])
      );
    }
    async function drawSitting() {
      const answer = await run("session");
      const got = unwrap(answer, "sitting");
      if ("problem" in got) {
        fill(sittingPlace, got.problem);
        return;
      }
      const sitting = got.value?.session ?? null;
      const count = (name) => {
        const held4 = sitting?.[name];
        return typeof held4 === "number" ? held4 : 0;
      };
      const played = Array.isArray(sitting?.tracks) ? sitting.tracks.length : 0;
      if (!sitting || played === 0) {
        fill(sittingPlace, nothingYet("listening in this sitting", "A sitting starts when you play something and ends after three quarters of an hour of quiet."));
        return;
      }
      const offered = count("discoveryOffered");
      fill(
        sittingPlace,
        figures([
          figure(String(played), played === 1 ? "song this sitting" : "songs this sitting"),
          figure(String(count("completions")), "played through"),
          figure(String(count("skips")), "skipped"),
          figure(String(count("favourites")), "made favourites"),
          // Only when something was actually offered: nought out of nought is not a score.
          offered > 0 ? figure(`${count("discoveryAccepted")} of ${offered}`, "new songs kept on") : null
        ])
      );
    }
    async function loadAll() {
      await Promise.all([drawWays(), drawTaste(), drawCorners(), drawSitting(), drawWhy2()]);
    }
    fill(
      place2.into,
      screenHead("Discover", "Orbis chooses from the music you have, and tells you why. It never plays something it has only the name of."),
      block("Keep the music going", "A DJ that plans ahead, or a station from one song.", [djPlace]),
      block("Named ways to explore", "Six, fixed. Each one sets what the engine looks for and starts playing.", [waysPlace]),
      block("Say what you feel like", "In your own words. Orbis says which parts it could not read.", [askPlace]),
      block("Why this one", "The parts that really counted towards the score of what is playing.", [whyPlace]),
      block("What Orbis has worked out", "Measured from what you played, not from anything you were asked.", [tastePlace]),
      block("Corners of your music", "Counted off your own library: what you have and have not got round to.", [cornersPlace]),
      block("This sitting", "What has happened since you started listening.", [sittingPlace], press("Read again", () => void loadAll(), "quiet", "refresh"))
    );
    drawDj();
    drawAsk();
    void loadAll();
    return {
      onPlayer: (state2) => {
        const now2 = state2.music?.track?.id ?? null;
        if (now2 === playingId) return;
        playingId = now2;
        drawDj();
        void drawWhy2();
        void drawSitting();
      }
    };
  }
});

// extension-src/music/screens/genre.ts
registerScreen({
  screen: "genre",
  title: (route2) => route2.of || "Genre",
  mount: (place2) => mountGenre(place2)
});
function mountGenre(place2) {
  const head = el("div", { cls: "om-rec-head" });
  const list = el("ul", { cls: "om-rows", attrs: { "aria-label": "The songs in this genre" } });
  const body = el("div", { cls: "om-rec" }, [head, list]);
  fill(place2.into, body);
  let group = null;
  let playingId = null;
  const wanted = place2.route.of.trim();
  if (wanted === "") {
    fill(place2.into, says("That address does not name a genre", "Open a genre from Your music and the address will be right."));
    return {};
  }
  function drawRows() {
    if (!group) return;
    const facts = factsOf(group.tracks);
    fill(
      list,
      ...group.tracks.map((track) => {
        const row = trackRow(track, {
          playing: track.id === playingId,
          // Only the songs with audio go into the run. The service would quietly skip the rest, and a queue that
          // drops half of what was asked for without saying so is worse than one that was honest about its length.
          onPlay: () => {
            const at = facts.playableIds.indexOf(track.id);
            if (at < 0) {
              place2.note("Orbis has no audio for this song.");
              return;
            }
            void doAndSay(playAll(facts.playableIds, at));
          }
        });
        row.setAttribute("data-om-track", track.id);
        return row;
      })
    );
  }
  function drawHead() {
    if (!group) return;
    const facts = factsOf(group.tracks);
    const face = faceOf(group.tracks);
    const artists2 = new Set(group.tracks.map((one) => one.artist.trim()).filter((one) => one !== "")).size;
    const albums2 = albumsOf(group.tracks).length;
    const lines = [];
    if (artists2 > 0) lines.push(countText(artists2, "artist", "artists"));
    if (albums2 > 0) lines.push(countText(albums2, "album", "albums"));
    lines.push(countText(facts.tracks, "song", "songs"));
    if (facts.seconds !== null) lines.push(spanText(facts.seconds));
    fill(
      head,
      wash(face?.id),
      el("div", { cls: "om-rec-art" }, [face ? tile({ id: face.id, title: group.name, artist: face.artist }, { size: "xl" }) : null]),
      el("div", { cls: "om-rec-words" }, [
        el("p", { cls: "om-rec-kicker", text: "Genre" }),
        el("h1", { cls: "om-rec-title", text: group.name }),
        el("p", { cls: "om-rec-line", text: lines.join(" \xB7 ") }),
        // Said once at the top rather than left to be worked out by reading every row's pill.
        facts.playable === 0 ? el("p", { cls: "om-rec-note", text: "None of these songs has audio on this computer. Bring your own copies in to play them here." }) : facts.playable < facts.tracks ? el("p", { cls: "om-rec-note", text: `${countText(facts.playable, "song", "songs")} here can be played; the rest Orbis only knows by name.` }) : null,
        // There is no cover behind this that belongs to the genre, so the screen says whose cover it is instead of
        // letting it read as artwork somebody made for the genre.
        face ? el("p", { cls: "om-rec-note", text: `The picture is the cover of ${face.album.trim() || face.title}. Orbis has no artwork for a genre.` }) : null,
        el("div", { cls: "om-rec-buttons" }, [
          button(
            {
              cls: "om-btn om-btn-primary",
              attrs: { disabled: facts.playable === 0 },
              title: facts.playable === 0 ? "There is no audio here to play" : void 0,
              onClick: () => void doAndSay(playAll(facts.playableIds, 0))
            },
            [icon("play", 16), el("span", { text: "Play" })]
          ),
          button(
            {
              cls: "om-btn",
              attrs: { disabled: facts.playable < 2 },
              // Shuffle is a setting on the player rather than a way of starting something, so this turns it on and
              // then starts the genre. Read back afterwards like every other press, so the bar and this agree.
              onClick: async () => {
                await doAndSay(setShuffle(true));
                await doAndSay(playAll(facts.playableIds, 0));
              }
            },
            [icon("shuffle", 16), el("span", { text: "Shuffle" })]
          ),
          button(
            {
              cls: "om-btn",
              attrs: { disabled: facts.playable === 0 },
              onClick: () => void doAndSay(queueEnd(facts.playableIds))
            },
            [icon("plus", 16), el("span", { text: "Add to what is coming next" })]
          )
        ])
      ])
    );
    place2.wantCovers(group.tracks.map((one) => one.id));
  }
  async function load() {
    fill(place2.into, says(emptyWords("loading", "genres").title));
    const answer = await genres();
    if (!answer.got) {
      const words = emptyWords(answer.shut ? "unreachable" : "failed", "genres", answer.why);
      fill(place2.into, says(words.title, words.detail, { label: "Try again", onClick: () => void load() }));
      return;
    }
    const flat = (value2) => value2.trim().toLowerCase();
    const found = answer.value.find((one) => flat(one.name) === flat(wanted));
    if (!found) {
      fill(
        place2.into,
        says(`No genre called \u201C${wanted}\u201D in your music`, "Nothing in your library carries that genre. Open a genre from Your music to see the ones that are there.", {
          label: "Your music",
          onClick: () => place2.go("library")
        })
      );
      return;
    }
    group = found;
    fill(place2.into, body);
    drawHead();
    drawRows();
  }
  void load();
  return {
    onPlayer: (state2) => {
      const id = state2.music?.playback.trackId ?? null;
      if (id === playingId) return;
      playingId = id;
      for (const row of list.querySelectorAll("[data-om-track]")) {
        row.classList.toggle("om-row-now", row.getAttribute("data-om-track") === id);
      }
    },
    onCovers: () => {
      if (group) {
        drawHead();
        drawRows();
      }
    }
  };
}

// src/shared/music/home.ts
function greetingFor(hour) {
  if (!Number.isFinite(hour)) return "Your music";
  const whole = Math.floor(hour);
  if (whole >= 5 && whole < 12) return "Good morning";
  if (whole >= 12 && whole < 18) return "Good afternoon";
  if (whole >= 18 && whole < 23) return "Good evening";
  return "Still up";
}
function trackCard(track) {
  const playable = playableOffline(track);
  return {
    key: track.id,
    name: track.title || "No title",
    under: track.artist || "No artist named",
    coverTrackId: track.id,
    trackIds: playable ? [track.id] : [],
    ...playable ? {} : { why: whyNotPlayable(track) ?? "Orbis has no audio for this track." }
  };
}
var trackCards = (tracks, limit = 12) => tracks.slice(0, Math.max(0, limit)).map(trackCard);
var playableIn = (group) => group.tracks.filter((one) => playableOffline(one)).map((one) => one.id);
var newestIn = (group) => group.tracks.reduce((most, one) => one.addedAt > most ? one.addedAt : most, 0);
function albumCards(groups, limit = 12) {
  return [...groups].sort((a, b) => newestIn(b) - newestIn(a)).slice(0, Math.max(0, limit)).map((group) => {
    const ids = playableIn(group);
    const year = typeof group.year === "number" && group.year > 0 ? ` \xB7 ${group.year}` : "";
    return {
      key: `${group.name}|${group.by ?? ""}`,
      name: group.name,
      under: `${group.by ?? "Unknown artist"}${year}`,
      coverTrackId: group.tracks[0]?.id,
      trackIds: ids,
      ...ids.length === 0 ? { why: "There is no audio for this album on this computer." } : {}
    };
  });
}
function artistCards(groups, limit = 12) {
  return [...groups].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, Math.max(0, limit)).map((group) => {
    const ids = playableIn(group);
    return {
      key: group.name,
      name: group.name,
      under: countText(group.tracks.length, "song", "songs"),
      coverTrackId: group.tracks[0]?.id,
      trackIds: ids,
      round: true,
      ...ids.length === 0 ? { why: "There is no audio for this artist on this computer." } : {}
    };
  });
}
function noticedCards(songs, limit = 12) {
  return songs.slice(0, Math.max(0, limit)).map((song) => ({
    key: song.id,
    name: song.title || "No title",
    under: song.artist || song.provider || "No artist named",
    coverTrackId: song.trackId,
    trackIds: song.trackId ? [song.trackId] : [],
    ...song.trackId ? {} : { why: "Orbis knows this song by name. Bring in your own copy to play it here." }
  }));
}
function stationCards(stations) {
  return stations.map((one) => ({ key: one.id, name: one.label, under: one.blurb, trackIds: [], stationId: one.id }));
}
function homeShelves(parts) {
  const shelves = [];
  const recent = trackCards(parts.played);
  if (recent.length > 0) shelves.push({ kind: "recent", title: "Carry on where you were", cards: recent, more: "recent" });
  const stations = stationCards(parts.stations);
  if (stations.length > 0)
    shelves.push({
      kind: "stations",
      title: "Start something",
      detail: "Orbis works each of these out from your own music as it goes.",
      cards: stations,
      more: "discover"
    });
  const favourites = trackCards(parts.favourites);
  if (favourites.length > 0) shelves.push({ kind: "favourites", title: "Your favourites", cards: favourites, more: "liked" });
  const noticed2 = noticedCards(parts.noticed);
  if (noticed2.length > 0)
    shelves.push({
      kind: "noticed",
      title: "Noticed while browsing",
      detail: "Songs Orbis worked out from web pages. Knowing the name is not having the song.",
      cards: noticed2,
      more: "noticed"
    });
  const albums2 = albumCards(parts.albums);
  if (albums2.length > 1) shelves.push({ kind: "albums", title: "Albums in your music", cards: albums2, more: "library" });
  const artists2 = artistCards(parts.artists);
  if (artists2.length > 1) shelves.push({ kind: "artists", title: "Artists in your music", cards: artists2, more: "library" });
  return shelves;
}
function coverWants(shelves, limit = 60) {
  const wanted = [];
  const seen = /* @__PURE__ */ new Set();
  for (const shelf of shelves) {
    for (const card3 of shelf.cards) {
      const id = card3.coverTrackId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      wanted.push(id);
      if (wanted.length >= limit) return wanted;
    }
  }
  return wanted;
}
var libraryIsEmpty = (summary) => summary !== null && summary !== void 0 && summary.tracks === 0;
function haveWords(summary) {
  if (!summary) return null;
  const parts = [countText(summary.tracks, "song", "songs"), `${summary.offline} playable here`];
  if (summary.reference > 0) parts.push(`${summary.reference} saved by name`);
  return parts.join(" \xB7 ");
}

// extension-src/music/screens/home.ts
registerScreen({
  screen: "home",
  wants: { nowPlaying: "as-chosen" },
  mount: (place2) => start(place2)
});
function start(place2) {
  const held4 = { cards: /* @__PURE__ */ new Map(), shelves: [], marked: null, gone: false };
  const greeting = el("h1", { cls: "om-home-greeting", text: greetingFor((/* @__PURE__ */ new Date()).getHours()) });
  const have = el("p", { cls: "om-home-have" });
  const rows = el("div", { cls: "om-home-rows" });
  fill(
    place2.into,
    el("div", { cls: "om-home" }, [
      el("header", { cls: "om-home-head" }, [
        el("div", { cls: "om-home-words" }, [greeting, have]),
        button({ cls: "om-icon", title: "Read your music again", onClick: () => void load() }, [icon("refresh", 18)])
      ]),
      rows
    ])
  );
  async function load() {
    if (held4.gone) return;
    if (held4.shelves.length === 0) fill(rows, says("Reading your music\u2026"));
    const [played, stations, favourites, noticed2, albums2, artists2] = await Promise.all([
      playedLately(),
      explorations(),
      library({ favourite: true, sort: "added", descending: true }),
      noticed(),
      albums(),
      artists()
    ]);
    if (held4.gone) return;
    const parts = {
      played: played.got ? played.value : [],
      stations: stations.got ? stations.value : [],
      favourites: favourites.got ? favourites.value : [],
      noticed: noticed2.got ? noticed2.value : [],
      albums: albums2.got ? albums2.value : [],
      artists: artists2.got ? artists2.value : []
    };
    const answers = [played, stations, favourites, noticed2, albums2, artists2];
    const shut = answers.some((one) => !one.got && one.shut);
    const firstProblem = answers.find((one) => !one.got && !one.shut);
    held4.shelves = homeShelves(parts);
    draw(shut, firstProblem && !firstProblem.got ? firstProblem.why : null);
    place2.wantCovers(coverWants(held4.shelves));
  }
  function draw(shut, problem) {
    held4.cards.clear();
    held4.marked = null;
    const summary = current().music?.summary ?? null;
    have.textContent = haveWords(summary) ?? "";
    have.classList.toggle("om-on", have.textContent !== "");
    if (held4.shelves.length > 0) {
      fill(rows, ...held4.shelves.map(shelfNode));
      markPlaying(current());
      return;
    }
    if (libraryIsEmpty(summary)) {
      fill(rows, firstTime());
      return;
    }
    const words = emptyWords(shut ? "unreachable" : problem ? "failed" : "loading", "music", problem);
    fill(rows, says(words.title, words.detail, words.retry ? { label: "Try again", onClick: () => void load() } : void 0));
  }
  function firstTime() {
    return el("div", { cls: "om-home-first" }, [
      el("h2", { cls: "om-home-first-title", text: "There is no music here yet" }),
      el("p", {
        cls: "om-home-first-detail",
        text: "Add some files, or point Orbis at a folder and it keeps watching that folder for anything new."
      }),
      el("div", { cls: "om-home-first-do" }, [
        button({ cls: "om-btn om-btn-primary", onClick: () => void doAndSay(importFiles()) }, [icon("file", 16), el("span", { text: "Add songs" })]),
        button({ cls: "om-btn", onClick: () => void doAndSay(watchFolder()) }, [icon("folder", 16), el("span", { text: "Add a folder" })]),
        button({ cls: "om-btn om-btn-quiet", text: "More ways to bring music in", onClick: () => place2.go("bring-in") })
      ])
    ]);
  }
  function shelfNode(shelf) {
    const more = shelf.more;
    return el("section", { cls: `om-shelf om-shelf-${shelf.kind}` }, [
      el("div", { cls: "om-shelf-head" }, [
        el("div", { cls: "om-shelf-words" }, [
          el("h2", { cls: "om-shelf-title", text: shelf.title }),
          shelf.detail ? el("p", { cls: "om-shelf-detail", text: shelf.detail }) : null
        ]),
        more ? button({ cls: "om-btn om-btn-quiet", text: "See all", onClick: () => place2.go(more) }) : null
      ]),
      // One row that scrolls sideways rather than a grid that wraps: a row says "there is more of this that way",
      // where a wrapped grid of four says "this is all of it".
      el("div", { cls: "om-shelf-row", attrs: { role: "list" } }, shelf.cards.map((card3) => cardNode(card3, shelf)))
    ]);
  }
  function cardNode(card3, shelf) {
    const cover = el("div", { cls: "om-card-cover" });
    fill(cover, coverTile(card3), el("span", { cls: "om-card-play", attrs: { "aria-hidden": "true" } }, [icon("play", 18)]));
    const node = button(
      {
        cls: `om-card${card3.round ? " om-card-round" : ""}${card3.trackIds.length === 0 && !card3.stationId ? " om-card-off" : ""}`,
        title: cardTitle(card3),
        attrs: { role: "listitem" },
        onClick: () => void press2(card3)
      },
      [
        cover,
        el("span", { cls: "om-card-words" }, [
          el("span", { cls: "om-card-name", text: card3.name }),
          el("span", { cls: "om-card-under", text: card3.under })
        ]),
        // A card with nothing to play says why on the card itself. Hiding it behind a press is how somebody comes to
        // think their music is broken when in fact Orbis only ever had the name of that song.
        card3.why ? el("span", { cls: "om-pill om-pill-warn", text: shelf.kind === "noticed" ? "Name only" : "No audio here" }) : null
      ]
    );
    held4.cards.set(card3.key, { cover, node, card: card3 });
    return node;
  }
  const coverTile = (card3) => tile({ id: card3.coverTrackId, title: card3.name, artist: card3.under }, { size: "lg", round: card3.round });
  const cardTitle = (card3) => {
    if (card3.stationId) return `Start ${card3.name}`;
    if (card3.trackIds.length === 0) return card3.why ?? "There is nothing to play here";
    return `Play ${card3.name}`;
  };
  async function press2(card3) {
    if (card3.stationId) {
      const answer = await explore(card3.stationId);
      if (!answer.got) place2.note(answer.why);
      else if (answer.value.ok === false) place2.note(answer.value.why ?? "Orbis could not start that.");
      else {
        const because = (answer.value.because ?? []).slice(0, 2).join(" \xB7 ");
        place2.note([answer.value.label ?? card3.name, because].filter((one) => one).join(" \u2014 "));
      }
      place2.refresh();
      return;
    }
    if (card3.trackIds.length === 0) {
      place2.note(card3.why ?? "There is no audio for this on this computer.");
      return;
    }
    await doAndSay(playAll(card3.trackIds));
  }
  function markPlaying(state2) {
    const now2 = state2.music?.playback.owner === "orbis-music" ? state2.music.playback.trackId : null;
    if (now2 === held4.marked) return;
    for (const [, one] of held4.cards) {
      const on = now2 !== null && one.card.trackIds.length === 1 && one.card.trackIds[0] === now2;
      one.node.classList.toggle("om-card-now", on);
    }
    held4.marked = now2;
  }
  void load();
  return {
    onPlayer: (state2) => markPlaying(state2),
    onCovers: () => {
      for (const [, one] of held4.cards) {
        if (!one.card.coverTrackId || !coverFor(one.card.coverTrackId)) continue;
        const play2 = one.cover.querySelector(".om-card-play");
        fill(one.cover, coverTile(one.card), play2 ?? el("span", { cls: "om-card-play", attrs: { "aria-hidden": "true" } }, [icon("play", 18)]));
      }
      const summary = current().music?.summary ?? null;
      have.textContent = haveWords(summary) ?? "";
    },
    leave: () => {
      held4.gone = true;
      held4.cards.clear();
    }
  };
}

// extension-src/music/screens/liked.ts
registerScreen({
  screen: "liked",
  title: () => "Favourites",
  mount: (place2) => mountLiked(place2)
});
function mountLiked(place2) {
  const head = el("div", { cls: "om-rec-head om-rec-head-alone" });
  const list = el("ul", { cls: "om-rows", attrs: { "aria-label": "Your favourite songs" } });
  const body = el("div", { cls: "om-rec" }, [head, list]);
  let tracks = null;
  let playingId = null;
  let knownCount = null;
  let reading2 = false;
  function drawHead() {
    if (!tracks) return;
    const facts = factsOf(tracks);
    const lines = [countText(facts.tracks, "song", "songs")];
    if (facts.seconds !== null) lines.push(spanText(facts.seconds));
    fill(
      head,
      el("div", { cls: "om-rec-words" }, [
        el("p", { cls: "om-rec-kicker", text: "Your music" }),
        el("h1", { cls: "om-rec-title", text: "Favourites" }),
        el("p", { cls: "om-rec-line", text: lines.join(" \xB7 ") }),
        facts.playable === 0 ? el("p", { cls: "om-rec-note", text: "None of your favourites has audio on this computer. Bring your own copies in to play them here." }) : facts.playable < facts.tracks ? el("p", { cls: "om-rec-note", text: `${countText(facts.playable, "favourite", "favourites")} can be played; the rest Orbis only knows by name.` }) : null,
        el("div", { cls: "om-rec-buttons" }, [
          button(
            {
              cls: "om-btn om-btn-primary",
              attrs: { disabled: facts.playable === 0 },
              title: facts.playable === 0 ? "There is no audio here to play" : void 0,
              onClick: () => void doAndSay(playAll(facts.playableIds, 0))
            },
            [icon("play", 16), el("span", { text: "Play" })]
          ),
          button(
            {
              cls: "om-btn",
              attrs: { disabled: facts.playable < 2 },
              onClick: async () => {
                await doAndSay(setShuffle(true));
                await doAndSay(playAll(facts.playableIds, 0));
              }
            },
            [icon("shuffle", 16), el("span", { text: "Shuffle" })]
          ),
          button(
            {
              cls: "om-btn",
              attrs: { disabled: facts.playable === 0 },
              onClick: () => void doAndSay(queueEnd(facts.playableIds))
            },
            [icon("plus", 16), el("span", { text: "Add to what is coming next" })]
          ),
          // A favourites list is the obvious thing to keep as a playlist, and every piece of that already exists:
          // the ids are in hand and the service makes a playlist from a list of ids.
          button(
            {
              cls: "om-btn om-btn-quiet",
              attrs: { disabled: facts.tracks === 0 },
              onClick: () => void doAndSay(createPlaylist("Favourites", tracks ? tracks.map((one) => one.id) : []))
            },
            [icon("list", 16), el("span", { text: "Keep as a playlist" })]
          )
        ])
      ])
    );
  }
  function drawRows() {
    if (!tracks) return;
    const facts = factsOf(tracks);
    fill(
      list,
      ...tracks.map((track) => {
        const row = trackRow(track, {
          playing: track.id === playingId,
          onPlay: () => {
            const at = facts.playableIds.indexOf(track.id);
            if (at < 0) {
              place2.note("Orbis has no audio for this song.");
              return;
            }
            void doAndSay(playAll(facts.playableIds, at));
          }
        });
        row.setAttribute("data-om-track", track.id);
        return row;
      })
    );
    place2.wantCovers(tracks.map((one) => one.id));
  }
  async function load() {
    if (reading2) return;
    reading2 = true;
    if (!tracks) fill(place2.into, says(emptyWords("loading", "favourites").title));
    const answer = await library({ favourite: true });
    reading2 = false;
    if (!answer.got) {
      if (tracks) {
        place2.note(answer.why);
        return;
      }
      const words = emptyWords(answer.shut ? "unreachable" : "failed", "favourites", answer.why);
      fill(place2.into, says(words.title, words.detail, { label: "Try again", onClick: () => void load() }));
      return;
    }
    tracks = answer.value;
    knownCount = answer.value.length;
    if (answer.value.length === 0) {
      fill(
        place2.into,
        says("No favourites yet", "Press the heart on any song and it turns up here. Nothing else puts a song in this list.", {
          label: "Your music",
          onClick: () => place2.go("library")
        })
      );
      return;
    }
    fill(place2.into, body);
    drawHead();
    drawRows();
  }
  void load();
  return {
    onPlayer: (state2) => {
      const count = state2.music?.summary.favourites ?? null;
      if (count !== null && knownCount !== null && count !== knownCount) {
        knownCount = count;
        void load();
      }
      const id = state2.music?.playback.trackId ?? null;
      if (id === playingId) return;
      playingId = id;
      for (const row of list.querySelectorAll(".om-row")) row.classList.toggle("om-row-now", row.getAttribute("data-om-track") === id);
    },
    onCovers: () => {
      if (tracks) drawRows();
    }
  };
}

// extension-src/music/screens/listening.ts
function tallyRow(one, most) {
  return el("li", { cls: "om-own-tally" }, [
    el("span", { cls: "om-own-tally-name", text: one.name }),
    el("span", { cls: "om-own-tally-rail", attrs: { "aria-hidden": "true" } }, [
      el("span", { cls: "om-own-tally-fill", style: { "--om-own-fill": `${most > 0 ? Math.round(one.plays / most * 100) : 0}%` } })
    ]),
    el("span", {
      cls: "om-own-tally-count",
      text: countText(one.plays, "play", "plays"),
      title: `${countText(one.plays, "play", "plays")} across ${countText(one.songs, "song", "songs")}`
    })
  ]);
}
function dated(row, words) {
  row.classList.add("om-own-dated");
  row.append(el("span", { cls: "om-own-when", text: words }));
  return row;
}
function tallyList(what, items) {
  if (items.length === 0) return el("p", { cls: "om-side-says", text: `Nothing has been played with a ${what} on it yet.` });
  const most = items[0]?.plays ?? 0;
  return el("ul", { cls: "om-own-tallies" }, items.map((one) => tallyRow(one, most)));
}
registerScreen({
  screen: "recent",
  title: () => "Your listening",
  mount: (place2) => {
    const head = screenHead("Your listening", "Counted, not guessed. A play goes down only when enough of the song has really gone by.");
    const figuresPlace = el("div", { cls: "om-own-slot" }, [reading("listening")]);
    const mostPlace = el("div", { cls: "om-own-slot" }, [reading("listening")]);
    const namesPlace = el("div", { cls: "om-own-slot" }, [reading("listening")]);
    const latelyPlace = el("div", { cls: "om-own-slot" }, [reading("listening")]);
    let playingId = null;
    let lately = [];
    const drawLately = () => {
      fill(
        latelyPlace,
        lately.length === 0 ? nothingYet("songs played yet", "Play something through Orbis Music and it turns up here.") : el(
          "ul",
          { cls: "om-rows" },
          lately.map(
            (track) => dated(trackRow(track, { playing: track.id === playingId }), typeof track.lastPlayedAt === "number" ? whenWords(track.lastPlayedAt, Date.now()) : "")
          )
        )
      );
      place2.wantCovers(lately.slice(0, 40).map((one) => one.id));
    };
    async function load() {
      const [all, played] = await Promise.all([library({ sort: "plays", descending: true }), playedLately()]);
      const got = unwrap(all, "listening");
      if ("problem" in got) {
        fill(figuresPlace, got.problem);
        fill(mostPlace, el("p", { cls: "om-side-says", text: "The figures need your music, and Orbis could not read it just now." }));
        fill(namesPlace);
        return;
      }
      const library2 = got.value;
      const summary = listeningSummary(library2);
      fill(
        figuresPlace,
        summary.totalPlays === 0 ? nothingYet("plays counted yet", "Orbis counts a song once enough of it has gone by, so a quick skip does not count.") : figures([
          figure(String(summary.totalPlays), summary.totalPlays === 1 ? "play counted" : "plays counted"),
          figure(String(summary.songsPlayed), summary.songsPlayed === 1 ? "song played" : "different songs"),
          figure(String(summary.neverPlayed), "never played"),
          // Only when there is one. A figure Orbis does not have is left out rather than drawn as a dash in a box.
          summary.lastAt === null ? null : figure(whenWords(summary.lastAt, Date.now()), "last play")
        ])
      );
      const most = topSongs(library2, 10);
      fill(
        mostPlace,
        most.length === 0 ? el("p", { cls: "om-side-says", text: "Nothing has been played enough to count yet." }) : el(
          "ul",
          { cls: "om-rows" },
          most.map(
            (track) => dated(
              trackRow(track, {
                playing: track.id === playingId,
                onPlay: () => void doAndSay(
                  playAll(
                    most.map((one) => one.id),
                    most.indexOf(track)
                  )
                )
              }),
              countText(track.playCount ?? 0, "play", "plays")
            )
          )
        )
      );
      place2.wantCovers(most.map((one) => one.id));
      fill(
        namesPlace,
        el("div", { cls: "om-own-three" }, [
          el("div", {}, [el("h3", { cls: "om-own-sub", text: "Artists" }), tallyList("artist", topArtists(library2))]),
          el("div", {}, [el("h3", { cls: "om-own-sub", text: "Albums" }), tallyList("album", topAlbums(library2))]),
          el("div", {}, [el("h3", { cls: "om-own-sub", text: "Genres" }), tallyList("genre", topGenres(library2))])
        ])
      );
      const recent = unwrap(played, "listening");
      if ("problem" in recent) fill(latelyPlace, recent.problem);
      else {
        lately = recent.value;
        drawLately();
      }
    }
    fill(
      place2.into,
      head,
      block("The count", "What Orbis has written down.", [figuresPlace]),
      block("Played most", "Your own play counts, highest first.", [mostPlace]),
      block("Where those plays went", "Added up from the same counts.", [namesPlace]),
      block("Played lately", "Newest first, one row per song.", [latelyPlace], press("Read again", () => void load(), "quiet", "refresh"))
    );
    void load();
    return {
      onPlayer: (state2) => {
        const now2 = state2.music?.track?.id ?? null;
        if (now2 === playingId) return;
        playingId = now2;
        if (lately.length > 0) drawLately();
      },
      onCovers: drawLately
    };
  }
});

// src/shared/music/libraryShelf.ts
var LIBRARY_VIEWS = Object.freeze([
  { view: "songs", label: "Songs" },
  { view: "albums", label: "Albums" },
  { view: "artists", label: "Artists" },
  { view: "genres", label: "Genres" },
  { view: "playlists", label: "Playlists" }
]);
var libraryView = (value2) => LIBRARY_VIEWS.some((one) => one.view === value2) ? value2 : "songs";
var LIBRARY_KEEPS = Object.freeze([
  { keep: "all", label: "Everything", detail: "Every song in your library." },
  { keep: "favourites", label: "Favourites", detail: "The songs you have marked with a heart." },
  { keep: "here", label: "On this computer", detail: "Songs Orbis has the audio for and can play." },
  { keep: "reference", label: "Only a reference", detail: "Songs Orbis knows by name with no audio on this computer." },
  { keep: "missing", label: "File missing", detail: "Songs whose file is not where it was." }
]);
function keepsTrack(track, keep2) {
  switch (keep2) {
    case "favourites":
      return track.favourite === true;
    case "here":
      return track.availability === "local" && typeof track.file === "string" && track.file.length > 0;
    case "reference":
      return track.availability === "reference";
    case "missing":
      return track.availability === "missing";
    default:
      return true;
  }
}
var keepTracks = (tracks, keep2) => keep2 === "all" ? [...tracks] : tracks.filter((one) => keepsTrack(one, keep2));
function libraryCounts(tracks) {
  let here = 0;
  let reference = 0;
  let missing = 0;
  let favourites = 0;
  for (const track of tracks) {
    if (keepsTrack(track, "here")) here += 1;
    if (track.availability === "reference") reference += 1;
    if (track.availability === "missing") missing += 1;
    if (track.favourite === true) favourites += 1;
  }
  return { all: tracks.length, here, reference, missing, favourites };
}
function countForKeep(counts, keep2) {
  switch (keep2) {
    case "favourites":
      return counts.favourites;
    case "here":
      return counts.here;
    case "reference":
      return counts.reference;
    case "missing":
      return counts.missing;
    default:
      return counts.all;
  }
}
var LIBRARY_SORTS = Object.freeze([
  { sort: "added", label: "Recently added", downFirst: true },
  { sort: "title", label: "Title", downFirst: false },
  { sort: "artist", label: "Artist", downFirst: false },
  { sort: "album", label: "Album", downFirst: false },
  { sort: "duration", label: "Length", downFirst: false },
  { sort: "plays", label: "Play count", downFirst: true }
]);
var librarySort = (value2) => LIBRARY_SORTS.some((one) => one.sort === value2) ? value2 : "added";
var sortStartsDown = (sort2) => LIBRARY_SORTS.find((one) => one.sort === sort2)?.downFirst === true;
function latest(group, field) {
  let best = 0;
  for (const track of group.tracks) {
    const at = field === "addedAt" ? track.addedAt : track.lastPlayedAt ?? 0;
    if (typeof at === "number" && Number.isFinite(at) && at > best) best = at;
  }
  return best;
}
function groupSeconds(group) {
  let seconds = 0;
  let unknown = 0;
  for (const track of group.tracks) {
    if (Number.isFinite(track.duration) && track.duration > 0) seconds += track.duration;
    else unknown += 1;
  }
  return { seconds, unknown };
}
var groupPlays = (group) => group.tracks.reduce((total, one) => total + (one.playCount ?? 0), 0);
function sortGroups(groups, sort2, descending2) {
  const words = (one) => one.name.toLowerCase();
  const by = (one) => (one.by ?? one.name).toLowerCase();
  const sorted = [...groups].sort((a, b) => {
    switch (sort2) {
      case "artist":
        return by(a) < by(b) ? -1 : by(a) > by(b) ? 1 : words(a) < words(b) ? -1 : words(a) > words(b) ? 1 : 0;
      case "duration":
        return groupSeconds(a).seconds - groupSeconds(b).seconds;
      case "plays":
        return groupPlays(a) - groupPlays(b);
      case "added":
        return latest(a, "addedAt") - latest(b, "addedAt");
      case "played":
        return latest(a, "lastPlayedAt") - latest(b, "lastPlayedAt");
      case "year":
        return (a.year ?? 0) - (b.year ?? 0);
      default:
        return words(a) < words(b) ? -1 : words(a) > words(b) ? 1 : 0;
    }
  });
  return descending2 ? sorted.reverse() : sorted;
}
function keepGroups(groups, keep2) {
  if (keep2 === "all") return [...groups];
  const left = [];
  for (const group of groups) {
    const tracks = group.tracks.filter((one) => keepsTrack(one, keep2));
    if (tracks.length > 0) left.push({ ...group, tracks });
  }
  return left;
}
function findGroups(groups, said) {
  const words = said.toLowerCase().split(/[^a-z0-9]+/i).filter((one) => one);
  if (words.length === 0) return [...groups];
  return groups.filter((group) => {
    const flat = `${group.name} ${group.by ?? ""}`.toLowerCase();
    return words.every((word) => flat.includes(word));
  });
}
var MONTHS2 = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
function dateAddedText(at) {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return "\u2014";
  const when = new Date(at);
  const month = MONTHS2[when.getMonth()];
  if (!month) return "\u2014";
  return `${when.getDate()} ${month} ${when.getFullYear()}`;
}
var playsText = (count) => typeof count === "number" && Number.isFinite(count) && count > 0 ? `${count} ${count === 1 ? "play" : "plays"}` : "";
function availabilityPill(track) {
  if (keepsTrack(track, "here")) return null;
  switch (track.availability) {
    case "reference":
      return "No audio here";
    case "missing":
      return "File missing";
    case "unsupported":
      return "Cannot be played";
    default:
      return "No audio here";
  }
}
function groupSub(group, view) {
  const songs = `${group.tracks.length} ${group.tracks.length === 1 ? "song" : "songs"}`;
  if (view === "albums") {
    return [group.by, group.year ? String(group.year) : "", songs].filter((one) => one).join(" \xB7 ");
  }
  if (view === "artists") {
    const albums2 = new Set(group.tracks.map((one) => one.album.trim().toLowerCase()).filter((one) => one));
    return albums2.size > 0 ? `${songs} \xB7 ${albums2.size} ${albums2.size === 1 ? "album" : "albums"}` : songs;
  }
  return songs;
}
var playableIds = (tracks) => tracks.filter((one) => keepsTrack(one, "here")).map((one) => one.id);
var ROW_BLOCK = 120;
var shownRows = (total, blocks, block2 = ROW_BLOCK) => Math.max(0, Math.min(Math.floor(Math.max(0, total)), Math.max(1, Math.floor(blocks)) * block2));
var nearEnd = (scrollTop, viewport, height, margin = 400) => scrollTop + viewport + margin >= height;
var storedFor = (view, keep2) => view === "songs" && keep2 === "favourites" ? "favourites" : view;
function fromStored(stored) {
  if (stored === "favourites") return { view: "songs", keep: "favourites" };
  return { view: libraryView(stored), keep: "all" };
}

// extension-src/music/screens/library.ts
var layout = "grid";
var sort = "added";
var descending = true;
var keep = "all";
var readStored = false;
function artHolder(holders, of, size, round = false) {
  const node = el("span", { cls: "oml-art" }, [tile(of, { size, round })]);
  holders.push({ node, of, size, round });
  return node;
}
function songRow(track, at, all, playing, holders, place2) {
  const playable = playableOffline(track);
  const why = whyNotPlayable(track);
  const pill = availabilityPill(track);
  const row = el("li", {
    cls: `oml-tr${playing ? " oml-tr-now" : ""}${playable ? "" : " oml-tr-off"}`,
    attrs: { role: "row" }
  });
  const number = button(
    {
      cls: "oml-num",
      title: playable ? `Play ${track.title}` : why ?? "This cannot be played",
      onClick: () => {
        if (!playable) {
          note(why ?? "Orbis has no audio for this track.");
          return;
        }
        const startAt = all.indexOf(track.id);
        void doAndSay(playAll(all, startAt < 0 ? 0 : startAt));
      }
    },
    [el("span", { cls: "oml-num-n", text: String(at + 1) }), el("span", { cls: "oml-num-play" }, [icon("play", 14)])]
  );
  row.append(
    el("span", { cls: "oml-numcell", attrs: { role: "cell" } }, [number]),
    el("span", { cls: "oml-cell oml-cell-title", attrs: { role: "cell" } }, [
      artHolder(holders, { id: track.id, title: track.title, artist: track.artist, album: track.album }, "md"),
      el("span", { cls: "oml-words" }, [
        el("span", { cls: "oml-title", text: track.title || "No title", title: track.title || "No title" }),
        el("span", { cls: "oml-under" }, [
          pill ? el("span", { cls: "om-pill om-pill-warn", text: pill, title: why ?? "" }) : null,
          el("span", { cls: "oml-plays", text: playsText(track.playCount) })
        ])
      ])
    ]),
    // The artist and the album are both buttons: this is the screen somebody browses from, and reading an artist's
    // name without being able to press it is the thing that makes a library feel like a spreadsheet.
    el("span", { cls: "oml-cell oml-cell-artist", attrs: { role: "cell" } }, [
      track.artist ? button({ cls: "oml-link", text: track.artist, title: `Everything by ${track.artist}`, onClick: () => place2.go("artist", track.artist) }) : el("span", { cls: "oml-faint", text: "No artist named" })
    ]),
    el("span", { cls: "oml-cell oml-cell-album", attrs: { role: "cell" } }, [
      track.album ? button({ cls: "oml-link", text: track.album, title: `The record ${track.album}`, onClick: () => place2.go("album", track.album) }) : el("span", { cls: "oml-faint", text: "No album named" })
    ]),
    el("span", { cls: "oml-cell oml-cell-added", text: dateAddedText(track.addedAt), attrs: { role: "cell" } }),
    el("span", { cls: "oml-cell oml-cell-length", text: clockText(track.duration), attrs: { role: "cell" } }),
    el("span", { cls: "oml-cell oml-cell-do", attrs: { role: "cell" } }, [
      button(
        {
          cls: `om-icon om-icon-sm${track.favourite ? " om-on" : ""}`,
          title: track.favourite ? `Take ${track.title} out of favourites` : `Add ${track.title} to favourites`,
          attrs: { "aria-pressed": track.favourite === true ? "true" : "false" },
          onClick: () => void doAndSay(setFavourite(track.id, track.favourite !== true))
        },
        [icon("heart", 15)]
      ),
      button(
        {
          cls: "om-icon om-icon-sm",
          title: playable ? `Play ${track.title} next` : why ?? "This cannot be played",
          onClick: () => {
            if (!playable) {
              note(why ?? "Orbis has no audio for this track.");
              return;
            }
            void doAndSay(queueNext([track.id]));
          }
        },
        [icon("plus", 15)]
      )
    ])
  );
  return row;
}
function tableHead(redraw) {
  const column = (label, cls, by) => {
    if (!by) return el("span", { cls: `oml-th ${cls}`, text: label, attrs: { role: "columnheader" } });
    const on = sort === by;
    return button(
      {
        cls: `oml-th oml-th-do ${cls}${on ? " om-on" : ""}`,
        title: on ? `${wayWords(by, descending)} \u2014 press to turn it round` : `Order by ${label.toLowerCase()}`,
        // `aria-sort` belongs on the heading itself rather than on the button inside it, so the heading is the
        // button: that is what lets a screen reader say which column the list is ordered by and which way round.
        attrs: { role: "columnheader", "aria-sort": on ? descending ? "descending" : "ascending" : "none" },
        onClick: () => {
          if (on) descending = !descending;
          else {
            sort = by;
            descending = sortStartsDown(by);
          }
          void keepPreference();
          redraw();
        }
      },
      [el("span", { text: label }), on ? el("span", { cls: "oml-th-way", text: descending ? "\u2193" : "\u2191" }) : null]
    );
  };
  return el("li", { cls: "oml-tr oml-tr-head", attrs: { role: "row" } }, [
    el("span", { cls: "oml-th oml-numh", text: "#", attrs: { role: "columnheader" } }),
    column("Title", "oml-cell-title", "title"),
    column("Artist", "oml-cell-artist", "artist"),
    column("Album", "oml-cell-album", "album"),
    column("Added", "oml-cell-added", "added"),
    column("Length", "oml-cell-length", "duration"),
    el("span", { cls: "oml-th oml-cell-do", text: "", attrs: { role: "columnheader", "aria-label": "What you can do with it" } })
  ]);
}
function card2(of, holders) {
  const node = el("div", { cls: `oml-card${of.round ? " oml-card-round" : ""}` });
  node.append(
    button({ cls: "oml-card-open", title: of.title, onClick: of.open }, [
      el("span", { cls: "oml-card-art" }, [artHolder(holders, of.cover, "xl", of.round === true)]),
      el("span", { cls: "oml-card-name", text: of.name, title: of.name }),
      el("span", { cls: "oml-card-sub", text: of.sub })
    ])
  );
  if (of.play) node.append(button({ cls: "oml-card-play", title: `Play ${of.name}`, onClick: of.play }, [icon("play", 18)]));
  return node;
}
function groupRow(of, holders) {
  return el("li", { cls: "oml-grow" }, [
    button({ cls: "oml-grow-open", title: of.title, onClick: of.open }, [
      artHolder(holders, of.cover, "md", of.round === true),
      el("span", { cls: "oml-words" }, [el("span", { cls: "oml-title", text: of.name }), el("span", { cls: "oml-sub", text: of.sub })])
    ]),
    of.play ? button({ cls: "om-icon om-icon-sm", title: `Play ${of.name}`, onClick: of.play }, [icon("play", 15)]) : el("span")
  ]);
}
async function keepPreference(view) {
  const stored = storedFor(view ?? currentView, keep);
  await saveSettings({ view: stored, sort });
}
function wayWords(sort2, down) {
  switch (sort2) {
    case "added":
      return down ? "Newest first" : "Oldest first";
    case "duration":
      return down ? "Longest first" : "Shortest first";
    case "plays":
      return down ? "Most played first" : "Least played first";
    default:
      return down ? "Z to A" : "A to Z";
  }
}
var currentView = "songs";
registerScreen({
  screen: "library",
  title: (route2) => {
    const view = libraryView(route2.of);
    const entry = LIBRARY_VIEWS.find((one) => one.view === view);
    return entry && view !== "songs" ? `${entry.label} \u2014 Your music` : "Your music";
  },
  wants: { nowPlaying: "as-chosen" },
  mount: (place2) => {
    const view = libraryView(place2.route.of);
    currentView = view;
    let said = place2.route.said;
    let holders = [];
    let blocks = 1;
    let tracks = null;
    let groups = null;
    let playlists2 = null;
    let problem = null;
    let shut = false;
    let typing = null;
    let gone = false;
    let playingId = null;
    const body = el("div", { cls: "oml-body" });
    const headBox = el("div", { cls: "oml-headbox" });
    const redrawHead = () => fill(headBox, head());
    const chipRow = el("div", { cls: "oml-chips", attrs: { role: "group", "aria-label": "Which songs to show" } });
    const count = el("p", { cls: "oml-count" });
    const search = el("input", {
      cls: "oml-search",
      attrs: { type: "search", value: said, placeholder: view === "songs" ? "Search your songs" : `Search your ${view}`, "aria-label": "Search your music" }
    });
    function failed(why, isShut) {
      problem = why;
      shut = isShut;
      if (tracks !== null || groups !== null || playlists2 !== null) note(why);
    }
    async function load() {
      if (view === "songs") {
        const answer = await library({ search: said, sort, descending });
        if (gone) return;
        if (!answer.got) failed(answer.why, answer.shut);
        else {
          tracks = answer.value;
          problem = null;
          shut = false;
        }
      } else if (view === "playlists") {
        const answer = await playlists();
        if (gone) return;
        if (!answer.got) failed(answer.why, answer.shut);
        else {
          playlists2 = answer.value;
          problem = null;
          shut = false;
        }
      } else {
        const answer = view === "albums" ? await albums() : view === "artists" ? await artists() : await genres();
        if (gone) return;
        if (!answer.got) failed(answer.why, answer.shut);
        else {
          groups = answer.value;
          problem = null;
          shut = false;
        }
      }
      draw();
    }
    function drawChips(counts) {
      fill(
        chipRow,
        ...LIBRARY_KEEPS.map((entry) => {
          const many = counts ? countForKeep(counts, entry.keep) : null;
          if (counts && entry.keep !== "all" && many === 0) return null;
          return button(
            {
              cls: `oml-chip${keep === entry.keep ? " om-on" : ""}`,
              title: entry.detail,
              attrs: { "aria-pressed": keep === entry.keep ? "true" : "false" },
              onClick: () => {
                keep = entry.keep;
                blocks = 1;
                void keepPreference();
                draw();
              }
            },
            [el("span", { text: entry.label }), many === null ? null : el("span", { cls: "oml-chip-n", text: String(many) })]
          );
        }).filter((one) => one !== null)
      );
    }
    function head() {
      const orders = view === "playlists" ? LIBRARY_SORTS.filter((one) => one.sort === "title" || one.sort === "added") : LIBRARY_SORTS;
      const select = el("select", { cls: "oml-select", attrs: { "aria-label": "What order to show them in" } });
      for (const entry of orders) {
        const option = el("option", { text: entry.label, attrs: { value: entry.sort } });
        if (entry.sort === sort) option.setAttribute("selected", "");
        select.append(option);
      }
      select.addEventListener("change", () => {
        sort = librarySort(select.value);
        descending = sortStartsDown(sort);
        blocks = 1;
        void keepPreference();
        redrawHead();
        if (view === "songs") void load();
        else draw();
      });
      const tabs = el("div", { cls: "oml-tabs", attrs: { role: "tablist", "aria-label": "Your music" } });
      for (const entry of LIBRARY_VIEWS) {
        tabs.append(
          button(
            {
              cls: `oml-tab${entry.view === view ? " om-on" : ""}`,
              text: entry.label,
              attrs: { role: "tab", "aria-selected": entry.view === view ? "true" : "false" },
              onClick: () => {
                if (entry.view === view) return;
                void keepPreference(entry.view);
                place2.go("library", entry.view, said);
              }
            },
            []
          )
        );
      }
      return el("div", { cls: "oml-head" }, [
        el("div", { cls: "oml-head-top" }, [
          el("h1", { cls: "oml-h1", text: "Your music" }),
          el("div", { cls: "oml-head-do" }, [
            button({ cls: "om-btn", title: "Add files to your music", onClick: () => void doAndSay(importFiles()) }, [
              icon("file", 16),
              el("span", { text: "Add files" })
            ]),
            button({ cls: "om-btn", title: "Watch a folder for music", onClick: () => void doAndSay(watchFolder()) }, [
              icon("folder", 16),
              el("span", { text: "Add a folder" })
            ])
          ])
        ]),
        tabs,
        el("div", { cls: "oml-controls" }, [
          el("label", { cls: "oml-search-wrap" }, [icon("search", 15), search]),
          select,
          button(
            {
              cls: "om-icon",
              title: `${wayWords(sort, descending)} \u2014 press to turn it round`,
              onClick: () => {
                descending = !descending;
                blocks = 1;
                redrawHead();
                if (view === "songs") void load();
                else draw();
              }
            },
            [el("span", { cls: "oml-way", text: descending ? "\u2193" : "\u2191" })]
          ),
          el("div", { cls: "oml-layout", attrs: { role: "group", "aria-label": "How to show them" } }, [
            button(
              {
                cls: `om-icon${layout === "list" ? " om-on" : ""}`,
                title: "Show them as a list",
                attrs: { "aria-pressed": layout === "list" ? "true" : "false" },
                onClick: () => {
                  layout = "list";
                  redrawHead();
                  draw();
                }
              },
              [icon("list", 16)]
            ),
            button(
              {
                cls: `om-icon${layout === "grid" ? " om-on" : ""}`,
                title: "Show them as squares of artwork",
                attrs: { "aria-pressed": layout === "grid" ? "true" : "false" },
                onClick: () => {
                  layout = "grid";
                  redrawHead();
                  draw();
                }
              },
              [icon("panel", 16)]
            )
          ])
        ]),
        chipRow,
        count
      ]);
    }
    function nothing(what) {
      const words = emptyWords(problem ? shut ? "unreachable" : "failed" : "empty", what, problem);
      return says(words.title, words.detail, words.retry ? { label: "Try again", onClick: () => void load() } : void 0);
    }
    function drawSongs() {
      if (!tracks) {
        fill(body, nothing("songs"));
        drawChips(null);
        count.textContent = "";
        return;
      }
      const counts = libraryCounts(tracks);
      drawChips(counts);
      const kept2 = keepTracks(tracks, keep);
      const playIds = playableIds(kept2);
      const seconds = kept2.reduce((total, one) => total + (Number.isFinite(one.duration) && one.duration > 0 ? one.duration : 0), 0);
      count.textContent = kept2.length === 0 ? "" : `${countText(kept2.length, "song", "songs")} \xB7 ${countText(counts.here, "playable here", "playable here")} \xB7 ${countText(counts.reference, "saved by name", "saved by name")}${seconds > 0 ? ` \xB7 ${spanText(seconds)}` : ""}`;
      if (kept2.length === 0) {
        fill(body, problem ? nothing("songs") : says(said ? "Nothing matched those words" : "No songs here", said ? "Try fewer words." : LIBRARY_KEEPS.find((one) => one.keep === keep)?.detail ?? ""));
        return;
      }
      const upTo = shownRows(kept2.length, blocks);
      const shown = kept2.slice(0, upTo);
      if (layout === "grid") {
        const grid = el("div", { cls: "oml-grid" });
        for (const track of shown) {
          const playable = playableOffline(track);
          grid.append(
            card2(
              {
                name: track.title || "No title",
                sub: [track.artist, availabilityPill(track)].filter((one) => one).join(" \xB7 "),
                cover: { id: track.id, title: track.title, artist: track.artist, album: track.album },
                title: track.album ? `The record ${track.album}` : track.title,
                open: () => track.album ? place2.go("album", track.album) : void doAndSay(play(track.id)),
                play: playable ? () => void doAndSay(playAll(playIds, playIds.indexOf(track.id))) : void 0
              },
              holders
            )
          );
        }
        fill(body, grid, more(kept2.length, upTo));
      } else {
        const rows = el("ul", { cls: "oml-table", attrs: { role: "table", "aria-label": "Your songs" } });
        rows.append(
          tableHead(() => {
            redrawHead();
            blocks = 1;
            void load();
          })
        );
        shown.forEach((track, at) => rows.append(songRow(track, at, playIds, track.id === playingId, holders, place2)));
        fill(body, rows, more(kept2.length, upTo));
      }
      place2.wantCovers(shown.map((one) => one.id));
    }
    function drawGroups() {
      if (!groups) {
        fill(body, nothing(view));
        drawChips(null);
        count.textContent = "";
        return;
      }
      const everyTrack = groups.flatMap((one) => one.tracks);
      drawChips(libraryCounts(everyTrack));
      const kept2 = sortGroups(findGroups(keepGroups(groups, keep), said), sort, descending);
      count.textContent = kept2.length === 0 ? "" : countText(kept2.length, view.slice(0, -1), view);
      if (kept2.length === 0) {
        fill(body, problem ? nothing(view) : says(said ? "Nothing matched those words" : `No ${view} here`, said ? "Try fewer words." : ""));
        return;
      }
      const upTo = shownRows(kept2.length, blocks, 60);
      const shown = kept2.slice(0, upTo);
      const holder = layout === "grid" ? el("div", { cls: "oml-grid" }) : el("ul", { cls: "oml-growlist" });
      for (const group of shown) {
        const ids = playableIds(group.tracks);
        const playable = ids.length > 0;
        const length = groupSeconds(group);
        const of = {
          name: group.name,
          sub: groupSub(group, view),
          cover: { id: group.tracks[0]?.id, title: group.name, artist: group.by, album: view === "albums" ? group.name : void 0 },
          round: view === "artists",
          title: `${group.name} \u2014 ${groupSub(group, view)}${length.seconds > 0 ? `, ${spanText(length.seconds)}` : ""}${length.unknown > 0 ? ` and ${length.unknown} of unknown length` : ""}`,
          open: () => place2.go(view === "albums" ? "album" : view === "artists" ? "artist" : "genre", group.name),
          play: playable ? () => void doAndSay(playAll(ids)) : void 0
        };
        holder.append(layout === "grid" ? card2(of, holders) : groupRow(of, holders));
      }
      fill(body, holder, more(kept2.length, upTo));
      place2.wantCovers(shown.map((one) => one.tracks[0]?.id).filter((one) => typeof one === "string"));
    }
    function drawPlaylists2() {
      if (!playlists2) {
        fill(body, nothing("playlists"));
        drawChips(null);
        count.textContent = "";
        return;
      }
      fill(chipRow);
      const words = said.toLowerCase().trim();
      const kept2 = playlists2.filter((one) => !words || one.name.toLowerCase().includes(words)).sort((a, b) => sort === "added" ? a.createdAt - b.createdAt : a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
      if (descending) kept2.reverse();
      count.textContent = kept2.length === 0 ? "" : countText(kept2.length, "playlist", "playlists");
      if (kept2.length === 0) {
        fill(
          body,
          problem ? nothing("playlists") : says(words ? "Nothing matched those words" : "No playlists yet", words ? "Try fewer words." : "A playlist you make shows up here and down the left.")
        );
        return;
      }
      const holder = layout === "grid" ? el("div", { cls: "oml-grid" }) : el("ul", { cls: "oml-growlist" });
      for (const list of kept2) {
        const sub = list.rule ? "Worked out from your library" : countText(list.tracks.length, "song", "songs");
        const of = {
          name: list.name,
          sub,
          cover: { title: list.name },
          title: `${list.name} \u2014 ${sub}`,
          open: () => place2.go("playlist", list.id),
          play: () => void doAndSay(playPlaylist(list.id))
        };
        holder.append(layout === "grid" ? card2(of, holders) : groupRow(of, holders));
      }
      fill(body, holder);
    }
    function more(total, upTo) {
      if (upTo >= total) return null;
      return el("div", { cls: "oml-more" }, [
        el("span", { cls: "oml-faint", text: `Showing ${upTo} of ${total}.` }),
        button({
          cls: "om-btn om-btn-quiet",
          text: "Show more",
          onClick: () => {
            blocks += 1;
            draw();
          }
        })
      ]);
    }
    function draw() {
      holders = [];
      if (view === "songs") drawSongs();
      else if (view === "playlists") drawPlaylists2();
      else drawGroups();
    }
    search.addEventListener("input", () => {
      said = search.value;
      place2.replace("library", view, said);
      if (typing) clearTimeout(typing);
      typing = setTimeout(() => {
        blocks = 1;
        if (view === "songs") void load();
        else draw();
      }, 200);
    });
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || search.value === "") return;
      search.value = "";
      said = "";
      place2.replace("library", view, "");
      blocks = 1;
      if (view === "songs") void load();
      else draw();
    });
    const scrolled = () => {
      if (!nearEnd(place2.into.scrollTop, place2.into.clientHeight, place2.into.scrollHeight)) return;
      const total = view === "songs" ? tracks ? keepTracks(tracks, keep).length : 0 : groups?.length ?? 0;
      const step = view === "songs" ? void 0 : 60;
      if (shownRows(total, blocks, step) >= total) return;
      blocks += 1;
      draw();
    };
    place2.into.addEventListener("scroll", scrolled, { passive: true });
    fill(place2.into, headBox, body);
    redrawHead();
    fill(body, says(emptyWords("loading", view === "songs" ? "songs" : view).title, ""));
    async function start2() {
      if (!readStored) {
        readStored = true;
        const answer = await settings();
        if (answer.got) {
          const was = fromStored(answer.value.view);
          sort = librarySort(answer.value.sort);
          descending = sortStartsDown(sort);
          keep = was.keep;
          if (was.view !== view && place2.route.of === "") {
            place2.replace("library", was.view, said);
            return;
          }
          redrawHead();
        }
      }
      await load();
    }
    void start2();
    return {
      onPlayer: (state2) => {
        const was = playingId;
        playingId = state2.music?.playback.trackId ?? null;
        if (was !== playingId && view === "songs" && layout === "list") draw();
      },
      onCovers: () => {
        for (const held4 of holders) fill(held4.node, tile(held4.of, { size: held4.size, round: held4.round }));
      },
      leave: () => {
        gone = true;
        if (typing) clearTimeout(typing);
        place2.into.removeEventListener("scroll", scrolled);
      }
    };
  }
});

// extension-src/music/screens/playlist.ts
var TYPING_SETTLES = 200;
registerScreen({
  screen: "playlist",
  title: (route2) => route2.of,
  wants: { nowPlaying: "as-chosen" },
  mount: (place2) => mountPlaylist(place2)
});
function mountPlaylist(place2) {
  const id = place2.route.of;
  const held4 = {
    list: null,
    tracks: [],
    problem: null,
    shut: false,
    reading: true,
    renaming: false,
    askedToDelete: false,
    adding: false,
    said: "",
    found: [],
    findProblem: null,
    playingId: null
  };
  const head = el("div", { cls: "om-pl-head" });
  const body = el("div", { cls: "om-pl-body" });
  fill(place2.into, head, body);
  let typingTimer = null;
  let gone = false;
  let rowsList = null;
  let dropLine = null;
  if (!id) {
    fill(body, says("No playlist was named", "The address has to say which playlist to open."));
    return {
      leave: () => {
        gone = true;
      }
    };
  }
  async function read2() {
    const [lists, tracks] = await Promise.all([playlists(), playlistTracks(id)]);
    if (gone) return;
    held4.reading = false;
    if (!lists.got) {
      held4.problem = lists.why;
      held4.shut = lists.shut;
    } else {
      held4.list = lists.value.find((one) => one.id === id) ?? null;
      held4.problem = held4.list ? null : "That playlist is not in your music any more.";
      held4.shut = false;
    }
    if (tracks.got) held4.tracks = tracks.value;
    else if (held4.problem === null) {
      held4.problem = tracks.why;
      held4.shut = tracks.shut;
    }
    draw();
    place2.wantCovers(held4.tracks.map((one) => one.id));
  }
  async function change(doing) {
    await doAndSay(doing);
    await read2();
  }
  function drawHead() {
    const list = held4.list;
    if (!list) {
      fill(head);
      return;
    }
    const sums = playlistSums(held4.tracks);
    const first = held4.tracks.slice(0, 4);
    const cover = el(
      "div",
      { cls: `om-pl-cover om-pl-cover-${Math.max(1, first.length)}`, attrs: { "aria-hidden": "true" } },
      first.length === 0 ? [el("span", { cls: "om-pl-cover-letter", text: (list.name.trim()[0] ?? "?").toUpperCase() })] : first.map((one) => tile({ id: one.id, title: one.title, artist: one.artist, album: one.album }, { size: "md" }))
    );
    const made = new Date(list.createdAt);
    const madeWords = Number.isFinite(made.getTime()) ? `Made ${made.toLocaleDateString()}` : "";
    const words = el("div", { cls: "om-pl-words" }, [
      el("p", { cls: "om-pl-kind", text: list.rule ? "Worked out from your music" : "Playlist" }),
      held4.renaming ? renameField(list) : el("h1", { cls: "om-pl-name", text: list.name || "Untitled playlist" }),
      el("p", { cls: "om-pl-sums", text: [sumsWords(sums, spanText), madeWords].filter((one) => one !== "").join(" \xB7 ") }),
      list.rule ? el("p", {
        cls: "om-pl-note",
        text: "This one is a question asked of your library, so its songs and their order are worked out afresh every time it is opened."
      }) : null
    ]);
    const playable = held4.tracks.some((one) => playableOffline(one));
    const actions = el("div", { cls: "om-pl-actions" }, [
      button(
        {
          cls: "om-btn om-btn-primary om-pl-play",
          title: playable ? `Play ${list.name}` : "Nothing in here can be played on this computer",
          onClick: () => {
            if (!playable) {
              place2.note("Nothing in this playlist has audio on this computer.");
              return;
            }
            void change(playPlaylist(list.id));
          }
        },
        [icon("play", 20), el("span", { text: "Play" })]
      ),
      button(
        {
          cls: "om-btn",
          title: "Play this playlist with the songs mixed up",
          onClick: () => {
            if (!playable) {
              place2.note("Nothing in this playlist has audio on this computer.");
              return;
            }
            void shufflePlay(list.id);
          }
        },
        [icon("shuffle", 18), el("span", { text: "Shuffle" })]
      ),
      list.rule ? null : button(
        {
          cls: `om-btn om-btn-quiet${held4.adding ? " om-on" : ""}`,
          title: "Find songs in your library to add",
          onClick: () => {
            held4.adding = !held4.adding;
            draw();
          }
        },
        [icon("plus", 18), el("span", { text: "Add songs" })]
      ),
      button(
        {
          cls: "om-icon",
          title: "Rename this playlist",
          onClick: () => {
            held4.renaming = !held4.renaming;
            draw();
          }
        },
        [icon("edit", 18)]
      ),
      held4.askedToDelete ? el("span", { cls: "om-pl-confirm" }, [
        el("span", { cls: "om-pl-confirm-words", text: "Delete it? The songs stay in your library." }),
        button({ cls: "om-btn om-pl-danger", text: "Delete", onClick: () => void deleteIt(list.id) }),
        button({
          cls: "om-btn om-btn-quiet",
          text: "Keep it",
          onClick: () => {
            held4.askedToDelete = false;
            draw();
          }
        })
      ]) : button(
        {
          cls: "om-icon",
          title: "Delete this playlist",
          onClick: () => {
            held4.askedToDelete = true;
            draw();
          }
        },
        [icon("close", 18)]
      )
    ]);
    fill(head, wash(held4.tracks[0]?.id), el("div", { cls: "om-pl-top" }, [cover, words]), actions);
  }
  function renameField(list) {
    const input = el("input", {
      cls: "om-pl-rename-input",
      attrs: { type: "text", value: list.name, maxlength: 200, "aria-label": "The name of this playlist", spellcheck: "false" }
    });
    const save = () => {
      const name = renameTo(input.value, list.name);
      held4.renaming = false;
      if (name === null) {
        draw();
        return;
      }
      void change(renamePlaylist(list.id, name));
    };
    input.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "Enter") save();
      if (key === "Escape") {
        held4.renaming = false;
        draw();
      }
    });
    setTimeout(() => input.focus(), 0);
    return el("div", { cls: "om-pl-rename" }, [
      input,
      button({ cls: "om-btn om-btn-primary", text: "Save", onClick: save }),
      button({
        cls: "om-btn om-btn-quiet",
        text: "Cancel",
        onClick: () => {
          held4.renaming = false;
          draw();
        }
      })
    ]);
  }
  async function shufflePlay(listId) {
    const on = await setShuffle(true);
    if (!on.got) {
      place2.note(on.why);
      return;
    }
    await change(playPlaylist(listId));
  }
  async function deleteIt(listId) {
    const answer = await removePlaylist(listId);
    if (!answer.got) {
      place2.note(answer.why);
      return;
    }
    if (answer.value !== true) {
      place2.note("Orbis did not delete that playlist.");
      await read2();
      return;
    }
    place2.note("Playlist deleted. The songs are still in your library.");
    place2.go("playlists");
  }
  function drawRows() {
    const list = held4.list;
    const rows = el("ol", { cls: "om-rows om-pl-rows" });
    rowsList = rows;
    held4.tracks.forEach((track, at) => {
      const row = trackRow(track, {
        playing: held4.playingId !== null && track.id === held4.playingId,
        onPlay: () => void doAndSay(
          playAll(
            held4.tracks.map((one) => one.id),
            at
          )
        )
      });
      row.classList.add("om-pl-row");
      row.dataset.at = String(at);
      row.prepend(el("span", { cls: "om-pl-number", text: String(at + 1) }));
      if (list && !list.rule) {
        row.append(
          el("span", { cls: "om-pl-moves" }, [
            button({ cls: "om-icon om-icon-sm om-pl-up", title: `Move ${track.title} up`, onClick: () => void step(at, -1) }, [icon("back", 15)]),
            button({ cls: "om-icon om-icon-sm om-pl-down", title: `Move ${track.title} down`, onClick: () => void step(at, 1) }, [icon("forward", 15)]),
            handle(at, track)
          ]),
          button(
            {
              cls: "om-icon om-icon-sm om-pl-out",
              title: `Take ${track.title} out of this playlist`,
              onClick: () => void change(removeFromPlaylist(list.id, track.id))
            },
            [icon("close", 15)]
          )
        );
      }
      rows.append(row);
    });
    dropLine = el("div", { cls: "om-pl-drop", attrs: { "aria-hidden": "true" } });
    rows.append(dropLine);
    return rows;
  }
  function drawBody() {
    if (held4.reading && held4.tracks.length === 0 && held4.problem === null) {
      const found = emptyWords("loading", "playlist");
      fill(body, says(found.title, found.detail));
      return;
    }
    if (held4.problem !== null && held4.list === null) {
      const found = emptyWords(held4.shut ? "unreachable" : "failed", "playlist", held4.problem);
      fill(body, says(found.title, found.detail, found.retry ? { label: "Try again", onClick: () => void read2() } : void 0));
      return;
    }
    const parts = [];
    if (held4.adding && held4.list && !held4.list.rule) parts.push(addPanel());
    if (held4.tracks.length === 0) {
      parts.push(
        held4.list?.rule ? says("Nothing matches this one right now", "It asks your library a question, and today nothing in your music answers it.") : says("This playlist has no songs yet", "Use Add songs to search your library and put something in it.")
      );
    } else {
      parts.push(drawRows());
    }
    fill(body, ...parts);
  }
  async function step(at, direction) {
    const list = held4.list;
    if (!list || list.rule) return;
    const shownMove = stepMove(at, direction, held4.tracks.length);
    if (!shownMove) return;
    await send(list, shownMove);
    const which = direction === -1 ? "om-pl-up" : "om-pl-down";
    rowsList?.querySelector(`[data-at="${shownMove.to}"] .${which}`)?.focus();
  }
  async function send(list, shownMove) {
    const real = realMove(
      list.tracks,
      held4.tracks.map((one) => one.id),
      shownMove
    );
    if (!real) {
      await read2();
      return;
    }
    await change(reorderPlaylist(list.id, real.from, real.to));
  }
  function handle(at, track) {
    const grip = button({ cls: "om-pl-grip", title: `Drag ${track.title} to another place in this playlist` }, [icon("more", 16)]);
    grip.addEventListener("pointerdown", (event) => {
      const pointer = event;
      if (pointer.button !== 0) return;
      const list = held4.list;
      if (!list || list.rule || !rowsList || !dropLine) return;
      pointer.preventDefault();
      grip.setPointerCapture(pointer.pointerId);
      const line = dropLine;
      const rows = [...rowsList.querySelectorAll(".om-pl-row")];
      const boxes = rows.map((row) => row.getBoundingClientRect());
      const middles = boxes.map((box) => box.top + box.height / 2);
      const bottom = boxes.length > 0 ? boxes[boxes.length - 1].bottom : 0;
      const listTop = rowsList.getBoundingClientRect().top;
      const lifted = rows[at];
      let before = at;
      const showLine = (y) => {
        before = dropBefore(middles, y);
        const edge = before < boxes.length ? boxes[before].top : bottom;
        line.style.setProperty("transform", `translateY(${Math.round(edge - listTop)}px)`);
        line.classList.add("om-pl-drop-on");
      };
      const letGo = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", drop);
        grip.removeEventListener("pointercancel", letGo);
        lifted?.classList.remove("om-pl-row-lifted");
        line.classList.remove("om-pl-drop-on");
      };
      const move = (next2) => showLine(next2.clientY);
      const drop = () => {
        letGo();
        const shownMove = landingMove({ from: at, before }, held4.tracks.length);
        if (shownMove) void send(list, shownMove);
      };
      lifted?.classList.add("om-pl-row-lifted");
      showLine(pointer.clientY);
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", drop);
      grip.addEventListener("pointercancel", letGo);
    });
    return grip;
  }
  function addPanel() {
    const list = held4.list;
    const box = el("input", {
      cls: "om-pl-find-input",
      attrs: {
        type: "search",
        value: held4.said,
        placeholder: "A song, an artist or an album in your library",
        "aria-label": "Search your library for songs to add"
      }
    });
    box.addEventListener("input", () => {
      held4.said = box.value;
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => void look(), TYPING_SETTLES);
    });
    setTimeout(() => box.focus(), 0);
    const results = el("div", { cls: "om-pl-found" });
    if (held4.findProblem !== null) {
      results.append(el("p", { cls: "om-side-says", text: held4.findProblem }));
    } else if (held4.said.trim() === "") {
      results.append(el("p", { cls: "om-side-says", text: "Type a few letters and Orbis looks through the songs you have." }));
    } else {
      const spare = list ? notAlready(held4.found, list.tracks) : held4.found;
      if (spare.length === 0) {
        results.append(
          el("p", {
            cls: "om-side-says",
            text: held4.found.length > 0 ? "Everything that matches is in this playlist already." : "Nothing in your library matches those words."
          })
        );
      } else {
        const rows = el("ul", { cls: "om-rows om-pl-found-rows" });
        for (const track of spare) {
          rows.append(
            el("li", { cls: "om-row om-pl-found-row" }, [
              tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: "sm" }),
              el("span", { cls: "om-row-words" }, [
                el("span", { cls: "om-row-title", text: track.title || "No title" }),
                el("span", { cls: "om-row-artist", text: [track.artist, track.album].filter((one) => one !== "").join(" \u2014 ") || "No artist named" })
              ]),
              button({
                cls: "om-btn om-btn-quiet",
                title: `Add ${track.title} to this playlist`,
                text: "Add",
                onClick: () => {
                  if (list) void change(addToPlaylist(list.id, [track.id]));
                }
              })
            ])
          );
        }
        results.append(rows, el("p", { cls: "om-side-says", text: countText(spare.length, "song you could add", "songs you could add") }));
      }
    }
    return el("div", { cls: "om-pl-find" }, [
      el("div", { cls: "om-pl-find-top" }, [
        box,
        button(
          {
            cls: "om-icon",
            title: "Stop adding songs",
            onClick: () => {
              held4.adding = false;
              draw();
            }
          },
          [icon("close", 18)]
        )
      ]),
      results
    ]);
  }
  async function look() {
    const said = held4.said.trim();
    if (said === "") {
      held4.found = [];
      held4.findProblem = null;
      draw();
      return;
    }
    const answer = await library({ search: said });
    if (gone) return;
    if (!answer.got) {
      held4.findProblem = answer.shut ? "Open the Orbis window and your music connects by itself." : answer.why;
      draw();
      return;
    }
    held4.findProblem = null;
    held4.found = answer.value.slice(0, 40);
    draw();
    place2.wantCovers(held4.found.map((one) => one.id));
  }
  function draw() {
    if (gone) return;
    drawHead();
    drawBody();
  }
  draw();
  void read2();
  return {
    onPlayer: (state2) => {
      const playing = state2.music?.playback.trackId ?? null;
      if (playing === held4.playingId) return;
      held4.playingId = playing;
      drawBody();
    },
    onCovers: () => draw(),
    leave: () => {
      gone = true;
      if (typingTimer) clearTimeout(typingTimer);
    }
  };
}

// extension-src/music/marked.ts
var held3 = /* @__PURE__ */ new WeakMap();
var put = (node, what) => {
  held3.set(node, what);
  node.setAttribute("data-om-marked", what.kind);
  return node;
};
var markPlaylist = (node, list) => put(node, { kind: "playlist", list });
function markedAt(from) {
  if (!(from instanceof Node)) return null;
  const start2 = from instanceof Element ? from : from.parentElement;
  const node = start2?.closest("[data-om-marked]");
  if (!(node instanceof HTMLElement)) return null;
  const what = held3.get(node);
  return what ? { node, what } : null;
}
var KEEP_FOR = 3e3;
var kept = null;
var asking3 = null;
async function theLists() {
  if (kept && Date.now() - kept.at < KEEP_FOR) return kept.lists;
  if (asking3) return asking3;
  asking3 = (async () => {
    const answer = await playlists();
    if (!answer.got) return null;
    kept = { lists: answer.value, at: Date.now() };
    return answer.value;
  })().finally(() => {
    asking3 = null;
  });
  return asking3;
}
var playlistsChanged = () => {
  kept = null;
};
async function markSidebar(list) {
  const rows = [...list.querySelectorAll(":scope > .om-side-row")].filter((one) => one instanceof HTMLElement);
  if (rows.length === 0) return;
  const lists = await theLists();
  if (!lists || lists.length !== rows.length) return;
  rows.forEach((row, index) => {
    const playlist = lists[index];
    if (!playlist) return;
    const name = row.querySelector(".om-side-name")?.textContent ?? "";
    if (name !== playlist.name) return;
    markPlaylist(row, playlist);
  });
}
function watchSidebarPlaylists() {
  const find2 = () => {
    const node = document.querySelector(".om-side-list");
    return node instanceof HTMLElement ? node : null;
  };
  let soon = null;
  const again = (list) => {
    if (soon) clearTimeout(soon);
    soon = setTimeout(() => void markSidebar(list), 30);
  };
  const start2 = () => {
    const list = find2();
    if (!list) return false;
    new MutationObserver(() => again(list)).observe(list, { childList: true });
    again(list);
    return true;
  };
  if (start2()) return;
  const waiting = new MutationObserver(() => {
    if (start2()) waiting.disconnect();
  });
  waiting.observe(document.body, { childList: true, subtree: true });
}

// extension-src/music/screens/playlists.ts
registerScreen({
  screen: "playlists",
  title: () => "Playlists",
  // There is no cover and no running order on this screen, so the column on the right is the better use of the width.
  wants: { nowPlaying: "as-chosen" },
  mount: (place2) => mountPlaylists(place2)
});
function mountPlaylists(place2) {
  const head = el("div", { cls: "om-lists-head" });
  const grid = el("div", { cls: "om-lists-grid" });
  const body = el("div", { cls: "om-lists" }, [head, grid]);
  let lists = null;
  let naming = false;
  function drawHead() {
    const byHand = lists ? lists.filter((one) => !one.rule).length : 0;
    const worked = lists ? lists.length - byHand : 0;
    const lines = [];
    if (byHand > 0) lines.push(countText(byHand, "playlist", "playlists"));
    if (worked > 0) lines.push(`${countText(worked, "playlist", "playlists")} worked out from your library`);
    fill(
      head,
      el("div", {}, [
        el("h1", { cls: "om-lists-title", text: "Playlists" }),
        lines.length > 0 ? el("p", { cls: "om-lists-line", text: lines.join(" \xB7 ") }) : null
      ]),
      naming ? namingField() : button({ cls: "om-btn om-btn-primary", onClick: () => openNaming() }, [icon("plus", 16), el("span", { text: "New playlist" })])
    );
  }
  function openNaming() {
    naming = true;
    drawHead();
    const field = head.querySelector(".om-lists-name");
    field?.focus();
  }
  function closeNaming() {
    naming = false;
    drawHead();
  }
  function namingField() {
    const field = el("input", {
      cls: "om-lists-name",
      attrs: { type: "text", placeholder: "Name for the playlist", maxlength: 80, "aria-label": "Name for the new playlist" }
    });
    const save = async () => {
      const name = field.value.trim();
      if (name === "") {
        place2.note("Give the playlist a name first.");
        field.focus();
        return;
      }
      naming = false;
      await doAndSay(createPlaylist(name));
      await load();
    };
    field.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key === "Enter") {
        event.preventDefault();
        void save();
      } else if (key === "Escape") {
        event.preventDefault();
        closeNaming();
      }
    });
    return el("div", { cls: "om-lists-naming" }, [
      field,
      button({ cls: "om-btn om-btn-primary", onClick: () => void save() }, [el("span", { text: "Make it" })]),
      button({ cls: "om-btn om-btn-quiet", onClick: () => closeNaming() }, [el("span", { text: "Cancel" })])
    ]);
  }
  function listCard(list) {
    const worked = Boolean(list.rule);
    const sub = worked ? "Worked out from your library" : countText(list.tracks.length, "song", "songs");
    const open2 = button(
      {
        cls: `om-card${worked ? " om-card-worked" : ""}`,
        title: `${list.name} \u2014 ${sub}`,
        onClick: () => place2.go("playlist", list.id)
      },
      [
        el("div", { cls: "om-card-cover" }, [tile({ title: list.name }, { size: "lg" })]),
        el("span", { cls: "om-card-words" }, [el("span", { cls: "om-card-name", text: list.name }), el("span", { cls: "om-card-under", text: sub })])
      ]
    );
    const play2 = button(
      {
        cls: "om-icon om-lists-play",
        title: `Play ${list.name}`,
        onClick: () => void doAndSay(playPlaylist(list.id))
      },
      [icon("play", 16)]
    );
    return markPlaylist(el("div", { cls: "om-lists-cell" }, [open2, play2]), list);
  }
  function draw() {
    drawHead();
    if (!lists) return;
    fill(grid, ...lists.map((one) => listCard(one)));
  }
  async function load() {
    if (!lists) fill(place2.into, says(emptyWords("loading", "playlists").title));
    const answer = await playlists();
    if (!answer.got) {
      if (lists) {
        place2.note(answer.why);
        return;
      }
      const words = emptyWords(answer.shut ? "unreachable" : "failed", "playlists", answer.why);
      fill(place2.into, says(words.title, words.detail, { label: "Try again", onClick: () => void load() }));
      return;
    }
    lists = answer.value;
    if (answer.value.length === 0) {
      fill(
        place2.into,
        says("No playlists yet", "Make one and it turns up here, down the left, and in the right-click menu on any song.", {
          label: "New playlist",
          onClick: () => {
            lists = [];
            naming = true;
            fill(place2.into, body);
            draw();
            head.querySelector(".om-lists-name")?.focus();
          }
        })
      );
      return;
    }
    fill(place2.into, body);
    draw();
  }
  void load();
  return {};
}

// extension-src/music/screens/noticed.ts
function keptWords(outcome) {
  switch (outcome?.kind) {
    case "already":
      return "That song is already in your music.";
    case "linked":
      return "Added, using the copy you already have.";
    case "reference":
      return "Saved by name. There is no audio for it on this computer; import your own copy to play it here.";
    case "ask":
      return "Several of your files might be it. Open your library and pick the right one.";
    default:
      return outcome?.why || "That could not be added.";
  }
}
var fromWords = (provider) => provider.trim() === "" ? "A web page" : provider.trim();
registerScreen({
  screen: "noticed",
  title: () => "Noticed while browsing",
  mount: (place2) => {
    const nowPlace = el("div", { cls: "om-own-slot" }, [reading("what is playing")]);
    const listPlace = el("div", { cls: "om-own-slot" }, [reading("noticed songs")]);
    let working = false;
    async function drawHeard(fresh = false) {
      if (working) return;
      working = true;
      if (fresh) fill(nowPlace, card("", [el("p", { cls: "om-own-row-label", text: "Listening\u2026" })]));
      const answer = fresh ? await lookAgain() : await heard();
      working = false;
      const got = unwrap(answer, "what is playing");
      if ("problem" in got) {
        fill(nowPlace, got.problem);
        return;
      }
      const heard2 = got.value;
      if (!heard2.sighting) {
        fill(
          nowPlace,
          card("", [
            el("p", { cls: "om-own-row-label", text: "Nothing is playing on a page right now" }),
            el("p", { cls: "om-own-row-detail", text: "Start a song on a web page and Orbis will work out what it is." })
          ])
        );
        return;
      }
      const names = heard2.recognition?.names;
      const sure = heard2.recognition?.confidence;
      fill(
        nowPlace,
        card("om-own-heard", [
          el("span", { cls: "om-pill", text: "Playing on a web page" }),
          heard2.working ? el("p", { cls: "om-own-row-label", text: "Working out what this is\u2026" }) : names && names.title ? el("div", { cls: "om-own-row-words" }, [
            el("span", { cls: "om-own-row-label", text: names.title }),
            el("span", { cls: "om-own-row-detail", text: names.artist || "No artist named" }),
            // Said out loud rather than hidden behind a tooltip: a low-confidence reading is still a guess at a
            // name, and somebody about to keep it should know that before they do.
            sure === "low" ? el("span", { cls: "om-own-warn", text: "Orbis is not certain about this one." }) : null
          ]) : el("div", { cls: "om-own-row-words" }, [
            el("span", { cls: "om-own-row-label", text: "Orbis could not work out what this is" }),
            heard2.recognition?.why ? el("span", { cls: "om-own-row-detail", text: String(heard2.recognition.why) }) : null
          ]),
          el("div", { cls: "om-own-acts" }, [
            heard2.inLibraryId ? press("Play your copy", () => void doAndSay(play(heard2.inLibraryId)), "primary", "play") : names && names.title && !heard2.working ? press(
              "Keep the name",
              () => {
                const sighting = heard2.sighting;
                void keep2(names, sighting?.duration ?? 0, {
                  provider: String(sighting?.provider ?? "web"),
                  url: typeof sighting?.url === "string" ? sighting.url : void 0
                });
              },
              "primary",
              "plus"
            ) : null,
            press("Look again", () => void drawHeard(true), "quiet", "refresh")
          ]),
          heard2.inLibraryId ? el("p", { cls: "om-own-row-detail", text: "You already have this one." }) : null
        ])
      );
    }
    async function keep2(names, duration, source) {
      const answer = await keepNoticed(names, duration, source);
      if (!answer.got) {
        place2.note(answer.why);
        return;
      }
      place2.note(keptWords(answer.value));
      await drawHeard();
      await drawList();
    }
    async function drawList() {
      const answer = await noticed();
      const got = unwrap(answer, "noticed songs");
      if ("problem" in got) {
        fill(listPlace, got.problem);
        return;
      }
      const songs = got.value;
      if (songs.length === 0) {
        fill(
          listPlace,
          nothingYet(
            "songs noticed yet",
            "When a web page plays something, Orbis works out what it is and lists it here. It never keeps a name you have not asked it to."
          )
        );
        return;
      }
      const now2 = Date.now();
      fill(
        listPlace,
        ...byDay(songs, now2).map(
          (group) => el("div", { cls: "om-own-day" }, [
            el("h3", { cls: "om-own-sub", text: group.day }),
            el(
              "ul",
              { cls: "om-own-noticed" },
              group.things.map(
                (song) => el("li", { cls: "om-own-noticed-row" }, [
                  el("span", { cls: "om-own-row-words" }, [
                    el("span", { cls: "om-own-row-label", text: song.title }),
                    el("span", { cls: "om-own-row-detail", text: [song.artist || "No artist named", song.album].filter((one) => one).join(" \u2014 ") })
                  ]),
                  el("span", { cls: "om-own-noticed-from", text: fromWords(song.provider) }),
                  el("span", { cls: "om-own-when", text: whenWords(song.at, now2) }),
                  noticedOffer(song) === "play" ? button(
                    { cls: "om-icon om-icon-sm", title: `Play your copy of ${song.title}`, onClick: () => void doAndSay(play(song.trackId)) },
                    [icon("play", 15)]
                  ) : button(
                    {
                      cls: "om-icon om-icon-sm",
                      title: "Keep the name. There is no audio for it on this computer.",
                      onClick: () => void keep2({ title: song.title, artist: song.artist, album: song.album ?? "" }, 0, { provider: song.provider, url: song.url })
                    },
                    [icon("plus", 15)]
                  ),
                  // Whether there is a copy is the whole point of this list, so it is on every row rather than implied
                  // by which button happens to be there.
                  el("span", {
                    cls: noticedOffer(song) === "play" ? "om-pill" : "om-pill om-pill-warn",
                    text: noticedOffer(song) === "play" ? "In your music" : "No audio here"
                  })
                ])
              )
            )
          ])
        )
      );
    }
    async function forget() {
      await doAndSay(run("clear-recognised"));
      await drawList();
    }
    fill(
      place2.into,
      screenHead(
        "Noticed while browsing",
        "Orbis can tell you what a web page is playing. It never touches that player, and it never downloads anything."
      ),
      block("Playing on a page now", "What Orbis can see at this moment.", [nowPlace]),
      block(
        "Named lately",
        "A list of names, not a library. Keeping one links a copy you already have, or keeps the name with no audio.",
        [listPlace],
        press("Forget this list", () => void forget(), "quiet")
      )
    );
    void drawHeard();
    void drawList();
    const timer2 = setInterval(() => {
      if (!document.hidden) void drawHeard();
    }, 4e3);
    return { leave: () => clearInterval(timer2) };
  }
});

// src/shared/music/nowplaying.ts
var STEP = 8;
var SOLID_ENOUGH = 128;
function liveliness(r, g, b) {
  const top = Math.max(r, g, b);
  const bottom = Math.min(r, g, b);
  return top === 0 ? 0 : (top - bottom) / top;
}
var apart = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
function dominantColours(data, wanted = 3) {
  if (wanted < 1 || data.length < 4) return [];
  const sums = /* @__PURE__ */ new Map();
  let counted = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3];
    if (!Number.isFinite(alpha) || alpha < SOLID_ENOUGH) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
    const key = Math.floor(r / STEP) << 10 | Math.floor(g / STEP) << 5 | Math.floor(b / STEP);
    const held4 = sums.get(key);
    if (held4) {
      held4.r += r;
      held4.g += g;
      held4.b += b;
      held4.count += 1;
    } else sums.set(key, { r, g, b, count: 1 });
    counted += 1;
  }
  if (counted === 0) return [];
  const buckets = [...sums.values()].map((one) => {
    const r = Math.round(one.r / one.count);
    const g = Math.round(one.g / one.count);
    const b = Math.round(one.b / one.count);
    return { swatch: { r, g, b, share: one.count / counted }, standing: one.count * (0.5 + liveliness(r, g, b)) };
  });
  buckets.sort((a, b) => b.standing - a.standing);
  const out = [];
  for (const bucket of buckets) {
    if (out.length >= wanted) break;
    if (out.some((one) => apart(one, bucket.swatch) < 60)) continue;
    out.push(bucket.swatch);
  }
  if (out.length === 0 && buckets[0]) out.push(buckets[0].swatch);
  return out;
}
function rgbText(swatch, alpha = 1) {
  const level = Math.min(Math.max(alpha, 0), 1);
  return level >= 1 ? `rgb(${swatch.r} ${swatch.g} ${swatch.b})` : `rgb(${swatch.r} ${swatch.g} ${swatch.b} / ${level})`;
}
function backdropColours(swatches) {
  const first = swatches[0];
  if (!first) return null;
  const second = swatches[1] ?? first;
  return { near: rgbText(first, 0.55), far: rgbText(second, 0.22) };
}
function dayWords2(at, now2) {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > now2 + 864e5) return "";
  const when = new Date(at);
  const today = new Date(now2);
  const sameDay = when.toDateString() === today.toDateString();
  const time = when.toLocaleTimeString(void 0, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(now2 - 864e5);
  if (when.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  const sameYear = when.getFullYear() === today.getFullYear();
  return when.toLocaleDateString(void 0, { day: "numeric", month: "long", year: sameYear ? void 0 : "numeric" });
}
function originWords(track) {
  const came = track.provenance === "user-file" ? "A file you added" : track.provenance === "watched-folder" ? "A file in a folder Orbis watches" : track.provenance === "download" ? "Downloaded through Orbis" : "Noticed while browsing";
  const how = track.method === "file-tags" ? "named from the file itself" : track.method === "media-session" ? "named from the web page's own player" : track.method === "vision" ? "named by Orbis reading the player on screen" : track.method === "page-metadata" ? "named from the page" : track.method === "accessibility" ? "named from what the page tells a screen reader" : "named by you";
  const where = track.source?.provider ? `, on ${track.source.provider}` : "";
  return `${came}, ${how}${where}`;
}
function sureWords(confidence) {
  if (confidence === "low") return "Orbis is not certain about these names";
  if (confidence === "medium") return "Orbis is fairly sure about these names";
  return "";
}
function availabilityWords(availability, hasFile2) {
  if (availability === "local") return hasFile2 ? "A file on this computer" : "Orbis has no file for it";
  if (availability === "reference") return "Kept by name only, with no audio on this computer";
  if (availability === "missing") return "The file is not where it was";
  return "This computer cannot play this kind of audio file";
}
function sizeWords(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value2 = bytes / 1024;
  let unit = 0;
  while (value2 >= 1024 && unit < units.length - 1) {
    value2 /= 1024;
    unit += 1;
  }
  return `${value2 < 10 ? value2.toFixed(1) : Math.round(value2)} ${units[unit]}`;
}
function trackFacts(track, now2, lengthText) {
  const facts = [];
  if (lengthText && lengthText !== "\u2014") facts.push({ label: "Length", value: lengthText });
  if (track.albumArtist && track.albumArtist !== track.artist) facts.push({ label: "Album artist", value: track.albumArtist });
  if (track.genre) facts.push({ label: "Genre", value: track.genre });
  if (typeof track.year === "number" && Number.isFinite(track.year) && track.year > 0) facts.push({ label: "Year", value: String(track.year) });
  if (typeof track.trackNumber === "number" && track.trackNumber > 0) {
    const disc = typeof track.discNumber === "number" && track.discNumber > 0 ? `, disc ${track.discNumber}` : "";
    facts.push({ label: "Track", value: `${track.trackNumber}${disc}` });
  }
  const added = dayWords2(track.addedAt, now2);
  if (added) facts.push({ label: "Added", value: added });
  const plays = track.playCount;
  if (typeof plays === "number" && Number.isFinite(plays) && plays > 0) {
    facts.push({ label: "Played", value: plays === 1 ? "Once, all the way through" : `${plays} times, all the way through` });
  }
  const last = dayWords2(track.lastPlayedAt, now2);
  if (last) facts.push({ label: "Last played", value: last });
  facts.push({ label: "Where it came from", value: originWords(track) });
  facts.push({ label: "What Orbis has", value: availabilityWords(track.availability, Boolean(track.file)) });
  const size = sizeWords(track.fileSize);
  if (size) facts.push({ label: "File size", value: size });
  if (track.edited) facts.push({ label: "Names", value: "Edited by you, so recognising it again will not overwrite them" });
  const sure = sureWords(track.confidence);
  if (sure) facts.push({ label: "How sure", value: sure });
  return facts;
}

// extension-src/music/screens/nowplaying.ts
function addStyles() {
  const href = chrome.runtime.getURL("music-nowplaying.css");
  if (document.head.querySelector(`link[href="${href}"]`)) return;
  document.head.append(el("link", { attrs: { rel: "stylesheet", href } }));
}
var measured = /* @__PURE__ */ new Map();
var read = /* @__PURE__ */ new Set();
async function measure(trackId, picture) {
  const held4 = measured.get(trackId);
  if (held4) return held4;
  if (read.has(trackId)) return [];
  read.add(trackId);
  const found = await new Promise((settle2) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const paper = canvas.getContext("2d", { willReadFrequently: false });
        if (!paper) {
          settle2([]);
          return;
        }
        paper.drawImage(image, 0, 0, 24, 24);
        settle2(dominantColours(paper.getImageData(0, 0, 24, 24).data, 2));
      } catch {
        settle2([]);
      }
    };
    image.onerror = () => settle2([]);
    image.src = picture;
  });
  if (found.length > 0) measured.set(trackId, found);
  return found;
}
async function paint(band, track) {
  const picture = coverFor(track.id);
  if (!picture) return;
  const colours = backdropColours(await measure(track.id, picture));
  if (!colours) return;
  if (!band.isConnected) return;
  band.style.setProperty("--om-np-near", colours.near);
  band.style.setProperty("--om-np-far", colours.far);
  band.classList.add("om-np-measured");
}
var UP_NEXT = 20;
function factList(track) {
  const facts = trackFacts(track, Date.now(), clockText(track.duration));
  return el(
    "dl",
    { cls: "om-np-facts" },
    facts.flatMap((fact) => [el("dt", { cls: "om-np-fact-label", text: fact.label }), el("dd", { cls: "om-np-fact-value", text: fact.value })])
  );
}
async function drawWhy(into2, trackId) {
  const answer = await whyThis(trackId);
  if (!into2.isConnected) return;
  if (!answer.got || !answer.value || answer.value.because.length === 0) {
    into2.remove();
    return;
  }
  fill(
    into2,
    el("h2", { cls: "om-np-sub", text: "Why Orbis chose this one" }),
    el(
      "ul",
      { cls: "om-np-why" },
      answer.value.because.slice(0, 6).map((one) => el("li", { cls: "om-np-why-row", text: one.name ? `${one.dimension}: ${one.name}` : one.dimension }))
    )
  );
}
function header(track, place2) {
  const why = whyNotPlayable(track);
  const band = el("header", { cls: "om-np-head" }, [
    wash(track.id),
    el("div", { cls: "om-np-art" }, [tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: "xl" })]),
    el("div", { cls: "om-np-words" }, [
      el("p", { cls: "om-np-kicker", text: "Playing now" }),
      el("h1", { cls: "om-np-title", text: track.title || "No title" }),
      el("p", { cls: "om-np-by" }, [
        track.artist ? button({ cls: "om-np-link", text: track.artist, title: `Everything by ${track.artist}`, onClick: () => place2.go("artist", track.artist) }) : el("span", { cls: "om-np-faint", text: "No artist named" }),
        track.album ? el("span", { cls: "om-np-faint", text: ` \u2014 ${track.album}` }) : null
      ]),
      why ? el("p", { cls: "om-np-warn", text: why }) : null,
      el("div", { cls: "om-np-does" }, [
        button(
          {
            cls: `om-btn${track.favourite ? " om-btn-primary" : ""}`,
            onClick: () => void doAndSay(setFavourite(track.id, track.favourite !== true))
          },
          [icon("heart", 16), el("span", { text: track.favourite ? "In your favourites" : "Add to favourites" })]
        ),
        playableOffline(track) ? button({ cls: "om-btn om-btn-quiet", onClick: () => void doAndSay(station(track.id)) }, [
          icon("dj", 16),
          el("span", { text: "Station from this song" })
        ]) : null,
        button({ cls: "om-btn om-btn-quiet", onClick: () => place2.go("library") }, [icon("library", 16), el("span", { text: "Your music" })])
      ])
    ])
  ]);
  void paint(band, track);
  return band;
}
function upNext(state2, place2) {
  const music_ = state2.music;
  const at = music_?.playback.at ?? -1;
  const coming = (music_?.queue ?? []).slice(at + 1, at + 1 + UP_NEXT);
  const all = music_?.queue.length ?? 0;
  const left = Math.max(all - (at + 1) - coming.length, 0);
  return el("section", { cls: "om-np-next" }, [
    el("div", { cls: "om-np-next-head" }, [
      el("h2", { cls: "om-np-sub", text: "Up next" }),
      coming.length > 0 ? button({ cls: "om-btn om-btn-quiet", text: "Clear what is coming next", onClick: () => void doAndSay(queueClear()) }) : null
    ]),
    coming.length === 0 ? says("Nothing is lined up", "Play an album or a playlist, or turn the DJ on, and what is coming next shows here.", {
      label: "Go to your music",
      onClick: () => place2.go("library")
    }) : el(
      "ol",
      { cls: "om-rows" },
      coming.map((one, index) => trackRow(one, { queueAt: at + 1 + index }))
    ),
    left > 0 ? el("p", { cls: "om-np-faint", text: `And ${left} more after these.` }) : null
  ]);
}
registerScreen({
  screen: "playing",
  title: () => "Playing now",
  // The column on the right shows the same cover and the same queue, so having both would be the one list twice.
  wants: { nowPlaying: "hide", wide: true },
  mount: (place2) => {
    addStyles();
    let drawn = "";
    const draw = (state2) => {
      const music_ = state2.music;
      if (!music_) {
        drawn = "none";
        fill(
          place2.into,
          says(
            state2.starting ? "Reading what is playing\u2026" : state2.shut ? "Orbis Music is not open" : "Nothing is playing",
            state2.shut ? "Open the Orbis window and your music connects by itself. Nothing here means your music is gone." : state2.problem ? state2.problem : ""
          )
        );
        return;
      }
      if (music_.playback.owner === "website") {
        drawn = "website";
        fill(
          place2.into,
          el("header", { cls: "om-np-head om-np-head-plain" }, [
            el("p", { cls: "om-np-kicker", text: "Playing on a web page" }),
            el("h1", { cls: "om-np-title", text: "That player belongs to the page" })
          ]),
          says(
            "Orbis leaves it alone",
            "It can work out what the song is and keep the name if you want it, but it never takes over a page\u2019s own player.",
            { label: "See what Orbis noticed", onClick: () => place2.go("noticed") }
          )
        );
        return;
      }
      const track = music_.track;
      if (!track) {
        drawn = "empty";
        fill(place2.into, says("Nothing is playing"), upNext(state2, place2));
        return;
      }
      drawn = `${track.id}|${track.favourite === true}|${music_.playback.queue.join(",")}|${music_.playback.at}`;
      const whyBlock = el("section", { cls: "om-np-whybox" });
      fill(
        place2.into,
        el("div", { cls: "om-np" }, [header(track, place2), el("div", { cls: "om-np-body" }, [factList(track), whyBlock]), upNext(state2, place2)])
      );
      void drawWhy(whyBlock, track.id);
      void want([track.id, ...music_.queue.slice(music_.playback.at + 1, music_.playback.at + 1 + UP_NEXT).map((one) => one.id)]);
    };
    draw(current());
    return {
      onPlayer: (state2) => {
        const music_ = state2.music;
        const key = music_?.track ? `${music_.track.id}|${music_.track.favourite === true}|${music_.playback.queue.join(",")}|${music_.playback.at}` : music_ ? music_.playback.owner === "website" ? "website" : "empty" : "none";
        if (key === drawn) return;
        draw(state2);
      },
      onCovers: () => {
        const state2 = current();
        if (state2.music?.track) draw(state2);
      }
    };
  }
});

// extension-src/music/screens/queue.ts
var GONE_SHOWN = 20;
var COVERS_WANTED = 40;
var PLAY_ALL_LIMIT = 2e3;
function queueScreen(place2) {
  const head = el("div", { cls: "om-q-head" });
  const list = el("div", { cls: "om-q-list" });
  const line = el("div", { cls: "om-q-line", attrs: { "aria-hidden": "true" } });
  fill(place2.into, el("div", { cls: "om-q" }, [head, list]));
  let dragging = null;
  let drawn = "";
  const inList = (clientY) => clientY - list.getBoundingClientRect().top;
  function showLine() {
    if (!dragging) return;
    const at = dragging.edges[dragging.gap];
    if (at === void 0) return;
    line.classList.add("om-on");
    line.style.setProperty("top", `${at}px`);
    if (line.parentElement !== list) list.append(line);
  }
  const movableRows = () => [...list.querySelectorAll(".om-q-row-move")].filter((one) => one instanceof HTMLElement);
  function startDrag(event, from, row) {
    if (!event.isPrimary || event.button !== 0) return;
    const rows = movableRows();
    const top = list.getBoundingClientRect().top;
    const boxes = rows.map((one) => one.getBoundingClientRect());
    const middles = boxes.map((box) => box.top - top + box.height / 2);
    const edges = boxes.map((box) => box.top - top);
    const last = boxes[boxes.length - 1];
    if (last) edges.push(last.bottom - top);
    const positions = rows.map((one) => Number(one.dataset.at));
    const gap = positions.indexOf(from);
    if (gap < 0) return;
    dragging = { from, middles, edges, positions, row, gap };
    row.classList.add("om-q-dragging");
    row.setPointerCapture(event.pointerId);
    showLine();
    event.preventDefault();
  }
  function moveDrag(event) {
    if (!dragging || !(event instanceof PointerEvent)) return;
    const gap = gapNearest(dragging.middles, inList(event.clientY));
    if (gap === dragging.gap) return;
    dragging.gap = gap;
    showLine();
  }
  function endDrag() {
    const held4 = dragging;
    dragging = null;
    line.classList.remove("om-on");
    line.remove();
    if (!held4) return;
    held4.row.classList.remove("om-q-dragging");
    const ids = current().music?.playback.queue ?? [];
    const first = held4.positions[0] ?? 0;
    const to = queueMoveTo(held4.from, first + held4.gap, ids.length);
    if (to === null) {
      drawn = "";
      render(current());
      return;
    }
    void doAndSay(queueReorder(held4.from, to)).then(() => place2.refresh());
  }
  list.addEventListener("pointermove", moveDrag);
  list.addEventListener("pointerup", endDrag);
  list.addEventListener("pointercancel", endDrag);
  const takeOut = (at) => button(
    {
      cls: "om-icon om-icon-sm",
      title: "Take out of what is coming next",
      onClick: () => void doAndSay(queueRemove(at)).then(() => place2.refresh())
    },
    [icon("close", 15)]
  );
  const nudge = (at, by) => button(
    {
      cls: "om-icon om-icon-sm om-q-nudge",
      title: by === -1 ? "Move this earlier" : "Move this later",
      onClick: () => {
        const ids = current().music?.playback.queue ?? [];
        const to = at + by;
        if (to < 0 || to >= ids.length) {
          place2.note(by === -1 ? "That is already next." : "That is already last.");
          return;
        }
        void doAndSay(queueReorder(at, to)).then(() => place2.refresh());
      }
    },
    [icon(by === -1 ? "back" : "forward", 15)]
  );
  function entry(slot, track, kind, at) {
    const movable = kind === "next" && canMove(slot.index, at);
    const node = el("li", {
      cls: `om-q-row om-q-row-${kind}${movable ? " om-q-row-move" : ""}`,
      attrs: { "data-at": String(slot.index) }
    });
    if (!track) {
      node.append(
        el("span", { cls: "om-q-grip om-q-grip-off", attrs: { "aria-hidden": "true" } }),
        el("span", { cls: "om-q-lost" }, [
          el("span", { cls: "om-row-title", text: "A song that is no longer in your music" }),
          el("span", { cls: "om-row-artist", text: "It is still in the running order. Take it out to be rid of it." })
        ]),
        el("span", { cls: "om-row-length", text: "\u2014" }),
        takeOut(slot.index)
      );
      return node;
    }
    const playable = playableOffline(track);
    const why = whyNotPlayable(track);
    const grip = el("span", {
      cls: `om-q-grip${movable ? "" : " om-q-grip-off"}`,
      title: movable ? "Drag to move this up or down" : void 0,
      attrs: { "aria-hidden": "true" }
    });
    if (movable) {
      grip.append(icon("more", 16));
      grip.addEventListener("pointerdown", (event) => {
        if (event instanceof PointerEvent) startDrag(event, slot.index, node);
      });
    }
    node.append(
      grip,
      button(
        {
          cls: "om-q-play",
          title: playable ? `Play ${track.title}` : why ?? "This cannot be played",
          onClick: () => {
            if (!playable) {
              place2.note(why ?? "Orbis has no audio for this track.");
              return;
            }
            const ids = current().music?.playback.queue ?? [];
            if (ids.length === 0 || ids.length > PLAY_ALL_LIMIT) {
              if (ids.length > PLAY_ALL_LIMIT) place2.note("This running order is too long to restart from here, so only this song is playing.");
              void doAndSay(play(track.id)).then(() => place2.refresh());
              return;
            }
            void doAndSay(playAll(ids, slot.index)).then(() => place2.refresh());
          }
        },
        [
          tile({ id: track.id, title: track.title, artist: track.artist, album: track.album }, { size: "md" }),
          el("span", { cls: "om-row-words" }, [
            el("span", { cls: "om-row-title", text: track.title || "No title" }),
            el("span", { cls: "om-row-artist", text: [track.artist, track.album].filter((one) => one).join(" \u2014 ") || "No artist named" })
          ])
        ]
      ),
      why ? el("span", {
        cls: "om-pill om-pill-warn om-q-why",
        text: track.availability === "reference" ? "No audio here" : track.availability === "missing" ? "File missing" : "Cannot be played"
      }) : el("span", { cls: "om-row-gap om-q-why" }),
      el("span", { cls: "om-row-length", text: clockText(track.duration) }),
      button(
        {
          cls: `om-icon om-icon-sm om-q-heart${track.favourite ? " om-on" : ""}`,
          title: track.favourite ? "Take out of favourites" : "Add to favourites",
          onClick: () => void doAndSay(setFavourite(track.id, track.favourite !== true)).then(() => place2.refresh())
        },
        [icon("heart", 15)]
      ),
      movable ? nudge(slot.index, -1) : el("span", { cls: "om-row-gap om-q-nudge" }),
      movable ? nudge(slot.index, 1) : el("span", { cls: "om-row-gap om-q-nudge" }),
      kind === "playing" ? el("span", { cls: "om-q-now", text: "Playing" }) : takeOut(slot.index)
    );
    return node;
  }
  function howMuchIsLeft(count, left) {
    if (count === 0) return "Nothing is lined up after this.";
    const songs = `${countText(count, "song", "songs")} to come`;
    if (left.seconds <= 0) return `${songs}. None of them has a known length.`;
    const how = spanText(left.seconds);
    if (!how) return songs;
    return `${songs}, ${left.unknown > 0 ? "at least " : ""}${how}`;
  }
  function draw(state2) {
    const now2 = state2.music;
    if (!now2) {
      fill(head, el("h1", { cls: "om-q-title", text: "Up next" }));
      fill(
        list,
        says(
          state2.starting ? "Reading what is playing\u2026" : state2.shut ? "Orbis Music is not open" : "Nothing is playing",
          state2.shut ? "Open the Orbis window and it connects by itself." : state2.problem ?? ""
        )
      );
      return;
    }
    if (now2.playback.owner === "website") {
      fill(head, el("h1", { cls: "om-q-title", text: "Up next" }));
      fill(
        list,
        says(
          "A web page is playing, and it keeps its own running order",
          "Orbis can see what that player is doing and leaves it alone. Play something of your own and what comes next shows up here."
        )
      );
      return;
    }
    const ids = now2.playback.queue;
    const byId = new Map(now2.queue.map((one) => [one.id, one]));
    const parts = queueParts(ids, now2.playback.at);
    const left = queueLength(parts.next.map((one) => byId.get(one.trackId)?.duration ?? 0));
    fill(
      head,
      el("div", { cls: "om-q-words" }, [
        el("h1", { cls: "om-q-title", text: "Up next" }),
        el("p", { cls: "om-q-sub", text: howMuchIsLeft(parts.next.length, left) })
      ]),
      el("div", { cls: "om-q-does" }, [
        button({
          cls: "om-btn om-btn-quiet",
          text: "Empty what is coming next",
          attrs: { disabled: parts.next.length === 0 ? true : null },
          onClick: () => void doAndSay(queueClear()).then(() => place2.refresh())
        })
      ])
    );
    const rows = [];
    const gone = parts.gone.slice(-GONE_SHOWN);
    if (gone.length > 0) {
      rows.push(el("li", { cls: "om-q-group", text: gone.length === parts.gone.length ? "Already played" : `Already played (the last ${gone.length})` }));
      for (const slot of gone) rows.push(entry(slot, byId.get(slot.trackId), "gone", now2.playback.at));
    }
    if (parts.playing) {
      rows.push(el("li", { cls: "om-q-group", text: "Playing now" }));
      rows.push(entry(parts.playing, byId.get(parts.playing.trackId), "playing", now2.playback.at));
    }
    rows.push(el("li", { cls: "om-q-group", text: "Coming next" }));
    if (parts.next.length === 0) {
      rows.push(
        el("li", { cls: "om-q-none" }, [
          says("Nothing is lined up", "Add songs with the plus on any row in your music, or start the DJ from Discover and it keeps the queue full.", {
            label: "Go to your music",
            onClick: () => place2.go("library")
          })
        ])
      );
    } else {
      for (const slot of parts.next) rows.push(entry(slot, byId.get(slot.trackId), "next", now2.playback.at));
    }
    fill(list, el("ol", { cls: "om-q-rows" }, rows));
    void want([...parts.playing ? [parts.playing.trackId] : [], ...parts.next.slice(0, COVERS_WANTED).map((one) => one.trackId)]);
  }
  function shape(state2) {
    const now2 = state2.music;
    if (!now2) return ["none", state2.starting, state2.shut, state2.problem ?? ""].join("|");
    return [
      now2.playback.owner,
      now2.playback.at,
      now2.playback.queue.join(","),
      now2.queue.map((one) => `${one.id}:${one.favourite === true}:${one.availability}`).join(",")
    ].join("|");
  }
  function render(state2) {
    if (dragging) return;
    const fresh = shape(state2);
    if (fresh === drawn) return;
    drawn = fresh;
    draw(state2);
  }
  render(current());
  return {
    onPlayer: render,
    onCovers: () => {
      if (dragging) return;
      drawn = "";
      render(current());
    },
    leave: () => endDrag()
  };
}
registerScreen({
  screen: "queue",
  title: () => "Up next",
  // The column on the right lists the same thing, so showing both would put one queue on screen twice.
  wants: { nowPlaying: "hide" },
  mount: queueScreen
});

// src/shared/music/identity.ts
var VERSION_LABELS = {
  original: "",
  remaster: "Remastered",
  live: "Live",
  acoustic: "Acoustic",
  "radio-edit": "Radio edit",
  extended: "Extended",
  remix: "Remix",
  instrumental: "Instrumental",
  clean: "Clean",
  explicit: "Explicit",
  "sped-up": "Sped up",
  slowed: "Slowed",
  demo: "Demo",
  alternate: "Alternate"
};
function versionLabel(version) {
  if (version.kind === "remix" && version.by) return `${version.by} remix`;
  return VERSION_LABELS[version.kind];
}

// src/shared/music/searchScreen.ts
var MAX_RECENT_SEARCHES = 8;
var LONGEST_SEARCH = 300;
function searchable(said) {
  if (typeof said !== "string") return "";
  return said.replace(/\s+/g, " ").trim().slice(0, LONGEST_SEARCH);
}
var worthRemembering = (said) => searchable(said).length >= 2;
function readRecentSearches(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const one of raw) {
    const words = searchable(one);
    if (!words) continue;
    if (out.some((held4) => held4.toLowerCase() === words.toLowerCase())) continue;
    out.push(words);
    if (out.length >= MAX_RECENT_SEARCHES) break;
  }
  return out;
}
function rememberSearch(held4, said) {
  const words = searchable(said);
  if (!worthRemembering(words)) return [...held4];
  const rest = held4.filter((one) => one.toLowerCase() !== words.toLowerCase());
  return [words, ...rest].slice(0, MAX_RECENT_SEARCHES);
}
var plainly2 = (text) => text.toLowerCase().replace(/['‘’ʼ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
function matchesName(name, said) {
  const words = plainly2(searchable(said)).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const flat = plainly2(name);
  return words.every((word) => flat.includes(word));
}
function movePick(current2, count, step) {
  if (count <= 0) return -1;
  if (current2 < 0) return step < 0 ? count - 1 : 0;
  return ((current2 + step) % count + count) % count;
}
function describedWords(described) {
  if (typeof described !== "number" || !Number.isFinite(described) || described <= 0.5) return null;
  return "Read as a description, so Orbis chose from your own music rather than looking up a name.";
}
function notUnderstoodWords(words) {
  if (!Array.isArray(words)) return null;
  const kept2 = words.filter((one) => typeof one === "string" && one.trim() !== "").map((one) => one.trim());
  if (kept2.length === 0) return null;
  return `Orbis could not read: ${kept2.join(", ")}`;
}
function placesWords(asked) {
  if (!Array.isArray(asked)) return [];
  const out = [];
  for (const one of asked) {
    if (!one || typeof one !== "object" || one.ok === true) continue;
    const name = typeof one.name === "string" && one.name.trim() !== "" ? one.name.trim() : "A music source";
    const reason = typeof one.reason === "string" ? one.reason.trim() : "";
    if (one.ready === false) out.push(reason ? `${name}: ${reason}` : `${name} is not set up, so it was not asked.`);
    else out.push(reason ? `${name} could not be asked: ${reason}` : `${name} could not be asked this time.`);
  }
  return out;
}
function nothingFoundWords(said) {
  const words = searchable(said);
  return {
    title: words ? `Nothing in your music matches "${words}"` : "Nothing matches",
    detail: "Orbis searches the music on this computer. Bring some in, or try fewer words."
  };
}
function versionWords(version) {
  if (!version || typeof version !== "object") return "";
  const one = version;
  if (typeof one.kind !== "string") return "";
  return versionLabel(one) || "";
}
function matchingGroups(groups, said, limit = 12) {
  return groups.filter((one) => matchesName(one.name, said) || one.by !== void 0 && matchesName(one.by, said)).slice().sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name)).slice(0, Math.max(0, limit));
}
function biggestGroups(groups, limit = 60) {
  return groups.slice().sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name)).slice(0, Math.max(0, limit));
}

// extension-src/music/screens/search.ts
function bringInStyles() {
  const href = "music-search.css";
  if (document.querySelector(`link[data-om-sheet="search"]`)) return;
  const link = el("link", { attrs: { rel: "stylesheet", href, "data-om-sheet": "search" } });
  document.head.append(link);
}
var RECENT_KEY = "orbis.music.recent-searches";
function readRecent() {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return readRecentSearches(raw === null ? null : JSON.parse(raw));
  } catch {
    return [];
  }
}
function writeRecent(list) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
  }
}
function readFound(value2) {
  const one = value2 ?? {};
  const rows = Array.isArray(one.tracks) ? one.tracks.filter((row) => row && row.canonical) : [];
  const top = one.top && one.top.canonical ? one.top : null;
  const empty = one.empty && typeof one.empty === "object" ? one.empty : null;
  return { top, tracks: rows, empty, asked: one.asked, parsed: one.parsed ?? null };
}
registerScreen({
  screen: "search",
  title: (route2) => searchable(route2.said) ? `Search: ${searchable(route2.said)}` : "Search",
  wants: { nowPlaying: "as-chosen" },
  mount: (place2) => mountSearch(place2)
});
function mountSearch(place2) {
  bringInStyles();
  const held4 = {
    said: searchable(place2.route.said),
    recent: readRecent(),
    albums: null,
    artists: null,
    genres: null,
    playlists: null,
    problem: null,
    shut: false,
    found: null,
    mine: null,
    asking: false,
    token: 0
  };
  const box = el("input", {
    cls: "om-sr-input",
    attrs: {
      type: "search",
      placeholder: "A song, an artist, an album, or what you feel like",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Search your music",
      value: held4.said
    }
  });
  const clearButton = button(
    {
      cls: "om-icon om-icon-sm om-sr-clear",
      title: "Clear the search",
      onClick: () => {
        box.value = "";
        typed("");
        box.focus();
      }
    },
    [icon("close", 15)]
  );
  const results = el("div", { cls: "om-sr-results" });
  const notes = el("div", { cls: "om-sr-notes" });
  const screen = el("div", { cls: "om-sr" }, [el("div", { cls: "om-sr-box" }, [icon("search", 18), box, clearButton]), notes, results]);
  fill(place2.into, screen);
  let timer2 = null;
  function typed(words) {
    const tidy = searchable(words);
    held4.said = tidy;
    place2.replace("search", "", tidy);
    clearButton.classList.toggle("om-sr-clear-on", tidy !== "");
    if (timer2) clearTimeout(timer2);
    if (!tidy) {
      held4.found = null;
      held4.mine = null;
      draw();
      return;
    }
    timer2 = setTimeout(() => void ask2(tidy), 180);
  }
  async function ask2(words) {
    const mine = ++held4.token;
    held4.asking = true;
    const [found, library2] = await Promise.all([find(words, 60), library({ search: words })]);
    if (mine !== held4.token) return;
    held4.asking = false;
    if (found.got) held4.found = readFound(found.value);
    else {
      held4.found = null;
      held4.problem = found.why;
      held4.shut = found.shut;
    }
    if (library2.got) held4.mine = library2.value;
    else {
      held4.mine = null;
      held4.problem = library2.why;
      held4.shut = library2.shut;
    }
    const wanted = (held4.mine ?? []).slice(0, 40).map((one) => one.id);
    if (wanted.length > 0) place2.wantCovers(wanted);
    draw();
  }
  async function readMine() {
    const [albums2, artists2, genres2, playlists2] = await Promise.all([albums(), artists(), genres(), playlists()]);
    for (const answer of [albums2, artists2, genres2, playlists2]) {
      if (!answer.got) {
        held4.problem = answer.why;
        held4.shut = answer.shut;
      }
    }
    if (albums2.got) held4.albums = albums2.value;
    if (artists2.got) held4.artists = artists2.value;
    if (genres2.got) held4.genres = genres2.value;
    if (playlists2.got) held4.playlists = playlists2.value;
    draw();
  }
  function drawNotes() {
    const lines = [];
    const parsed = held4.found?.parsed ?? null;
    const described = describedWords(parsed?.described);
    if (described) lines.push(described);
    const unread = notUnderstoodWords(parsed?.notUnderstood);
    if (unread) lines.push(unread);
    for (const one of placesWords(held4.found?.asked)) lines.push(one);
    fill(notes, ...lines.map((words) => el("p", { cls: "om-sr-note", text: words })));
  }
  function draw() {
    drawNotes();
    if (!held4.said) {
      drawEmptyBox();
      return;
    }
    drawResults();
    markPlaying(current());
  }
  function drawEmptyBox() {
    const parts = [];
    if (held4.recent.length > 0) {
      parts.push(
        el("section", { cls: "om-sr-group" }, [
          el("div", { cls: "om-sr-group-head" }, [
            el("h2", { cls: "om-sr-group-title", text: "Searched lately" }),
            button({
              cls: "om-btn om-btn-quiet",
              text: "Clear",
              title: "Forget every recent search",
              onClick: () => {
                held4.recent = [];
                writeRecent(held4.recent);
                draw();
              }
            })
          ]),
          el(
            "ul",
            { cls: "om-sr-chips" },
            held4.recent.map(
              (words) => el("li", { cls: "om-sr-chip" }, [
                button({
                  cls: "om-sr-chip-go",
                  text: words,
                  attrs: { "data-om-pick": "recent" },
                  onClick: () => {
                    box.value = words;
                    typed(words);
                  }
                }),
                button(
                  {
                    cls: "om-sr-chip-drop",
                    title: `Forget "${words}"`,
                    onClick: () => {
                      held4.recent = held4.recent.filter((one) => one !== words);
                      writeRecent(held4.recent);
                      draw();
                    }
                  },
                  [icon("close", 12)]
                )
              ])
            )
          )
        ])
      );
    }
    const genres2 = held4.genres;
    if (genres2 === null) {
      parts.push(
        el("section", { cls: "om-sr-group" }, [
          el("h2", { cls: "om-sr-group-title", text: "Browse your genres" }),
          says(
            held4.shut ? "Orbis Music is not open" : "Orbis could not read your genres",
            held4.shut ? "Open the Orbis window and your music connects by itself. Nothing here means your music is gone." : held4.problem ?? "Nothing was changed. Try again in a moment.",
            { label: "Try again", onClick: () => void readMine() }
          )
        ])
      );
    } else if (genres2.length === 0) {
      parts.push(
        el("section", { cls: "om-sr-group" }, [
          el("h2", { cls: "om-sr-group-title", text: "Browse your genres" }),
          says("No genres yet", "Genres come off the files themselves. Bring some music in and they appear here.")
        ])
      );
    } else {
      parts.push(
        el("section", { cls: "om-sr-group" }, [
          el("h2", { cls: "om-sr-group-title", text: "Browse your genres" }),
          el("div", { cls: "om-sr-cards" }, biggestGroups(genres2, 60).map((one) => groupCard(one, "genre")))
        ])
      );
    }
    fill(results, ...parts.filter((one) => one !== null));
  }
  function drawResults() {
    const found = held4.found;
    const mine = held4.mine ?? [];
    const parts = [];
    if (found?.top) parts.push(topCard(found.top));
    if (mine.length > 0) {
      const ids = mine.map((one) => one.id);
      const playingId = current().music?.playback.trackId ?? null;
      parts.push(
        el("section", { cls: "om-sr-group" }, [
          el("div", { cls: "om-sr-group-head" }, [
            el("h2", { cls: "om-sr-group-title", text: "Songs" }),
            button({
              cls: "om-btn om-btn-primary",
              text: `Play ${countText(mine.length, "song", "songs")}`,
              onClick: () => void doAndSay(playAll(ids, 0))
            })
          ]),
          el(
            "ul",
            { cls: "om-rows" },
            mine.slice(0, 60).map((track, index) => {
              const row = trackRow(track, { playing: track.id === playingId, onPlay: () => void doAndSay(playAll(ids, index)) });
              const play2 = row.querySelector(".om-row-play");
              if (play2) play2.setAttribute("data-om-pick", "track");
              row.setAttribute("data-om-track", track.id);
              return row;
            })
          )
        ])
      );
    }
    const already = new Set(mine.map((one) => one.id));
    const elsewhere = (found?.tracks ?? []).filter((row) => !(row.libraryId !== null && already.has(row.libraryId)));
    if (elsewhere.length > 0) {
      parts.push(
        el("section", { cls: "om-sr-group" }, [
          el("h2", { cls: "om-sr-group-title", text: "Also found" }),
          el("ul", { cls: "om-sr-rows" }, elsewhere.slice(0, 40).map((row) => foundRow(row)))
        ])
      );
    }
    const artists2 = matchingGroups(held4.artists ?? [], held4.said);
    if (artists2.length > 0) parts.push(cardGroup("Artists", artists2, "artist"));
    const albums2 = matchingGroups(held4.albums ?? [], held4.said);
    if (albums2.length > 0) parts.push(cardGroup("Albums", albums2, "album"));
    const genres2 = matchingGroups(held4.genres ?? [], held4.said);
    if (genres2.length > 0) parts.push(cardGroup("Genres", genres2, "genre"));
    const lists = (held4.playlists ?? []).filter((one) => matchesName(one.name, held4.said)).slice(0, 12);
    if (lists.length > 0) {
      parts.push(
        el("section", { cls: "om-sr-group" }, [
          el("h2", { cls: "om-sr-group-title", text: "Playlists" }),
          el(
            "ul",
            { cls: "om-sr-rows" },
            lists.map(
              (list) => el("li", { cls: "om-sr-row" }, [
                button(
                  {
                    cls: "om-sr-row-go",
                    attrs: { "data-om-pick": "playlist" },
                    onClick: () => {
                      remember();
                      place2.go("playlist", list.id);
                    }
                  },
                  [
                    tile({ title: list.name }, { size: "md" }),
                    el("span", { cls: "om-sr-row-words" }, [
                      el("span", { cls: "om-sr-row-title", text: list.name }),
                      el("span", {
                        cls: "om-sr-row-sub",
                        text: list.rule ? "Worked out from your music" : countText(list.tracks.length, "song", "songs")
                      })
                    ])
                  ]
                ),
                button({ cls: "om-icon om-icon-sm", title: `Play ${list.name}`, onClick: () => void doAndSay(playPlaylist(list.id)) }, [icon("play", 15)])
              ])
            )
          )
        ])
      );
    }
    if (parts.length === 0) {
      if (held4.asking) fill(results, says("Looking\u2026"));
      else if (held4.found === null && held4.problem !== null)
        fill(
          results,
          says(
            held4.shut ? "Orbis Music is not open" : "Orbis could not search",
            held4.shut ? "Open the Orbis window and your music connects by itself." : held4.problem,
            { label: "Try again", onClick: () => void ask2(held4.said) }
          )
        );
      else if (found?.empty) fill(results, says(found.empty.title, found.empty.detail, found.empty.retry ? { label: "Try again", onClick: () => void ask2(held4.said) } : void 0));
      else {
        const words = nothingFoundWords(held4.said);
        fill(results, says(words.title, words.detail));
      }
      return;
    }
    fill(results, ...parts);
  }
  function topCard(row) {
    const version = versionWords(row.canonical.version);
    const canPlay = row.playable && row.libraryId !== null;
    return el("section", { cls: "om-sr-group" }, [
      el("h2", { cls: "om-sr-group-title", text: "Top result" }),
      el("div", { cls: "om-sr-top" }, [
        tile(
          { id: row.libraryId ?? void 0, title: row.canonical.name || row.canonical.title, artist: row.canonical.artist, album: row.canonical.album ?? "" },
          { size: "xl" }
        ),
        el("div", { cls: "om-sr-top-words" }, [
          el("p", { cls: "om-sr-top-kind", text: "Song" }),
          el("h3", { cls: "om-sr-top-title" }, [
            el("span", { text: row.canonical.name || row.canonical.title }),
            version ? el("span", { cls: "om-pill om-sr-version", text: version }) : null
          ]),
          el("p", { cls: "om-sr-top-artist", text: [row.canonical.artist, row.canonical.album].filter((one) => one).join(" \u2014 ") || "No artist named" }),
          el("div", { cls: "om-sr-top-pills" }, [
            row.inLibrary ? el("span", { cls: "om-pill", text: "In your music" }) : null,
            row.playable ? null : el("span", { cls: "om-pill om-pill-warn", text: "No audio here" }),
            row.plays > 0 ? el("span", { cls: "om-pill", text: countText(row.plays, "play", "plays") }) : null
          ]),
          el("div", { cls: "om-sr-top-does" }, [
            button({
              cls: "om-btn om-btn-primary",
              text: canPlay ? "Play" : "Cannot be played",
              attrs: { "data-om-pick": "top", disabled: canPlay ? null : true },
              title: canPlay ? void 0 : "Orbis knows this song but has no audio for it on this computer.",
              onClick: () => {
                if (!canPlay || row.libraryId === null) return;
                remember();
                void doAndSay(play(row.libraryId));
              }
            }),
            row.libraryId !== null ? button({
              cls: "om-btn",
              text: "Play next",
              onClick: () => void doAndSay(queueNext([row.libraryId]))
            }) : null
          ])
        ])
      ])
    ]);
  }
  function foundRow(row) {
    const version = versionWords(row.canonical.version);
    const canPlay = row.playable && row.libraryId !== null;
    const length = row.canonical.duration === null ? clockText(0) : clockText(row.canonical.duration);
    return el("li", { cls: `om-sr-row${canPlay ? "" : " om-sr-row-off"}` }, [
      button(
        {
          cls: "om-sr-row-go",
          attrs: { "data-om-pick": "found" },
          title: canPlay ? `Play ${row.canonical.title}` : "Orbis knows this song but has no audio for it on this computer.",
          onClick: () => {
            if (!canPlay || row.libraryId === null) {
              place2.note("Orbis knows this song but has no audio for it on this computer. Import your own copy to play it here.");
              return;
            }
            remember();
            void doAndSay(play(row.libraryId));
          }
        },
        [
          tile(
            { id: row.libraryId ?? void 0, title: row.canonical.name || row.canonical.title, artist: row.canonical.artist, album: row.canonical.album ?? "" },
            { size: "md" }
          ),
          el("span", { cls: "om-sr-row-words" }, [
            el("span", { cls: "om-sr-row-title" }, [
              el("span", { text: row.canonical.name || row.canonical.title }),
              version ? el("span", { cls: "om-pill om-sr-version", text: version }) : null
            ]),
            el("span", { cls: "om-sr-row-sub", text: [row.canonical.artist, row.canonical.album].filter((one) => one).join(" \u2014 ") || "No artist named" })
          ])
        ]
      ),
      row.inLibrary ? el("span", { cls: "om-pill", text: "In your music" }) : el("span", { cls: "om-pill om-pill-warn", text: "No audio here" }),
      el("span", { cls: "om-sr-row-length", text: length })
    ]);
  }
  function cardGroup(title, groups, screen2) {
    return el("section", { cls: "om-sr-group" }, [
      el("h2", { cls: "om-sr-group-title", text: title }),
      el("div", { cls: "om-sr-cards" }, groups.map((one) => groupCard(one, screen2)))
    ]);
  }
  function groupCard(group, screen2) {
    const ids = group.tracks.map((one) => one.id);
    const first = group.tracks[0];
    return el("div", { cls: "om-sr-card" }, [
      button(
        {
          cls: "om-sr-card-go",
          attrs: { "data-om-pick": screen2 },
          title: `Open ${group.name}`,
          onClick: () => {
            remember();
            place2.go(screen2, group.name);
          }
        },
        [
          el("span", { cls: `om-sr-card-art${screen2 === "artist" ? " om-sr-card-round" : ""}` }, [
            tile({ id: first?.id, title: group.name, artist: group.by ?? "", album: screen2 === "album" ? group.name : "" }, { size: "lg", round: screen2 === "artist" })
          ]),
          el("span", { cls: "om-sr-card-name", text: group.name }),
          el("span", {
            cls: "om-sr-card-sub",
            text: screen2 === "album" && group.by ? group.by : countText(group.tracks.length, "song", "songs")
          })
        ]
      ),
      button(
        {
          cls: "om-sr-card-play",
          title: `Play ${group.name}`,
          onClick: () => {
            remember();
            void doAndSay(playAll(ids, 0));
          }
        },
        [icon("play", 16)]
      )
    ]);
  }
  const picks = () => [...screen.querySelectorAll("[data-om-pick]")].filter((one) => !one.hasAttribute("disabled"));
  function step(from, direction) {
    const all = picks();
    if (all.length === 0) return;
    const at = from ? all.indexOf(from) : -1;
    const next2 = movePick(at, all.length, direction);
    if (next2 >= 0) all[next2]?.focus();
  }
  screen.addEventListener("keydown", (event) => {
    const key = event.key;
    const where = event.target;
    if (where === box) {
      if (key === "ArrowDown") {
        event.preventDefault();
        step(null, 1);
      } else if (key === "Enter") {
        event.preventDefault();
        remember();
        step(null, 1);
      } else if (key === "Escape" && box.value !== "") {
        event.preventDefault();
        box.value = "";
        typed("");
      }
      return;
    }
    if (!where || !where.hasAttribute("data-om-pick")) return;
    if (key === "ArrowDown") {
      event.preventDefault();
      step(where, 1);
    } else if (key === "ArrowUp") {
      event.preventDefault();
      step(where, -1);
    } else if (key === "Home") {
      event.preventDefault();
      picks()[0]?.focus();
    } else if (key === "End") {
      event.preventDefault();
      const all = picks();
      all[all.length - 1]?.focus();
    } else if (key === "Escape") {
      event.preventDefault();
      box.focus();
    }
  });
  function remember() {
    const next2 = rememberSearch(held4.recent, held4.said);
    if (next2.length === held4.recent.length && next2[0] === held4.recent[0]) return;
    held4.recent = next2;
    writeRecent(next2);
  }
  box.addEventListener("input", () => typed(box.value));
  const stopWatchingRoute = onRoute((now2) => {
    if (now2.screen !== "search") return;
    const words = searchable(now2.said);
    if (words === held4.said) return;
    box.value = words;
    held4.said = words;
    clearButton.classList.toggle("om-sr-clear-on", words !== "");
    if (timer2) clearTimeout(timer2);
    if (words) void ask2(words);
    else {
      held4.found = null;
      held4.mine = null;
      draw();
    }
  });
  clearButton.classList.toggle("om-sr-clear-on", held4.said !== "");
  void readMine();
  if (held4.said) void ask2(held4.said);
  else draw();
  box.focus();
  function markPlaying(state2) {
    const playingId = state2.music?.playback.trackId ?? null;
    for (const row of screen.querySelectorAll("[data-om-track]")) {
      row.classList.toggle("om-row-now", row.getAttribute("data-om-track") === playingId);
    }
  }
  return {
    onPlayer: (state2) => markPlaying(state2),
    onCovers: () => {
      for (const square of screen.querySelectorAll(".om-tile:not(.om-tile-has)")) {
        const row = square.closest("[data-om-track]");
        const id = row?.getAttribute("data-om-track");
        const picture = coverFor(id ?? void 0);
        if (!picture) continue;
        square.classList.add("om-tile-has");
        fill(square, el("img", { cls: "om-tile-img", attrs: { src: picture, alt: "", decoding: "async" } }));
      }
    },
    leave: () => {
      if (timer2) clearTimeout(timer2);
      stopWatchingRoute();
      held4.token += 1;
    }
  };
}

// extension-src/music/screens/settings.ts
var RECOGNITION = [
  { id: "automatic", label: "While I browse", blurb: "Orbis works out what a page is playing as it happens." },
  { id: "manual", label: "Only when I ask", blurb: "Nothing is worked out until you press Look again." },
  { id: "off", label: "Never", blurb: "Orbis does not try to name what a page is playing." }
];
var VIEWS = [
  { id: "songs", label: "Songs" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "genres", label: "Genres" },
  { id: "playlists", label: "Playlists" },
  { id: "favourites", label: "Favourites" }
];
var SORTS = [
  { id: "added", label: "When added" },
  { id: "title", label: "Title" },
  { id: "artist", label: "Artist" },
  { id: "album", label: "Album" },
  { id: "played", label: "Last played" },
  { id: "plays", label: "Most played" },
  { id: "duration", label: "Length" },
  { id: "year", label: "Year" }
];
registerScreen({
  screen: "settings",
  title: () => "Settings",
  mount: (place2) => {
    const into2 = el("div", { cls: "om-own-slot" }, [reading("settings")]);
    const clearing = el("div", { cls: "om-own-slot" });
    async function change(patch) {
      const answer = await saveSettings(patch);
      if (!answer.got) {
        place2.note(answer.why);
        return;
      }
      draw(answer.value);
      place2.refresh();
    }
    function draw(held4) {
      fill(
        into2,
        card("", [
          choices({
            label: "Work out what a page is playing",
            detail: "Orbis asks the page what it is playing. It never touches the page or its player.",
            items: RECOGNITION,
            chosen: held4.recognition,
            onPick: (id) => void change({ recognition: id })
          }),
          toggleRow({
            label: "Read the player on screen when a page does not say",
            detail: "Orbis looks at the tab it is playing in, asks once, and keeps nothing. With this off it only ever uses what the page itself announces.",
            on: held4.useVision === true,
            onChange: (on) => void change({ useVision: on })
          }),
          toggleRow({
            label: "Carry on from where a song was left",
            detail: "Where you stopped is written down as you listen, so it survives the computer being shut.",
            on: held4.resume === true,
            onChange: (on) => void change({ resume: on })
          }),
          toggleRow({
            label: "Start playing when Orbis opens",
            detail: "Off unless you ask for it.",
            on: held4.playOnStart === true,
            onChange: (on) => void change({ playOnStart: on })
          }),
          toggleRow({
            label: "Show the music button in the browser",
            detail: "The button that opens your music from the browser itself.",
            on: held4.showButton === true,
            onChange: (on) => void change({ showButton: on })
          }),
          choices({
            label: "The small player",
            detail: "How much the player shows when it is not the whole screen.",
            items: [
              { id: "compact", label: "Compact", blurb: "The song and the three buttons." },
              { id: "full", label: "Full", blurb: "The cover, the bar and everything else." }
            ],
            chosen: held4.miniPlayer,
            onPick: (id) => void change({ miniPlayer: id })
          }),
          choices({
            label: "Open your music at",
            detail: "Which part of your music is showing when you open it.",
            items: VIEWS,
            chosen: held4.view,
            onPick: (id) => void change({ view: id })
          }),
          choices({
            label: "Sort your songs by",
            detail: "Kept, so your music opens the way you left it.",
            items: SORTS,
            chosen: held4.sort ?? "added",
            onPick: (id) => void change({ sort: id })
          }),
          el("div", { cls: "om-own-row" }, [
            el("div", { cls: "om-own-row-words" }, [
              el("span", {
                cls: "om-own-row-label",
                text: (held4.folders ?? []).length === 0 ? "No folders are being watched" : `${countText(held4.folders.length, "folder", "folders")} watched`
              }),
              el("span", { cls: "om-own-row-detail", text: "Which folders they are is not shown here: a browser page is never told where your files live." })
            ]),
            press("Watch another", () => void watchFolder().then((answer) => place2.note(answer.got ? "The Orbis window is asking you to choose." : answer.why)), "quiet", "folder")
          ])
        ])
      );
    }
    function drawClearing() {
      fill(
        clearing,
        card("", [
          el("div", { cls: "om-own-row" }, [
            el("div", { cls: "om-own-row-words" }, [
              el("span", { cls: "om-own-row-label", text: "What you have played" }),
              el("span", {
                cls: "om-own-row-detail",
                text: 'The list of plays behind "your listening". Your songs and playlists stay, and so do their play counts.'
              })
            ]),
            carefulPress("Forget what I have played", "Press again to forget it.", () => void done(run("clear-history")))
          ]),
          el("div", { cls: "om-own-row" }, [
            el("div", { cls: "om-own-row-words" }, [
              el("span", { cls: "om-own-row-label", text: "Songs noticed while browsing" }),
              el("span", { cls: "om-own-row-detail", text: "Only the list of names. Anything you chose to keep stays in your music." })
            ]),
            carefulPress("Forget that list", "Press again to forget it.", () => void done(run("clear-recognised")))
          ])
        ])
      );
    }
    async function done(doing) {
      const answer = await doing;
      place2.note(answer.got ? "Done." : answer.why);
    }
    async function load() {
      const answer = await settings();
      const got = unwrap(answer, "settings");
      if ("problem" in got) fill(into2, got.problem);
      else draw(got.value);
    }
    fill(
      place2.into,
      screenHead("Settings", "Every change here is read back from Orbis, so nothing on this screen can be showing something that did not happen."),
      block("How Orbis listens", "What it may work out, and how.", [into2]),
      block("Clearing things", "Each of these says exactly what it throws away. Neither can be undone.", [clearing])
    );
    drawClearing();
    void load();
    return {};
  },
  wants: { nowPlaying: "as-chosen" }
});

// extension-src/music/screens/tidy.ts
registerScreen({
  screen: "tidy",
  title: () => "Export and tidy",
  // Wide, and no column on the right: the duplicate groups are rows of songs and want the whole width.
  wants: { nowPlaying: "hide", wide: true },
  mount: (place2) => mountTidy(place2)
});
function mountTidy(place2) {
  const exports = el("div", { cls: "om-own-slot" });
  const dupes = el("div", { cls: "om-own-slot om-tidy-dupes" });
  fill(
    place2.into,
    screenHead("Export and tidy", "A copy of what Orbis knows about your music, and the songs it thinks you have twice."),
    block("Save a copy", "Names and playlists, as a file you keep. Where your files are on this computer is never written into it.", [exports]),
    block("Songs you may have twice", "Grouped by title, artist and length. Nothing here is removed: which copy to keep is yours to decide.", [dupes])
  );
  function save(name, text) {
    const file = new Blob([text], { type: name.endsWith(".m3u") ? "audio/x-mpegurl" : "application/json" });
    const at = URL.createObjectURL(file);
    const link = el("a", { attrs: { href: at, download: name } });
    link.click();
    URL.revokeObjectURL(at);
    place2.note(`Saved as ${name}.`);
  }
  async function exportNow(op, a) {
    const answer = await run(op, a);
    if (!answer.got) {
      place2.note(answer.why);
      return;
    }
    const value2 = answer.value;
    if (!value2 || value2.ok !== true || typeof value2.name !== "string" || typeof value2.text !== "string") {
      place2.note(value2?.why?.trim() || "Orbis could not make that file.");
      return;
    }
    save(value2.name, value2.text);
  }
  function drawExports(lists) {
    fill(
      exports,
      el("div", { cls: "om-own-row" }, [
        el("div", { cls: "om-own-row-words" }, [
          el("span", { cls: "om-own-row-label", text: "Everything Orbis knows" }),
          el("span", { cls: "om-own-row-detail", text: "Every song, with its names, length, genre, year and how often it has been played." })
        ]),
        press("Save as a file", () => void exportNow("export", "library"), "primary", "file")
      ]),
      el("div", { cls: "om-own-row" }, [
        el("div", { cls: "om-own-row-words" }, [
          el("span", { cls: "om-own-row-label", text: "Your playlists" }),
          el("span", {
            cls: "om-own-row-detail",
            text: "Every playlist with the songs in it. A playlist worked out from your library is saved as the question it asks, not as the answer it gave today."
          })
        ]),
        press("Save as a file", () => void exportNow("export", "playlists"), "normal", "file")
      ]),
      // An .m3u is per playlist, because that is what the operation takes: it is the format other music players read.
      lists === null ? reading("playlists") : lists.length === 0 ? el("p", { cls: "om-own-row-detail", text: "No playlists to save as an .m3u yet." }) : el("div", { cls: "om-own-row om-own-row-stack" }, [
        el("div", { cls: "om-own-row-words" }, [
          el("span", { cls: "om-own-row-label", text: "One playlist, for another music player" }),
          el("span", { cls: "om-own-row-detail", text: "An .m3u file, which most other music players can open. File names only, never where they are." })
        ]),
        el(
          "div",
          { cls: "om-own-choices" },
          lists.map((list) => press(list.name, () => void exportNow("export-m3u", list.id), "quiet"))
        )
      ])
    );
  }
  function dupeGroup(group) {
    const first = group[0];
    return el("div", { cls: "om-tidy-group" }, [
      el("p", { cls: "om-tidy-group-head", text: `${first.title || "No title"} \u2014 ${first.artist || "No artist named"} \xB7 ${clockText(first.duration)}` }),
      el(
        "ul",
        { cls: "om-rows" },
        group.map(
          (track) => el("li", { cls: "om-row om-tidy-copy" }, [
            el("span", { cls: "om-row-words" }, [
              el("span", { cls: "om-row-title", text: track.album.trim() || "No album named" }),
              // What Orbis actually has of this copy, in the same three words the rest of the page uses, so a
              // reference is never mistaken for a second file somebody could delete.
              el("span", {
                cls: "om-row-artist",
                text: track.availability === "reference" ? "Orbis knows this one by name only \u2014 there is no file to remove" : track.availability === "missing" ? "The file is not where it was" : "A file on this computer"
              })
            ]),
            track.album.trim() !== "" ? (
              // The album screen is addressed by a key made of the name and the artist together, not by the name:
              // two different records share a title often enough that sending only the name would open the wrong one.
              button(
                { cls: "om-btn om-btn-quiet", onClick: () => place2.go("album", albumKey(track.album.trim(), track.albumArtist?.trim() || track.artist.trim())) },
                [el("span", { text: "Open the album" })]
              )
            ) : el("span", { cls: "om-row-gap" })
          ])
        )
      )
    ]);
  }
  async function load() {
    fill(dupes, reading("music"));
    drawExports(null);
    const lists = await playlists();
    const gotLists = unwrap(lists, "playlists");
    drawExports("value" in gotLists ? gotLists.value : []);
    if ("problem" in gotLists) exports.append(gotLists.problem);
    const found = await run("duplicates");
    const got = unwrap(found, "music");
    if ("problem" in got) {
      fill(dupes, got.problem);
      return;
    }
    if (got.value.length === 0) {
      fill(dupes, says("Nothing looks duplicated", "No two songs in your music share a title, an artist and a length."));
      return;
    }
    fill(
      dupes,
      el("p", {
        cls: "om-own-row-detail",
        text: `${countText(got.value.length, "group", "groups")} of songs that look like the same recording.`
      }),
      ...got.value.map((group) => dupeGroup(group))
    );
  }
  void load();
  return {};
}

// src/shared/music/actions.ts
function trackMenu(track, where = {}) {
  const playable = playableOffline(track);
  const why = whyNotPlayable(track) ?? "Orbis has no audio for this track.";
  const items = [
    { id: "play", label: "Play", ...playable ? {} : { off: true, why } },
    { id: "play-next", label: "Play next", ...playable ? {} : { off: true, why } },
    { id: "queue-end", label: "Add to what is coming next", ...playable ? {} : { off: true, why } }
  ];
  if (where.queueAt !== void 0) items.push({ id: "queue-remove", label: "Take out of what is coming next" });
  items.push({ id: "add-to-playlist", label: "Add to a playlist", line: true });
  items.push(
    track.favourite === true ? { id: "unfavourite", label: "Take out of favourites" } : { id: "favourite", label: "Add to favourites" }
  );
  if (where.playlistId !== void 0) {
    items.push(
      where.playlistWorkedOut === true ? {
        id: "playlist-remove",
        label: "Take out of this playlist",
        off: true,
        why: "This playlist is worked out from your music, so songs cannot be taken out of it by hand."
      } : { id: "playlist-remove", label: "Take out of this playlist" }
    );
  }
  if (track.album) items.push({ id: "go-album", label: "Go to the album", line: true });
  if (track.artist) items.push({ id: "go-artist", label: "Go to the artist", ...track.album ? {} : { line: true } });
  return items;
}
function groupMenu(kind, has) {
  const none = has.playable === 0;
  const why = "None of these songs has audio on this computer.";
  const play2 = kind === "album" ? "play-album" : "play-artist";
  const queue = kind === "album" ? "queue-album" : "queue-artist";
  return [
    { id: play2, label: "Play", ...none ? { off: true, why } : {} },
    { id: queue, label: "Add to what is coming next", ...none ? { off: true, why } : {} },
    { id: "add-to-playlist", label: "Add to a playlist", line: true }
  ];
}
function playlistMenu(list) {
  const empty = list.rule === void 0 && list.count === 0;
  const why = "There are no songs in this playlist yet.";
  return [
    { id: "play-playlist", label: "Play", ...empty ? { off: true, why } : {} },
    { id: "queue-playlist", label: "Add to what is coming next", ...empty ? { off: true, why } : {} },
    { id: "rename-playlist", label: "Rename", line: true },
    { id: "remove-playlist", label: "Remove this playlist" }
  ];
}
var SEEK_STEP = 5;
var SEEK_JUMP = 30;
var VOLUME_STEP = 0.05;
var SHORTCUTS = Object.freeze([
  {
    id: "play-pause",
    keys: ["Space"],
    does: "Play, or pause",
    group: "Playing",
    match: [{ key: " " }]
  },
  {
    id: "back-a-bit",
    keys: ["Left arrow"],
    does: `Back ${SEEK_STEP} seconds`,
    group: "Playing",
    match: [{ key: "ArrowLeft" }]
  },
  {
    id: "on-a-bit",
    keys: ["Right arrow"],
    does: `On ${SEEK_STEP} seconds`,
    group: "Playing",
    match: [{ key: "ArrowRight" }]
  },
  {
    id: "back-a-lot",
    keys: ["Shift + left arrow"],
    does: `Back ${SEEK_JUMP} seconds`,
    group: "Playing",
    match: [{ key: "ArrowLeft", shiftKey: true }]
  },
  {
    id: "on-a-lot",
    keys: ["Shift + right arrow"],
    does: `On ${SEEK_JUMP} seconds`,
    group: "Playing",
    match: [{ key: "ArrowRight", shiftKey: true }]
  },
  {
    id: "next",
    keys: ["N", "Next track key"],
    does: "The next song",
    group: "Playing",
    match: [{ key: "n" }, { key: "MediaTrackNext" }]
  },
  {
    id: "previous",
    keys: ["P", "Previous track key"],
    does: "The song before",
    group: "Playing",
    match: [{ key: "p" }, { key: "MediaTrackPrevious" }]
  },
  {
    id: "shuffle",
    keys: ["S"],
    does: "Shuffle on or off",
    group: "Playing",
    match: [{ key: "s" }]
  },
  {
    id: "repeat",
    keys: ["R"],
    does: "Repeat: off, then everything, then this one",
    group: "Playing",
    match: [{ key: "r" }]
  },
  {
    id: "favourite",
    keys: ["F"],
    does: "Favourite what is playing, or take it out again",
    group: "Playing",
    match: [{ key: "f" }]
  },
  {
    id: "louder",
    keys: ["Up arrow"],
    does: "Louder",
    group: "The sound",
    match: [{ key: "ArrowUp" }]
  },
  {
    id: "quieter",
    keys: ["Down arrow"],
    does: "Quieter",
    group: "The sound",
    match: [{ key: "ArrowDown" }]
  },
  {
    id: "mute",
    keys: ["M"],
    does: "Mute, or turn the sound back on",
    group: "The sound",
    match: [{ key: "m" }]
  },
  {
    id: "search",
    keys: ["/"],
    does: "Search your music",
    group: "This page",
    match: [{ key: "/" }]
  },
  {
    id: "sheet",
    keys: ["?"],
    does: "Show this list",
    group: "This page",
    match: [{ key: "?" }, { key: "/", shiftKey: true }]
  }
]);
function shortcutFor(press2) {
  if (press2.ctrlKey === true || press2.altKey === true || press2.metaKey === true) return null;
  const shift = press2.shiftKey === true;
  for (const shortcut of SHORTCUTS) {
    for (const want2 of shortcut.match) {
      if (want2.shiftKey === true !== shift) continue;
      if (want2.key.length === 1 && press2.key.length === 1) {
        if (want2.key.toLowerCase() === press2.key.toLowerCase()) return shortcut;
        continue;
      }
      if (want2.key === press2.key) return shortcut;
    }
  }
  return null;
}
function shortcutSheet() {
  const order = ["Playing", "The sound", "This page"];
  return order.map((group) => ({
    group,
    rows: SHORTCUTS.filter((one) => one.group === group).map((one) => ({ keys: one.keys, does: one.does }))
  })).filter((one) => one.rows.length > 0);
}
function canDropOnPlaylist(dragged, list) {
  if (dragged.trackIds.length === 0) return { ok: false, why: "Nothing was dragged." };
  if (list.rule !== void 0) return { ok: false, why: "This playlist is worked out from your music, so songs cannot be put into it by hand." };
  return { ok: true };
}
function canDropOnQueue(tracks) {
  if (tracks.length === 0) return { ok: false, why: "Nothing was dragged." };
  const playable = tracks.filter((one) => playableOffline(one));
  if (playable.length === 0) {
    return { ok: false, why: tracks.length === 1 ? whyNotPlayable(tracks[0]) ?? "Orbis has no audio for that track." : "None of those songs has audio on this computer." };
  }
  return { ok: true };
}
function moveTarget(from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) return null;
  const landing = to > from ? to - 1 : to;
  if (landing === from) return null;
  return landing;
}

// extension-src/music/drag.ts
var SONGS = "application/x-orbis-music-songs";
var carried = null;
var titles = (tracks) => tracks.map((one) => [one.artist, one.title].filter((word) => word).join(" - ")).join("\n");
function pickUp(event) {
  const found = markedAt(event.target);
  if (!found || found.what.kind !== "track") return;
  const track = found.what.track;
  carried = { tracks: [track], fromQueueAt: found.what.where.queueAt };
  const moving = event.dataTransfer;
  if (!moving) return;
  moving.effectAllowed = "copyMove";
  moving.setData(SONGS, JSON.stringify([track.id]));
  moving.setData("text/plain", titles([track]));
  found.node.classList.add("om-dragging");
}
function putDown() {
  carried = null;
  for (const node of document.querySelectorAll(".om-dragging")) node.classList.remove("om-dragging");
  for (const node of document.querySelectorAll(".om-drop-on, .om-drop-no, .om-drop-above, .om-drop-below")) {
    node.classList.remove("om-drop-on", "om-drop-no", "om-drop-above", "om-drop-below");
  }
}
var ours = (event) => carried !== null && event.dataTransfer?.types.includes(SONGS) === true;
function playlistUnder(event) {
  const found = markedAt(event.target);
  if (!found || found.what.kind !== "playlist") return null;
  return { node: found.node, list: found.what.list };
}
async function dropOnPlaylist(list, tracks) {
  const ids = tracks.map((one) => one.id);
  const allowed = canDropOnPlaylist({ trackIds: ids }, list);
  if (!allowed.ok) {
    note(allowed.why);
    return;
  }
  const answer = await addToPlaylist(list.id, ids);
  playlistsChanged();
  if (!answer.got) {
    note(answer.shut ? "Orbis Music is not open, so nothing was added." : answer.why);
    return;
  }
  if (answer.value === null) {
    note(`Orbis Music did not add anything to ${list.name}.`);
    return;
  }
  note(ids.length === 1 ? `Added to ${list.name}.` : `${ids.length} songs added to ${list.name}.`);
}
function queueIndexOf(row) {
  const list = row.parentElement;
  if (!list) return null;
  const rows = [...list.children];
  const at = rows.indexOf(row);
  if (at < 0) return null;
  const playing = current().music?.playback.at;
  if (playing === void 0) return null;
  return playing + 1 + at;
}
async function dropOnQueue(event, hand) {
  const row = (event.target instanceof Element ? event.target : null)?.closest(".om-col-queue-row") ?? null;
  const toTheTop = row !== null && isTopHalf(event, row);
  if (hand.fromQueueAt !== void 0 && row) {
    const over = queueIndexOf(row);
    if (over === null) {
      note("Orbis could not work out where that was being moved to.");
      return;
    }
    const landing = moveTarget(hand.fromQueueAt, toTheTop ? over : over + 1);
    if (landing === null) return;
    await doAndSay(queueReorder(hand.fromQueueAt, landing));
    return;
  }
  const allowed = canDropOnQueue(hand.tracks);
  if (!allowed.ok) {
    note(allowed.why);
    return;
  }
  const ids = hand.tracks.filter((one) => playableOffline(one)).map((one) => one.id);
  if (toTheTop) {
    await doAndSay(queueNext(ids));
    note(ids.length === 1 ? "Playing next." : `${ids.length} songs playing next.`);
    return;
  }
  await doAndSay(queueEnd(ids));
  note(ids.length === 1 ? "Added to the end of what is coming next." : `${ids.length} songs added to the end of what is coming next.`);
}
function isTopHalf(event, row) {
  const box = row.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2;
}
function startDragging() {
  addEventListener("dragstart", pickUp);
  addEventListener("dragend", () => putDown());
  addEventListener("dragover", (event) => {
    if (!ours(event)) return;
    const hand = carried;
    if (!hand) return;
    const onto = placeUnder(event);
    if (!onto) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = hand.fromQueueAt !== void 0 && onto.kind === "queue" ? "move" : "copy";
    onto.node.classList.add(onto.allowed ? "om-drop-on" : "om-drop-no");
  });
  addEventListener("dragleave", (event) => {
    const onto = placeUnder(event);
    onto?.node.classList.remove("om-drop-on", "om-drop-no");
  });
  addEventListener("drop", (event) => {
    if (!ours(event)) return;
    const hand = carried;
    const onto = placeUnder(event);
    if (!hand || !onto) return;
    event.preventDefault();
    onto.node.classList.remove("om-drop-on", "om-drop-no");
    if (onto.kind === "playlist" && onto.list) void dropOnPlaylist(onto.list, hand.tracks);
    else if (onto.kind === "queue") void dropOnQueue(event, hand);
    carried = null;
  });
}
function placeUnder(event) {
  const hand = carried;
  if (!hand) return null;
  const playlist = playlistUnder(event);
  if (playlist) {
    return { kind: "playlist", node: playlist.node, allowed: canDropOnPlaylist({ trackIds: hand.tracks.map((one) => one.id) }, playlist.list).ok, list: playlist.list };
  }
  const target = event.target instanceof Element ? event.target : null;
  const column = target?.closest(".om-col-queue, .om-column");
  if (column instanceof HTMLElement) {
    const allowed = hand.fromQueueAt !== void 0 || canDropOnQueue(hand.tracks).ok;
    return { kind: "queue", node: column, allowed };
  }
  return null;
}

// extension-src/music/menu.ts
var open = null;
function closeMenu() {
  if (!open) return;
  const back2 = open.cameFrom;
  open.root.remove();
  open = null;
  if (back2 instanceof HTMLElement && document.contains(back2)) back2.focus();
}
function place(root2, at) {
  root2.style.left = "0px";
  root2.style.top = "0px";
  const size = root2.getBoundingClientRect();
  const x = Math.max(8, Math.min(at.x, innerWidth - size.width - 8));
  const y = Math.max(8, Math.min(at.y, innerHeight - size.height - 8));
  root2.style.left = `${Math.round(x)}px`;
  root2.style.top = `${Math.round(y)}px`;
}
function showMenu(at, title, entries) {
  closeMenu();
  const cameFrom = document.activeElement;
  const root2 = el("div", { cls: "om-menu", attrs: { role: "menu", "aria-label": title } });
  for (const entry of entries) {
    if (entry.line) root2.append(el("div", { cls: "om-menu-line", attrs: { role: "separator" } }));
    const item = button(
      {
        cls: `om-menu-item${entry.off ? " om-menu-off" : ""}`,
        text: entry.label,
        title: entry.why,
        attrs: { role: "menuitem", "aria-disabled": entry.off ? "true" : null, tabindex: "-1" },
        onClick: () => {
          if (entry.off) {
            note(entry.why ?? "That cannot be done here.");
            return;
          }
          closeMenu();
          entry.onPick();
        }
      },
      []
    );
    root2.append(item);
  }
  root2.addEventListener("keydown", (event) => {
    const press2 = event;
    const items = [...root2.querySelectorAll(".om-menu-item")].filter((one) => one instanceof HTMLElement);
    const here = items.indexOf(document.activeElement);
    if (press2.key === "Escape") {
      press2.preventDefault();
      closeMenu();
      return;
    }
    if (press2.key === "ArrowDown" || press2.key === "ArrowUp") {
      press2.preventDefault();
      const step = press2.key === "ArrowDown" ? 1 : -1;
      const next2 = items[(here + step + items.length) % items.length];
      next2?.focus();
    }
  });
  document.body.append(root2);
  open = { root: root2, cameFrom };
  place(root2, at);
  const first = root2.querySelector(".om-menu-item:not(.om-menu-off)");
  if (first instanceof HTMLElement) first.focus();
}
function askBox(options) {
  const cameFrom = document.activeElement;
  const input = options.placeholder !== void 0 || options.startWith !== void 0 ? el("input", {
    cls: "om-ask-input",
    attrs: { type: "text", maxlength: "200", placeholder: options.placeholder ?? "", value: options.startWith ?? "", "aria-label": options.title }
  }) : null;
  const shut = () => {
    cover.remove();
    if (cameFrom instanceof HTMLElement && document.contains(cameFrom)) cameFrom.focus();
  };
  const say = () => {
    const words = input ? input.value.trim() : "";
    if (input && words === "") {
      input.focus();
      return;
    }
    shut();
    options.onYes(words);
  };
  const box = el("div", { cls: "om-ask", attrs: { role: "dialog", "aria-modal": "true", "aria-label": options.title } }, [
    el("h2", { cls: "om-ask-title", text: options.title }),
    options.detail ? el("p", { cls: "om-ask-detail", text: options.detail }) : null,
    input,
    el("div", { cls: "om-ask-row" }, [
      button({ cls: "om-btn om-btn-quiet", text: "Cancel", onClick: shut }),
      button({ cls: `om-btn ${options.danger ? "om-btn-danger" : "om-btn-primary"}`, text: options.yes, onClick: say })
    ])
  ]);
  const cover = el("div", { cls: "om-cover" }, [box]);
  cover.addEventListener("click", (event) => {
    if (event.target === cover) shut();
  });
  cover.addEventListener("keydown", (event) => {
    const press2 = event;
    if (press2.key === "Escape") {
      press2.preventDefault();
      shut();
    }
    if (press2.key === "Enter" && input && press2.target === input) {
      press2.preventDefault();
      say();
    }
  });
  document.body.append(cover);
  if (input) {
    input.focus();
    input.select();
  } else {
    const yes = cover.querySelector(".om-btn-primary, .om-btn-danger");
    if (yes instanceof HTMLElement) yes.focus();
  }
}
async function listsToChooseFrom() {
  const answer = await playlists();
  if (!answer.got) {
    note(answer.shut ? "Open the Orbis window to see your playlists." : answer.why);
    return null;
  }
  return answer.value.filter((one) => one.rule === void 0);
}
async function chooseAPlaylist(at, trackIds) {
  if (trackIds.length === 0) return;
  const lists = await listsToChooseFrom();
  if (!lists) return;
  const entries = lists.map((list) => ({
    label: list.name,
    onPick: () => void addTo(list, trackIds)
  }));
  entries.push({
    label: "New playlist\u2026",
    line: entries.length > 0,
    onPick: () => askBox({
      title: trackIds.length === 1 ? "Name the new playlist" : `A new playlist of ${trackIds.length} songs`,
      placeholder: "What it is called",
      yes: "Make it",
      onYes: (name) => {
        playlistsChanged();
        void doAndSay(createPlaylist(name, trackIds));
      }
    })
  });
  if (lists.length === 0) {
    entries.unshift({ label: "You have no playlists you can add to yet", off: true, why: "A playlist worked out from your music cannot be added to by hand.", onPick: () => {
    } });
  }
  showMenu(at, "Add to a playlist", entries);
}
async function addTo(list, trackIds) {
  const answer = await addToPlaylist(list.id, trackIds);
  playlistsChanged();
  if (!answer.got) {
    note(answer.shut ? "Orbis Music is not open, so nothing was added." : answer.why);
    return;
  }
  if (answer.value === null) {
    note(`Orbis Music did not add anything to ${list.name}.`);
    return;
  }
  note(trackIds.length === 1 ? `Added to ${list.name}.` : `${trackIds.length} songs added to ${list.name}.`);
}
var playableIds2 = (tracks) => tracks.filter((one) => playableOffline(one)).map((one) => one.id);
async function queueThePlaylist(list) {
  const answer = await playlistTracks(list.id);
  if (!answer.got) {
    note(answer.shut ? "Orbis Music is not open." : answer.why);
    return;
  }
  const ids = playableIds2(answer.value);
  if (ids.length === 0) {
    note(`There is nothing in ${list.name} with audio on this computer.`);
    return;
  }
  await doAndSay(queueEnd(ids));
}
function doAction(id, what, at) {
  if (what.kind === "track") {
    const track = what.track;
    const where = what.where;
    switch (id) {
      case "play":
        void doAndSay(play(track.id));
        return;
      case "play-next":
        void doAndSay(queueNext([track.id]));
        return;
      case "queue-end":
        void doAndSay(queueEnd([track.id]));
        return;
      case "queue-remove":
        if (where.queueAt === void 0) return;
        void doAndSay(queueRemove(where.queueAt));
        return;
      case "favourite":
      case "unfavourite":
        void doAndSay(setFavourite(track.id, id === "favourite"));
        return;
      case "add-to-playlist":
        void chooseAPlaylist(at, [track.id]);
        return;
      case "playlist-remove":
        if (where.playlistId === void 0) return;
        playlistsChanged();
        void doAndSay(removeFromPlaylist(where.playlistId, track.id));
        return;
      case "go-album":
        go("album", track.album);
        return;
      case "go-artist":
        go("artist", track.artist);
        return;
      default:
        return;
    }
  }
  if (what.kind === "album" || what.kind === "artist") {
    const ids = playableIds2(what.tracks);
    switch (id) {
      case "play-album":
      case "play-artist":
        void doAndSay(playAll(ids));
        return;
      case "queue-album":
      case "queue-artist":
        void doAndSay(queueEnd(ids));
        return;
      case "add-to-playlist":
        void chooseAPlaylist(at, what.tracks.map((one) => one.id));
        return;
      default:
        return;
    }
  }
  const list = what.list;
  switch (id) {
    case "play-playlist":
      void doAndSay(playPlaylist(list.id));
      return;
    case "queue-playlist":
      void queueThePlaylist(list);
      return;
    case "rename-playlist":
      askBox({
        title: "Rename this playlist",
        startWith: list.name,
        yes: "Rename it",
        onYes: (name) => {
          playlistsChanged();
          void doAndSay(renamePlaylist(list.id, name));
        }
      });
      return;
    case "remove-playlist":
      askBox({
        title: `Remove ${list.name}?`,
        detail: "The songs stay in your music. Only the playlist goes.",
        yes: "Remove it",
        danger: true,
        onYes: () => {
          playlistsChanged();
          void doAndSay(removePlaylist(list.id));
        }
      });
      return;
    default:
      return;
  }
}
function entriesFor(what, at) {
  const items = what.kind === "track" ? trackMenu(what.track, what.where) : what.kind === "album" || what.kind === "artist" ? groupMenu(what.kind, { playable: playableIds2(what.tracks).length }) : playlistMenu({ id: what.list.id, rule: what.list.rule, count: what.list.tracks.length });
  return items.map((item) => ({
    label: item.label,
    why: item.why,
    off: item.off,
    line: item.line,
    onPick: () => doAction(item.id, what, at)
  }));
}
var nameOf = (what) => what.kind === "track" ? what.track.title || "This song" : what.kind === "playlist" ? what.list.name : what.name;
function startMenus() {
  addEventListener(
    "contextmenu",
    (event) => {
      const found = markedAt(event.target);
      if (!found) return;
      event.preventDefault();
      const pointer = event;
      const fromKeyboard = pointer.button === 0 && pointer.clientX === 0 && pointer.clientY === 0;
      const box = found.node.getBoundingClientRect();
      const at = fromKeyboard ? { x: box.left + 24, y: box.top + box.height - 4 } : { x: pointer.clientX, y: pointer.clientY };
      showMenu(at, nameOf(found.what), entriesFor(found.what, at));
    },
    true
  );
  addEventListener("pointerdown", (event) => {
    if (!open) return;
    if (event.target instanceof Node && open.root.contains(event.target)) return;
    closeMenu();
  });
  addEventListener("scroll", () => closeMenu(), true);
  addEventListener("resize", () => closeMenu());
  addEventListener("hashchange", () => closeMenu());
}

// extension-src/music/shortcuts.ts
var sheet = null;
function closeSheet() {
  sheet?.remove();
  sheet = null;
}
function showSheet() {
  if (sheet) {
    closeSheet();
    return;
  }
  const groups = shortcutSheet().map(
    (group) => el("section", { cls: "om-sheet-group" }, [
      el("h3", { cls: "om-sheet-head", text: group.group }),
      el(
        "dl",
        { cls: "om-sheet-rows" },
        group.rows.flatMap((row) => [
          el("dt", { cls: "om-sheet-keys" }, row.keys.map((key) => el("kbd", { cls: "om-key", text: key }))),
          el("dd", { cls: "om-sheet-does", text: row.does })
        ])
      )
    ])
  );
  const box = el("div", { cls: "om-sheet", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts" } }, [
    el("div", { cls: "om-sheet-top" }, [
      el("h2", { cls: "om-sheet-title", text: "Keyboard shortcuts" }),
      button({ cls: "om-icon", title: "Close", onClick: closeSheet }, [icon("close", 18)])
    ]),
    ...groups,
    el("p", { cls: "om-sheet-note", text: "None of these work while you are typing in a box." })
  ]);
  const cover = el("div", { cls: "om-cover" }, [box]);
  cover.addEventListener("click", (event) => {
    if (event.target === cover) closeSheet();
  });
  cover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
    }
  });
  document.body.append(cover);
  sheet = cover;
  const close = box.querySelector(".om-icon");
  if (close instanceof HTMLElement) close.focus();
}
function seekTo(by) {
  const playback = current().music?.playback;
  if (!playback || !(playback.duration > 0)) return null;
  const at = positionNow() + by;
  return Math.max(0, Math.min(playback.duration, at));
}
function changeVolume(by) {
  const level = Math.max(0, Math.min(1, volumeNow() + by));
  void doAndSay(setVolume(level));
}
function doShortcut(id) {
  const playback = current().music?.playback;
  switch (id) {
    case "play-pause":
      if (playback?.owner === "website") {
        note("That player belongs to the web page. Orbis leaves it alone.");
        return;
      }
      void doAndSay(playOrPause());
      return;
    case "back-a-bit":
    case "on-a-bit":
    case "back-a-lot":
    case "on-a-lot": {
      const by = id === "back-a-bit" ? -SEEK_STEP : id === "on-a-bit" ? SEEK_STEP : id === "back-a-lot" ? -SEEK_JUMP : SEEK_JUMP;
      const at = seekTo(by);
      if (at === null) {
        note(playback?.trackId ? "This track has no known length, so there is nowhere to seek to." : "Nothing is playing.");
        return;
      }
      void doAndSay(seek(at));
      return;
    }
    case "louder":
      changeVolume(VOLUME_STEP);
      return;
    case "quieter":
      changeVolume(-VOLUME_STEP);
      return;
    case "mute":
      void doAndSay(setMuted(playback?.muted !== true));
      return;
    case "next":
      void doAndSay(next());
      return;
    case "previous":
      void doAndSay(previous());
      return;
    case "shuffle":
      void doAndSay(setShuffle(playback?.shuffle !== true));
      return;
    case "repeat":
      void doAndSay(setRepeat(nextRepeat(playback?.repeat ?? "off")));
      return;
    case "favourite": {
      const track = current().music?.track;
      if (!track) {
        note("Nothing is playing.");
        return;
      }
      void doAndSay(setFavourite(track.id, track.favourite !== true));
      return;
    }
    case "search":
      go("search");
      return;
    case "sheet":
      showSheet();
      return;
    default:
      return;
  }
}
function belongsToTheFocus(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.closest(".om-menu, .om-cover")) return true;
  if ((event.key === " " || event.key === "Enter") && (tag === "BUTTON" || tag === "A" || target.getAttribute("role") === "button")) return true;
  return false;
}
function startShortcuts() {
  addEventListener("keydown", (event) => {
    if (event.repeat && event.key === " ") return;
    if (belongsToTheFocus(event)) return;
    const shortcut = shortcutFor({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey });
    if (!shortcut) return;
    event.preventDefault();
    doShortcut(shortcut.id);
  });
}

// extension-src/music/extras.ts
startMenus();
startShortcuts();
startDragging();
watchSidebarPlaylists();

// extension-src/music/main.ts
var into = document.getElementById("om-root");
if (!into) {
  console.error("Orbis Music: music.html has no #om-root to draw into.");
} else {
  startRouting();
  startShell(into);
}
