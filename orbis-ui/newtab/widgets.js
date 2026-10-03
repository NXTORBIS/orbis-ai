// orbis-ui/newtab/widgets/link.ts
import { call } from "./helper.js";

// src/shared/widgetFeed.ts
var WIDGET_SOURCES = Object.freeze(["tasks", "reminders", "notes", "clipboard", "workspaces", "whiteboard", "bookmarks", "downloads", "recent", "tabs", "weather", "news", "markets"]);
var WEATHER_SYMBOLS = Object.freeze(["clear", "partly", "cloudy", "rain", "showers", "snow", "sleet", "fog", "thunder", "night", "unknown"]);
var FEED_LIMITS = Object.freeze({ tasks: 20, reminders: 20, notes: 12, clipboard: 12, workspaces: 12, whiteboard: 10, bookmarks: 20, downloads: 12, recent: 20, tabs: 20, weather: 12, news: 20, markets: 1 });
var WIDGET_COMMANDS = Object.freeze(["task.complete", "note.create", "clip.copy", "workspace.open", "tab.activate", "download.show", "panel.open", "orion.ask"]);
var WIDGET_REQUESTS = Object.freeze([
  "add",
  "remove",
  "move",
  "resize",
  "configure",
  "look",
  "lock",
  "hide",
  "reset",
  "revive",
  "favourite",
  "used",
  "preset",
  "clear",
  "enable",
  "undo",
  "redo",
  "layout.save",
  "layout.use",
  "layout.remove",
  "adopt"
]);
var WIDGET_CHANNELS = Object.freeze({ get: "widgets:get", act: "widgets:act", watch: "widgets:watch", data: "widgets:data", do: "widgets:do", rendered: "widgets:rendered" });
var DAY = 864e5;
var SAMPLE_NOW = Date.UTC(2026, 9, 5, 10, 42, 0);
var WIDGET_SAMPLES = Object.freeze({
  tasks: {
    items: [
      { id: "s1", title: "Send the report", dueAt: SAMPLE_NOW + 3 * 36e5, hasTime: true, important: true, overdue: false },
      { id: "s2", title: "Book the dentist", dueAt: SAMPLE_NOW, hasTime: false, important: false, overdue: false },
      { id: "s3", title: "Water the plants", dueAt: SAMPLE_NOW, hasTime: false, important: false, overdue: false },
      { id: "s4", title: "Call the bank", dueAt: SAMPLE_NOW - DAY, hasTime: false, important: false, overdue: true }
    ],
    total: 4
  },
  reminders: {
    items: [
      { id: "s1", title: "Team call", at: SAMPLE_NOW + 78 * 6e4 },
      { id: "s2", title: "Pick up the parcel", at: SAMPLE_NOW + 6 * 36e5 },
      { id: "s3", title: "Pay the rent", at: SAMPLE_NOW + 2 * DAY }
    ],
    total: 3
  },
  notes: {
    items: [
      { id: "s1", title: "Ideas for the talk", excerpt: "Start with the question, not the answer.", updatedAt: SAMPLE_NOW - 36e5 },
      { id: "s2", title: "Reading list", excerpt: "Three books for the summer.", updatedAt: SAMPLE_NOW - DAY },
      { id: "s3", title: "Recipe to try", excerpt: "Lemon, garlic, twenty minutes.", updatedAt: SAMPLE_NOW - 3 * DAY }
    ],
    total: 3
  },
  clipboard: {
    items: [
      { id: "s1", preview: "Meet at the north entrance at six", kind: "text", at: SAMPLE_NOW - 12e4 },
      { id: "s2", preview: "https://example.org/timetable", kind: "link", at: SAMPLE_NOW - 15e5 },
      { id: "s3", preview: "14 Orchard Lane", kind: "text", at: SAMPLE_NOW - 72e5 }
    ],
    total: 3
  },
  workspaces: { items: [{ id: "s1", name: "Study", tabs: 6, current: true }, { id: "s2", name: "Trip planning", tabs: 4, current: false }, { id: "s3", name: "Work", tabs: 9, current: false }] },
  whiteboard: { items: [{ id: "s1", name: "Project map", elements: 14, updatedAt: SAMPLE_NOW - DAY }, { id: "s2", name: "Kitchen plan", elements: 6, updatedAt: SAMPLE_NOW - 4 * DAY }] },
  bookmarks: { items: [{ title: "Example library", url: "https://example.org/library" }, { title: "Example news", url: "https://example.com/news" }, { title: "Example maps", url: "https://example.net/maps" }, { title: "Example recipes", url: "https://example.org/recipes" }], total: 4 },
  downloads: {
    items: [
      { id: "s1", name: "timetable.pdf", state: "done", received: 184320, total: 184320, at: SAMPLE_NOW - 6e5 },
      { id: "s2", name: "photos.zip", state: "downloading", received: 41943040, total: 104857600, at: SAMPLE_NOW - 3e4 }
    ]
  },
  recent: {
    items: [
      { title: "Example library", url: "https://example.org/library", host: "example.org", at: SAMPLE_NOW - 3e5 },
      { title: "Example news", url: "https://example.com/news", host: "example.com", at: SAMPLE_NOW - 24e5 },
      { title: "Example maps", url: "https://example.net/maps", host: "example.net", at: SAMPLE_NOW - 9e6 }
    ]
  },
  tabs: { count: 7, groups: 2, items: [{ id: 1, title: "Example library", url: "https://example.org/library", active: true }, { id: 2, title: "Example news", url: "https://example.com/news", active: false }, { id: 3, title: "Example maps", url: "https://example.net/maps", active: false }] },
  weather: {
    place: "Your city",
    temperature: 24,
    unit: "c",
    summary: "Partly cloudy",
    symbol: "partly",
    hours: [
      { at: SAMPLE_NOW + 36e5, temperature: 25, symbol: "partly" },
      { at: SAMPLE_NOW + 2 * 36e5, temperature: 26, symbol: "clear" },
      { at: SAMPLE_NOW + 3 * 36e5, temperature: 26, symbol: "clear" },
      { at: SAMPLE_NOW + 4 * 36e5, temperature: 24, symbol: "showers" }
    ],
    attribution: "MET Norway"
  },
  news: {
    items: [
      { title: "A headline from a feed you choose", url: "https://example.com/1", source: "Your feed", at: SAMPLE_NOW - 36e5 },
      { title: "Another headline, newest first", url: "https://example.com/2", source: "Your feed", at: SAMPLE_NOW - 2 * 36e5 },
      { title: "Nothing is chosen for you", url: "https://example.com/3", source: "Your feed", at: SAMPLE_NOW - 5 * 36e5 }
    ],
    failed: []
  },
  markets: { symbol: "BTC", name: "Bitcoin", price: 64250, change: 1.84, currency: "USD", points: [62900, 63050, 62800, 63300, 63650, 63500, 63900, 64100, 63950, 64250], asOf: SAMPLE_NOW }
});
var sampleFeed = (source) => ({ source, status: "live", value: WIDGET_SAMPLES[source], at: SAMPLE_NOW });

// orbis-ui/newtab/widgets/link.ts
var WATCH_WAIT_FROM = 500;
var WATCH_WAIT_TO = 15e3;
var REPORT_EVERY = 400;
function createLink() {
  let state = null;
  let connected = false;
  const listeners = /* @__PURE__ */ new Set();
  const feedListeners = /* @__PURE__ */ new Set();
  const asking = /* @__PURE__ */ new Map();
  let lastReport = 0;
  let reportTimer = 0;
  let reportWanted = null;
  const tell = () => {
    for (const listener of [...listeners]) {
      try {
        listener(state, connected);
      } catch (err) {
        console.error("[widgets] a part of the page could not be brought up to date", err);
      }
    }
  };
  const take = (event) => {
    if (event.type === "state") {
      state = event.state;
      connected = true;
      tell();
      return;
    }
    for (const listener of [...feedListeners]) {
      try {
        listener(event.source);
      } catch {
      }
    }
  };
  const watch = async () => {
    for (let wait = WATCH_WAIT_FROM; ; wait = Math.min(Math.round(wait * 1.7), WATCH_WAIT_TO)) {
      try {
        await call(WIDGET_CHANNELS.watch, [], { onEvent: (event) => take(event) });
      } catch {
      }
      if (connected) {
        connected = false;
        tell();
      }
      await new Promise((done) => setTimeout(done, wait));
    }
  };
  void watch();
  const act = async (request) => {
    try {
      const reply = await call(WIDGET_CHANNELS.act, [request]);
      if (reply && reply.ok) {
        state = reply.state;
        connected = true;
        tell();
      }
      return reply;
    } catch (err) {
      return { ok: false, error: "no-orbis", message: reasonOf(err) };
    }
  };
  const feed = async (request) => {
    const key = JSON.stringify(request);
    const already = asking.get(key);
    if (already) return already;
    const asked = (async () => {
      try {
        return await call(WIDGET_CHANNELS.data, [request]);
      } catch (err) {
        return { source: request.source, status: "unavailable", value: null, at: 0, error: reasonOf(err) };
      } finally {
        asking.delete(key);
      }
    })();
    asking.set(key, asked);
    return asked;
  };
  return {
    state: () => state,
    connected: () => connected,
    subscribe: (listener) => {
      listeners.add(listener);
      try {
        listener(state, connected);
      } catch (err) {
        console.error("[widgets] a part of the page could not be started", err);
      }
      return () => listeners.delete(listener);
    },
    act,
    feed,
    onFeed: (listener) => {
      feedListeners.add(listener);
      return () => feedListeners.delete(listener);
    },
    run: async (command) => {
      try {
        return await call(WIDGET_CHANNELS.do, [command]);
      } catch (err) {
        return { ok: false, message: reasonOf(err) };
      }
    },
    report: (rendered) => {
      reportWanted = rendered;
      const since = Date.now() - lastReport;
      if (since >= REPORT_EVERY) return void send();
      if (reportTimer) return;
      reportTimer = setTimeout(send, REPORT_EVERY - since);
    }
  };
  function send() {
    clearTimeout(reportTimer);
    reportTimer = 0;
    const rendered = reportWanted;
    reportWanted = null;
    if (!rendered) return;
    lastReport = Date.now();
    void call(WIDGET_CHANNELS.rendered, [rendered]).catch(() => {
    });
  }
}
function reasonOf(err) {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    const message = err.message;
    if (/not running|could not sign in|still starting/i.test(message)) return "Orbis is not running, so the widgets cannot be changed.";
    return message;
  }
  return "Orbis is not running, so the widgets cannot be changed.";
}

// orbis-ui/newtab/widgets/dom.ts
import { icon as railIcon } from "./orbis-icons.js";
var SVG = "http://www.w3.org/2000/svg";
function apply(node, props, ns) {
  if (!props) return;
  for (const [name, value] of Object.entries(props)) {
    if (value === void 0 || value === null || value === false) continue;
    if (name === "class") node.setAttribute("class", String(value));
    else if (name === "text") node.textContent = String(value);
    else if (name === "style" && typeof value === "object") for (const [k, v] of Object.entries(value)) node.style.setProperty(k, v);
    else if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2), value);
    else if (!ns && name in node && typeof value !== "string" && name !== "list") node[name] = value;
    else node.setAttribute(name, value === true ? "" : String(value));
  }
}
function add(node, children) {
  for (const child of children) {
    if (child === null || child === void 0 || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  apply(node, props, false);
  add(node, children);
  return node;
}
function svg(tag, props, ...children) {
  const node = document.createElementNS(SVG, tag);
  apply(node, props, true);
  add(node, children);
  return node;
}
var icon = (name, size = 16) => railIcon(name, size);
var clear = (node) => node.replaceChildren();
function button(label, press2, content = label, cls = "wg-btn") {
  const node = h("button", { class: cls, type: "button", "aria-label": label, title: typeof content === "string" ? void 0 : label });
  add(node, Array.isArray(content) ? content : [content]);
  node.addEventListener("click", press2);
  return node;
}
function clockTime(at2, hour12, seconds = false, timeZone) {
  try {
    return new Intl.DateTimeFormat(void 0, { hour: "numeric", minute: "2-digit", ...seconds ? { second: "2-digit" } : {}, hour12, ...timeZone ? { timeZone } : {} }).format(at2);
  } catch {
    return new Intl.DateTimeFormat(void 0, { hour: "numeric", minute: "2-digit", hour12 }).format(at2);
  }
}
var dayName = (at2, timeZone) => new Intl.DateTimeFormat(void 0, { weekday: "long", day: "numeric", month: "long", ...timeZone ? { timeZone } : {} }).format(at2);
function ago(at2, now) {
  const gap = now - at2;
  if (!Number.isFinite(gap)) return "";
  if (gap < 6e4) return "just now";
  const minutes = Math.floor(gap / 6e4);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(void 0, { day: "numeric", month: "short" }).format(at2);
}
function until(at2, now) {
  const gap = at2 - now;
  if (gap <= 0) return "now";
  const minutes = Math.ceil(gap / 6e4);
  if (minutes < 60) return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  const days = Math.round(hours / 24);
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return new Intl.DateTimeFormat(void 0, { day: "numeric", month: "short" }).format(at2);
}
function bytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function isWeb(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
var favicon = (url, size = 32) => `chrome://favicon2/?size=${size}&scaleFactor=2x&pageUrl=${encodeURIComponent(url)}`;
var prefersStill = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// src/shared/widgetData.ts
function partOfDay(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}
function greeting(date, name) {
  const said3 = { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening", night: "Good night" }[partOfDay(date)];
  const who = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return who ? `${said3}, ${who}` : said3;
}
function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
function parseWorldClocks(text2, max = 8) {
  const clocks = [];
  const unknown = [];
  for (const part of text2.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean)) {
    const [left, right] = part.includes("=") ? part.split("=", 2).map((p) => p.trim()) : [void 0, part];
    const zone = right ?? "";
    if (!isTimeZone(zone)) {
      unknown.push(zone || part);
      continue;
    }
    const label = (left || zone.split("/").pop() || zone).replace(/_/g, " ").slice(0, 30);
    clocks.push({ label, zone });
    if (clocks.length >= max) break;
  }
  return { clocks, unknown };
}
function zoneOffsetMinutes(zone, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(date).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((asUtc - Math.floor(date.getTime() / 6e4) * 6e4) / 6e4);
}

// orbis-ui/newtab/widgets/renderers/time/sums.ts
function clockParts(at2, timeZone) {
  if (!Number.isFinite(at2)) return null;
  if (!timeZone) {
    const here = new Date(at2);
    return { hour: here.getHours(), minute: here.getMinutes(), second: here.getSeconds(), weekday: here.getDay(), day: here.getDate(), month: here.getMonth() + 1, year: here.getFullYear() };
  }
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(at2).map((part) => [part.type, part.value])
    );
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday));
    const read = (name) => Number(parts[name]);
    if (weekday < 0 || !Number.isFinite(read("hour"))) return null;
    return { hour: read("hour") % 24, minute: read("minute"), second: read("second"), weekday, day: read("day"), month: read("month"), year: read("year") };
  } catch {
    return null;
  }
}
function handAngles(parts) {
  const second = parts.second;
  const minute = parts.minute + second / 60;
  const hour = parts.hour % 12 + minute / 60;
  return { hour: hour * 30, minute: minute * 6, second: second * 6 };
}
var dayFraction = (parts) => (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86400;
function timeText(at2, hour12, seconds = false, timeZone) {
  const make = (zone) => new Intl.DateTimeFormat(void 0, { hour: "numeric", minute: "2-digit", ...seconds ? { second: "2-digit" } : {}, hour12, ...zone ? { timeZone: zone } : {} }).formatToParts(at2);
  let parts;
  try {
    parts = make(timeZone);
  } catch {
    parts = make();
  }
  const at_ = parts.findIndex((part) => part.type === "hour");
  const hour = parts[at_]?.value ?? "";
  const join = parts[at_ + 1]?.type === "literal" ? parts[at_ + 1].value : ":";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return {
    hm: `${hour}${join}${minute}`,
    seconds: parts.find((part) => part.type === "second")?.value ?? "",
    suffix: parts.find((part) => part.type === "dayPeriod")?.value ?? ""
  };
}
function offsetWords(minutes) {
  if (!Number.isFinite(minutes) || Math.round(minutes) === 0) return "The same time as here";
  const total = Math.abs(Math.round(minutes));
  const way = minutes > 0 ? "ahead" : "behind";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const said3 = [];
  if (hours > 0) said3.push(hours === 1 ? "1 hour" : `${hours} hours`);
  if (rest > 0) said3.push(rest === 1 ? "1 minute" : `${rest} minutes`);
  return `${said3.join(" ")} ${way}`;
}
function offsetShort(minutes) {
  if (!Number.isFinite(minutes) || Math.round(minutes) === 0) return "Here";
  const total = Math.abs(Math.round(minutes));
  const sign = minutes > 0 ? "+" : "\u2212";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${sign}${hours}` : `${sign}${hours}:${String(rest).padStart(2, "0")}`;
}
function weekStrip(at2) {
  const here = new Date(at2);
  const monday = new Date(here.getFullYear(), here.getMonth(), here.getDate() - (here.getDay() + 6) % 7);
  const narrow = new Intl.DateTimeFormat(void 0, { weekday: "narrow" });
  const long = new Intl.DateTimeFormat(void 0, { weekday: "long" });
  const out = [];
  for (let step = 0; step < 7; step++) {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + step);
    out.push({
      letter: narrow.format(day),
      label: long.format(day),
      day: day.getDate(),
      today: day.getDate() === here.getDate() && day.getMonth() === here.getMonth() && day.getFullYear() === here.getFullYear()
    });
  }
  return out;
}
function readDay(text2) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(text2 ?? "").trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map((one) => one === void 0 ? 0 : Number(one));
  if (year < 1e3 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const made3 = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (made3.getFullYear() !== year || made3.getMonth() !== month - 1 || made3.getDate() !== day) return null;
  return made3.getTime();
}
function span(target, now) {
  const gap = target - now;
  const total = Math.abs(gap);
  return {
    past: gap < 0,
    totalMs: total,
    days: Math.floor(total / 864e5),
    hours: Math.floor(total % 864e5 / 36e5),
    minutes: Math.floor(total % 36e5 / 6e4)
  };
}
function countdownFigure(it) {
  const plural = (n, one, many) => n === 1 ? one : many;
  const when = it.past ? "ago" : "left";
  if (it.totalMs < 6e4) return { big: it.past ? "Just now" : "Now", unit: "", sub: "" };
  if (it.days >= 1) return { big: String(it.days), unit: `${plural(it.days, "day", "days")} ${when}`, sub: it.hours >= 1 ? `and ${it.hours} ${plural(it.hours, "hour", "hours")}` : "" };
  if (it.hours >= 1) return { big: String(it.hours), unit: `${plural(it.hours, "hour", "hours")} ${when}`, sub: it.minutes >= 1 ? `and ${it.minutes} ${plural(it.minutes, "minute", "minutes")}` : "" };
  return { big: String(it.minutes), unit: `${plural(it.minutes, "minute", "minutes")} ${when}`, sub: "" };
}
function progress(from, to, now) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || from >= to) return null;
  return Math.min(1, Math.max(0, (now - from) / (to - from)));
}
var SAYS_IT_FINISHED_FOR = 12 * 36e5;
function timerStanding(settings, now) {
  const phase = settings.phase === "rest" ? "rest" : "focus";
  const totalMs = Math.max(6e4, Math.round(phase === "rest" ? settings.breakMinutes : settings.minutes) * 6e4);
  if (settings.endsAt > 0) {
    const left = settings.endsAt - now;
    return left > 0 ? { state: "running", leftMs: left, totalMs: Math.max(totalMs, left), phase } : { state: "done", leftMs: 0, totalMs, phase };
  }
  if (settings.pausedMs > 0) return { state: "paused", leftMs: Math.min(settings.pausedMs, totalMs), totalMs, phase };
  if (settings.finishedAt > 0 && now - settings.finishedAt < SAYS_IT_FINISHED_FOR) return { state: "done", leftMs: 0, totalMs, phase };
  return { state: "idle", leftMs: totalMs, totalMs, phase };
}
function timerText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1e3));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
var TIMER_LENGTHS = Object.freeze([5, 15, 25, 45]);
var SPELLINGS = Object.freeze({ "\xD7": "*", "\xF7": "/", "\u2212": "-", "\u2013": "-", "\u2014": "-", "\u2044": "/" });
var NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
function calculate(input) {
  const typed = String(input ?? "").trim();
  if (typed === "") return { ok: false, error: "" };
  const text2 = [...typed].map((one) => SPELLINGS[one] ?? one).join("");
  if (!/^[\d\s+\-*/%.()]+$/.test(text2)) return { ok: false, error: "Numbers and + \u2212 \xD7 \xF7 % ( ) only" };
  const tokens = text2.match(/\d+(?:\.\d*)?|\.\d+|[+\-*/%()]/g);
  if (!tokens || tokens.join("") !== text2.replace(/\s/g, "")) return { ok: false, error: "That is not a sum" };
  let at2 = 0;
  let dividedByZero = false;
  const peek = () => tokens[at2];
  const eat = (what) => peek() === what ? (at2++, true) : false;
  const primary = () => {
    if (eat("(")) {
      const inside = expression();
      return inside === null || !eat(")") ? null : inside;
    }
    const token = peek();
    if (token === void 0 || !NUMBER.test(token)) return null;
    at2++;
    return Number(token);
  };
  const unary = () => {
    if (eat("-")) {
      const value3 = unary();
      return value3 === null ? null : -value3;
    }
    if (eat("+")) return unary();
    let value2 = primary();
    if (value2 === null) return null;
    while (eat("%")) value2 /= 100;
    return value2;
  };
  const term = () => {
    let value2 = unary();
    if (value2 === null) return null;
    for (; ; ) {
      const closed = tokens[at2 - 1] === ")";
      if (eat("*") || eat("/")) {
        const sign = tokens[at2 - 1];
        const right = unary();
        if (right === null) return null;
        if (sign === "/") {
          if (right === 0) {
            dividedByZero = true;
            return null;
          }
          value2 /= right;
        } else value2 *= right;
      } else if (peek() === "(" || closed && peek() !== void 0 && NUMBER.test(peek())) {
        const right = unary();
        if (right === null) return null;
        value2 *= right;
      } else return value2;
    }
  };
  const expression = () => {
    let value2 = term();
    if (value2 === null) return null;
    for (; ; ) {
      if (eat("+")) {
        const right = term();
        if (right === null) return null;
        value2 += right;
      } else if (eat("-")) {
        const right = term();
        if (right === null) return null;
        value2 -= right;
      } else return value2;
    }
  };
  const value = expression();
  if (dividedByZero) return { ok: false, error: "Nothing can be divided by zero" };
  if (value === null || at2 !== tokens.length) return { ok: false, error: "That is not a sum" };
  if (!Number.isFinite(value)) return { ok: false, error: "That is too big to work out" };
  return { ok: true, value: Number(value.toPrecision(12)) };
}
function sumText(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1e15 || value !== 0 && Math.abs(value) < 1e-6) return value.toExponential(6).replace(/\.?0+e/, "e");
  return new Intl.NumberFormat(void 0, { maximumFractionDigits: 10 }).format(value);
}
var sumValue = (value) => Number.isFinite(value) ? String(value) : "";
function pickByKey(count, key) {
  if (!Number.isInteger(count) || count < 1) return 0;
  let hash = 2166136261;
  for (let at2 = 0; at2 < key.length; at2++) hash = Math.imul(hash ^ key.charCodeAt(at2), 16777619);
  return (hash >>> 0) % count;
}
function dayKey(at2) {
  const here = new Date(at2);
  const pad = (n) => String(n).padStart(2, "0");
  return `${here.getFullYear()}-${pad(here.getMonth() + 1)}-${pad(here.getDate())}`;
}

// orbis-ui/newtab/widgets/renderers/time/parts.ts
var text = (settings, name, fallback = "") => typeof settings[name] === "string" ? settings[name] : fallback;
var number = (settings, name, fallback = 0) => {
  const value = settings[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};
var flag = (settings, name, fallback = false) => typeof settings[name] === "boolean" ? settings[name] : fallback;
function ring(options) {
  const width = options.width ?? 8;
  const radius = 50 - width / 2;
  const parts = [svg("circle", { class: "wg-time-ring-track", cx: 50, cy: 50, r: radius, "stroke-width": width, fill: "none" })];
  if (options.fraction !== null) {
    const run = Math.min(100, Math.max(0, options.fraction * 100));
    parts.push(
      svg("circle", {
        class: `wg-time-ring-arc${options.arcClass ? ` ${options.arcClass}` : ""}`,
        cx: 50,
        cy: 50,
        r: radius,
        "stroke-width": width,
        fill: "none",
        pathLength: 100,
        "stroke-dasharray": `${run.toFixed(2)} 100`,
        "stroke-linecap": "round",
        transform: "rotate(-90 50 50)"
      })
    );
  }
  return svg("svg", { class: `wg-time-ring${options.className ? ` ${options.className}` : ""}`, viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" }, ...parts);
}
function onCircle(degrees2, radius) {
  const turn = (degrees2 - 90) * Math.PI / 180;
  return { x: 50 + Math.cos(turn) * radius, y: 50 + Math.sin(turn) * radius };
}
var said = (words) => h("span", { class: "wg-time-said", text: words });
function pressable(preview, label, run, content = label, cls = "wg-btn") {
  const node = button(label, preview ? () => void 0 : run, content, cls);
  if (preview) {
    node.tabIndex = -1;
    node.setAttribute("aria-disabled", "true");
  }
  return node;
}
function quiet(preview, node) {
  if (preview) {
    node.readOnly = true;
    node.tabIndex = -1;
  }
  return node;
}
var scratches = /* @__PURE__ */ new WeakMap();
function typing(body, stored) {
  const kept = scratches.get(body);
  if (kept && kept.base === stored) return kept;
  const fresh = { text: stored, base: stored, focused: kept?.focused ?? false, caret: stored.length };
  scratches.set(body, fresh);
  return fresh;
}
function resume(node, kept) {
  node.addEventListener("focus", () => {
    kept.focused = true;
  });
  node.addEventListener("blur", () => {
    if (node.isConnected) kept.focused = false;
  });
  if (!kept.focused) return;
  queueMicrotask(() => {
    if (!node.isConnected || node.readOnly) return;
    node.focus({ preventScroll: true });
    const at2 = Math.min(Math.max(0, kept.caret), node.value.length);
    try {
      node.setSelectionRange(at2, at2);
    } catch {
    }
  });
}

// orbis-ui/newtab/widgets/renderers/time/clock.ts
var clock = (ctx) => {
  const face = text(ctx.settings, "face", "digital") === "analog" ? "analog" : "digital";
  const look = {
    seconds: flag(ctx.settings, "seconds"),
    withDate: flag(ctx.settings, "date", true),
    // The widget's own switch only ever turns the twelve-hour clock on. The start page's setting is what the person
    // chose for the whole page, and one widget quietly overruling it is how two clocks come to disagree.
    hour12: flag(ctx.settings, "hour12") || ctx.hour12
  };
  const root = h("div", { class: "wg-clock", "data-size": ctx.size, "data-face": face });
  ctx.body.appendChild(root);
  const tick = face === "analog" ? analogue(ctx, root, look) : digital(ctx, root, look);
  tick();
  ctx.every(1e3, tick);
};
function digital(ctx, root, look) {
  const hm = h("span", { class: "wg-clock-hm" });
  const secs = look.seconds ? h("span", { class: "wg-clock-sec" }) : null;
  const suffix = h("span", { class: "wg-clock-ampm" });
  const date = look.withDate ? h("p", { class: "wg-clock-date" }) : null;
  const stack2 = h("div", { class: "wg-clock-stack" }, h("p", { class: "wg-clock-face" }, hm, secs, suffix), date);
  root.appendChild(stack2);
  const run = ctx.size === "small" ? null : h("span", { class: "wg-clock-day-run" });
  if (run) root.appendChild(h("div", { class: "wg-clock-day", "aria-hidden": "true" }, run));
  const week = ctx.size === "large" ? h("div", { class: "wg-clock-week" }) : null;
  if (week) root.appendChild(week);
  let day = "";
  return () => {
    const now = ctx.now();
    const parts = clockParts(now);
    if (!parts) return;
    const shown = timeText(now, look.hour12, look.seconds);
    if (hm.textContent !== shown.hm) hm.textContent = shown.hm;
    if (secs && secs.textContent !== shown.seconds) secs.textContent = shown.seconds;
    if (suffix.textContent !== shown.suffix) suffix.textContent = shown.suffix;
    if (run) run.style.setProperty("width", `${(dayFraction(parts) * 100).toFixed(2)}%`);
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    if (key !== day) {
      day = key;
      if (date) date.textContent = dayName(now);
      if (week) drawWeek(week, now);
    }
  };
}
function analogue(ctx, root, look) {
  const dial2 = svg("svg", { class: "wg-clock-dial", viewBox: "0 0 100 100", role: "img", "aria-label": "Clock", "data-sweep": ctx.still ? "off" : "on" });
  dial2.appendChild(svg("circle", { class: "wg-clock-well", cx: 50, cy: 50, r: 47 }));
  dial2.appendChild(svg("circle", { class: "wg-clock-rim", cx: 50, cy: 50, r: 47, fill: "none" }));
  const marks = svg("g", { class: "wg-clock-marks" });
  for (let at2 = 0; at2 < 60; at2++) {
    const hourMark = at2 % 5 === 0;
    const outer = onCircle(at2 * 6, 43);
    const inner = onCircle(at2 * 6, hourMark ? 36.5 : 40.2);
    marks.appendChild(
      svg("line", { class: hourMark ? "wg-clock-mark wg-clock-mark-hour" : "wg-clock-mark", x1: inner.x.toFixed(2), y1: inner.y.toFixed(2), x2: outer.x.toFixed(2), y2: outer.y.toFixed(2) })
    );
  }
  dial2.appendChild(marks);
  let dateWindow = null;
  if (look.withDate) {
    dial2.appendChild(svg("rect", { class: "wg-clock-window", x: 58.5, y: 44.4, width: 25.5, height: 11.2, rx: 3 }));
    dateWindow = svg("text", { class: "wg-clock-window-text", x: 71.25, y: 52.5, "text-anchor": "middle" });
    dial2.appendChild(dateWindow);
  }
  const hour = svg("g", { class: "wg-clock-hand wg-clock-hour" }, svg("line", { x1: 50, y1: 57, x2: 50, y2: 27 }));
  const minute = svg("g", { class: "wg-clock-hand wg-clock-minute" }, svg("line", { x1: 50, y1: 60, x2: 50, y2: 14 }));
  const sweeper = svg(
    "g",
    { class: "wg-clock-sweeper" },
    svg("line", { class: "wg-clock-second", x1: 50, y1: 62, x2: 50, y2: 11 }),
    svg("circle", { class: "wg-clock-counter", cx: 50, cy: 65, r: 2.4 })
  );
  dial2.append(hour, minute, sweeper);
  dial2.appendChild(svg("circle", { class: "wg-clock-pin", cx: 50, cy: 50, r: 2.8 }));
  dial2.appendChild(svg("circle", { class: "wg-clock-pin-eye", cx: 50, cy: 50, r: 1 }));
  root.appendChild(h("div", { class: "wg-clock-dialwrap" }, dial2));
  const besideTime = ctx.size === "medium" ? h("span", { class: "wg-clock-hm" }) : null;
  const besideDate = ctx.size === "medium" && look.withDate ? h("p", { class: "wg-clock-date" }) : null;
  if (besideTime) root.appendChild(h("div", { class: "wg-clock-beside" }, besideTime, besideDate));
  const underDate = ctx.size === "large" && look.withDate ? h("p", { class: "wg-clock-date" }) : null;
  if (underDate) root.appendChild(underDate);
  const week = ctx.size === "large" ? h("div", { class: "wg-clock-week" }) : null;
  if (week) root.appendChild(week);
  const turn = (node, degrees2) => node.style.setProperty("--wg-turn", `${degrees2.toFixed(3)}deg`);
  const short = new Intl.DateTimeFormat(void 0, { weekday: "short" });
  let lastMinute = -1;
  let day = "";
  return () => {
    const now = ctx.now();
    const parts = clockParts(now);
    if (!parts) return;
    const angles = handAngles(parts);
    turn(hour, angles.hour);
    turn(minute, angles.minute);
    turn(sweeper, angles.second);
    if (parts.minute !== lastMinute) {
      lastMinute = parts.minute;
      sweeper.style.setProperty("animation-delay", `-${(parts.second + now % 1e3 / 1e3).toFixed(3)}s`);
      dial2.setAttribute("aria-label", `${clockTime(now, look.hour12)}${look.withDate ? `, ${dayName(now)}` : ""}`);
      if (besideTime) {
        const shown = timeText(now, look.hour12);
        besideTime.textContent = shown.suffix ? `${shown.hm} ${shown.suffix}` : shown.hm;
      }
    }
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    if (key !== day) {
      day = key;
      if (dateWindow) dateWindow.textContent = `${short.format(now).toUpperCase().slice(0, 3)} ${parts.day}`;
      if (besideDate) besideDate.textContent = dayName(now);
      if (underDate) underDate.textContent = dayName(now);
      if (week) drawWeek(week, now);
    }
  };
}
function drawWeek(host, now) {
  host.replaceChildren(
    ...weekStrip(now).map(
      (day) => h(
        "div",
        { class: "wg-clock-weekday", "data-today": day.today ? "yes" : "no" },
        h("span", { class: "wg-clock-weekletter", text: day.letter, "aria-hidden": "true" }),
        h("span", { class: "wg-clock-weeknum", text: String(day.day), "aria-hidden": "true" }),
        said(day.today ? `${day.label}, today` : day.label)
      )
    )
  );
}
var worldclock = (ctx) => {
  const asked = parseWorldClocks(text(ctx.settings, "zones", ""), 8);
  const hour12 = flag(ctx.settings, "hour12") || ctx.hour12;
  if (asked.clocks.length === 0) {
    const named = asked.unknown.slice(0, 2).join(", ");
    ctx.show.needs(named === "" ? "Add a place to see the time there" : `This computer does not know a place called ${named}`, "Choose places");
    return;
  }
  const most = ctx.size === "small" ? 1 : ctx.size === "medium" ? 3 : 5;
  const stacked = ctx.size === "tall";
  const root = h("div", { class: "wg-world", "data-size": ctx.size });
  ctx.body.appendChild(root);
  const places = asked.clocks.slice(0, most).map((one) => drawPlace(root, one, { hour12, stacked }));
  const over = asked.clocks.length - places.length;
  const left = [];
  if (over > 0) left.push(over === 1 ? "1 more place is set" : `${over} more places are set`);
  if (asked.unknown.length > 0) left.push(`not a known place: ${asked.unknown.slice(0, 2).join(", ")}`);
  if (left.length > 0) ctx.show.note(left.join(" \xB7 "));
  const tick = () => {
    const now = ctx.now();
    for (const place of places) place(now);
  };
  tick();
  ctx.every(15e3, tick);
};
function drawPlace(root, place, look) {
  const dial2 = svg("svg", { class: "wg-world-dial", viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" });
  const half = (cls, from) => svg("circle", { class: cls, cx: 50, cy: 50, r: 41, fill: "none", "stroke-width": 10, pathLength: 100, "stroke-dasharray": "50 50", "stroke-dashoffset": -from, transform: "rotate(-90 50 50)" });
  dial2.append(half("wg-world-night", 75), half("wg-world-day", 25));
  const marker = svg("circle", { class: "wg-world-marker", cx: 50, cy: 9, r: 5 });
  dial2.appendChild(marker);
  const inside = look.stacked ? null : svg("text", { class: "wg-world-inside", x: 50, y: 56, "text-anchor": "middle" });
  if (inside) dial2.appendChild(inside);
  const label = h("span", { class: "wg-world-label" });
  const gap = h("span", { class: "wg-world-gap" });
  const aside = look.stacked ? h("span", { class: "wg-world-time" }) : null;
  const spoken2 = said("");
  const row2 = h("div", { class: "wg-world-place" }, dial2, h("div", { class: "wg-world-words" }, label, gap), aside, spoken2);
  root.appendChild(row2);
  return (now) => {
    label.textContent = place.label;
    const parts = clockParts(now, place.zone);
    if (!parts) {
      gap.textContent = "Not a place this computer knows";
      spoken2.textContent = `${place.label}: not a place this computer knows`;
      return;
    }
    const at2 = onCircle(dayFraction(parts) * 360, 41);
    marker.setAttribute("cx", at2.x.toFixed(2));
    marker.setAttribute("cy", at2.y.toFixed(2));
    const shown = timeText(now, look.hour12, false, place.zone);
    const full = shown.suffix ? `${shown.hm} ${shown.suffix}` : shown.hm;
    if (inside) inside.textContent = shown.hm;
    if (aside) aside.textContent = full;
    const minutes = zoneOffsetMinutes(place.zone, new Date(now)) + new Date(now).getTimezoneOffset();
    gap.textContent = look.stacked ? offsetWords(minutes) : offsetShort(minutes);
    spoken2.textContent = `${place.label}, ${full}, ${offsetWords(minutes)}`;
  };
}

// orbis-ui/newtab/widgets/renderers/time/countdown.ts
var DATE_IN_FULL = new Intl.DateTimeFormat(void 0, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
var countdown = (ctx) => {
  const title = text(ctx.settings, "title").trim();
  const when = readDay(text(ctx.settings, "date"));
  if (when === null) {
    ctx.show.needs("Choose a date to count down to", "Choose a date");
    return;
  }
  const root = h("div", { class: "wg-countdown", "data-size": ctx.size });
  const big = h("span", { class: "wg-countdown-big" });
  const unit = h("span", { class: "wg-countdown-unit", "aria-hidden": "true" });
  const face = h("div", { class: "wg-countdown-face" }, big, unit);
  const dial2 = h("div", { class: "wg-countdown-dial" }, face);
  root.appendChild(dial2);
  const sub = h("p", { class: "wg-countdown-sub" });
  const words = h("div", { class: "wg-countdown-words" }, title === "" ? null : h("p", { class: "wg-countdown-title", text: title }), sub);
  if (ctx.size !== "small") words.appendChild(h("p", { class: "wg-countdown-when", text: DATE_IN_FULL.format(when) }));
  root.appendChild(words);
  const spoken2 = said("");
  root.appendChild(spoken2);
  ctx.body.appendChild(root);
  let drawn = "";
  const tick = () => {
    const now = ctx.now();
    const gap = span(when, now);
    const figure = countdownFigure(gap);
    const run = progress(ctx.instance.addedAt, when, now);
    const key = `${figure.big}|${figure.unit}|${figure.sub}|${run === null ? "none" : run.toFixed(3)}`;
    if (key === drawn) return;
    drawn = key;
    big.textContent = figure.big;
    unit.textContent = figure.unit;
    sub.textContent = figure.sub;
    root.dataset.past = gap.past ? "yes" : "no";
    const arc = ring({ fraction: gap.past ? 1 : run, width: 7, arcClass: "wg-countdown-arc" });
    const old = dial2.querySelector(".wg-time-ring");
    if (old) old.replaceWith(arc);
    else dial2.insertBefore(arc, face);
    spoken2.textContent = `${figure.big} ${figure.unit}${figure.sub ? ` ${figure.sub}` : ""}${title ? ` until ${title}` : ""}, ${DATE_IN_FULL.format(when)}`;
  };
  tick();
  ctx.every(3e4, tick);
};

// orbis-ui/newtab/widgets/renderers/time/timer.ts
var timer = (ctx) => {
  const live = {
    minutes: number(ctx.settings, "minutes", 25),
    breakMinutes: number(ctx.settings, "breakMinutes", 5),
    phase: text(ctx.settings, "phase", "focus"),
    endsAt: number(ctx.settings, "endsAt", 0),
    pausedMs: number(ctx.settings, "pausedMs", 0),
    finishedAt: number(ctx.settings, "finishedAt", 0)
  };
  const small = ctx.size === "small";
  const root = h("div", { class: "wg-timer", "data-size": ctx.size });
  const leftText = h("span", { class: "wg-timer-left" });
  const unit = h("span", { class: "wg-timer-unit", "aria-hidden": "true" });
  const band2 = ring({ fraction: 1, width: 8, arcClass: "wg-timer-arc" });
  const dial2 = h("div", { class: "wg-timer-dial" }, band2, h("div", { class: "wg-timer-face" }, leftText, unit));
  const side = h("div", { class: "wg-timer-side" });
  const announce = h("p", { class: small ? "wg-time-said" : "wg-timer-say", role: "status", "aria-live": "polite" });
  root.append(dial2, side, announce);
  ctx.body.appendChild(root);
  const lengthOf = (phase) => Math.max(6e4, Math.round(phase === "rest" ? live.breakMinutes : live.minutes) * 6e4);
  const keep = (change) => {
    Object.assign(live, change);
    const out = {};
    if (change.minutes !== void 0) out.minutes = change.minutes;
    if (change.phase !== void 0) out.phase = change.phase;
    if (change.endsAt !== void 0) out.endsAt = change.endsAt;
    if (change.pausedMs !== void 0) out.pausedMs = change.pausedMs;
    if (change.finishedAt !== void 0) out.finishedAt = change.finishedAt;
    ctx.save(out);
    paint();
  };
  const begin = (phase, carryOn = false) => {
    const run = carryOn && live.pausedMs > 0 ? live.pausedMs : lengthOf(phase);
    keep({ phase, endsAt: ctx.now() + run, pausedMs: 0, finishedAt: 0 });
  };
  const pause = () => keep({ pausedMs: Math.max(1e3, live.endsAt - ctx.now()), endsAt: 0 });
  const reset = () => keep({ phase: "focus", endsAt: 0, pausedMs: 0, finishedAt: 0 });
  const choose = (minutes) => keep({ minutes, phase: "focus", endsAt: 0, pausedMs: 0, finishedAt: 0 });
  function paint() {
    const standing = timerStanding(live, ctx.now());
    root.dataset.state = standing.state;
    root.dataset.phase = standing.phase;
    const keys = h("div", { class: "wg-timer-keys" });
    const add2 = (label, run, mark3, primary = false) => {
      keys.appendChild(pressable(ctx.preview, label, run, small ? mark3 : label, small ? "wg-icon-btn" : primary ? "wg-btn primary" : "wg-btn"));
    };
    if (standing.state === "running") add2("Pause", pause, pauseGlyph(), true);
    else if (standing.state === "done" && standing.phase === "focus") add2("Start the rest", () => begin("rest"), playGlyph(), true);
    else if (standing.state === "paused") add2("Carry on", () => begin(standing.phase, true), playGlyph(), true);
    else add2(standing.state === "done" ? "Start another stretch" : "Start", () => begin("focus"), playGlyph(), true);
    if (standing.state !== "idle") add2("Reset", reset, resetGlyph());
    side.replaceChildren();
    if (!small) {
      side.appendChild(h("p", { class: "wg-timer-phase", text: standing.phase === "rest" ? "Rest" : "Focus" }));
      if (standing.state === "running") side.appendChild(h("p", { class: "wg-timer-ends", text: `Ends at ${clockTime(live.endsAt, ctx.hour12)}` }));
      else if (standing.state === "idle") side.appendChild(lengths());
    }
    side.appendChild(keys);
    announce.textContent = standing.state !== "done" ? "" : standing.phase === "rest" ? "The rest is over." : "Focus time is up. Take a rest.";
    show(standing.state, standing.leftMs, standing.totalMs, standing.phase);
  }
  function lengths() {
    const row2 = h("div", { class: "wg-timer-lengths", role: "group", "aria-label": "How long" });
    for (const minutes of TIMER_LENGTHS) {
      const chip = pressable(ctx.preview, `${minutes} minutes of focus`, () => choose(minutes), String(minutes), "wg-timer-length");
      chip.setAttribute("aria-pressed", Math.round(live.minutes) === minutes ? "true" : "false");
      row2.appendChild(chip);
    }
    return row2;
  }
  function show(state, leftMs, totalMs, phase) {
    leftText.textContent = timerText(state === "done" ? 0 : leftMs);
    unit.textContent = state === "done" ? "Time is up" : state === "paused" ? "Paused" : phase === "rest" ? "Rest" : "Focus";
    const run = totalMs > 0 ? Math.min(1, Math.max(0, leftMs / totalMs)) : 0;
    band2.querySelector(".wg-time-ring-arc")?.setAttribute("stroke-dasharray", `${(run * 100).toFixed(2)} 100`);
  }
  const tick = () => {
    const standing = timerStanding(live, ctx.now());
    if (standing.state === "done" && live.endsAt > 0) {
      const ended = live.endsAt;
      keep({ endsAt: 0, pausedMs: 0, finishedAt: ended });
      return;
    }
    if (standing.state === "running") show(standing.state, standing.leftMs, standing.totalMs, standing.phase);
  };
  paint();
  ctx.every(1e3, tick);
};
var glyph = (...children) => svg("svg", { class: "wg-timer-glyph", viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false" }, ...children);
var playGlyph = () => glyph(svg("path", { d: "M5.2 3.3 13 8l-7.8 4.7Z" }));
var pauseGlyph = () => glyph(svg("rect", { x: 4.2, y: 3.4, width: 2.8, height: 9.2, rx: 1.2 }), svg("rect", { x: 9, y: 3.4, width: 2.8, height: 9.2, rx: 1.2 }));
var resetGlyph = () => glyph(svg("path", { class: "wg-timer-stroke", d: "M12.9 8a4.9 4.9 0 1 1-1.7-3.7", fill: "none" }), svg("path", { d: "M12.5 1.8v3.5H9Z" }));

// orbis-ui/newtab/widgets/renderers/time/calculator.ts
var KEYS = Object.freeze([
  { area: "clr", mark: "C", label: "Clear" },
  { area: "opn", mark: "(", label: "Open bracket", types: "(" },
  { area: "cls", mark: ")", label: "Close bracket", types: ")" },
  { area: "pct", mark: "%", label: "Per cent", types: "%" },
  { area: "div", mark: "\xF7", label: "Divide", types: "\xF7" },
  { area: "mul", mark: "\xD7", label: "Multiply", types: "\xD7" },
  { area: "sub", mark: "\u2212", label: "Take away", types: "\u2212" },
  { area: "add", mark: "+", label: "Add", types: "+" },
  { area: "dot", mark: ".", label: "Point", types: "." },
  { area: "eq", mark: "=", label: "Work it out" },
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => ({ area: `k${digit}`, mark: String(digit), label: String(digit), types: String(digit) }))
]);
var calculator = (ctx) => {
  const kept = typing(ctx.body, text(ctx.settings, "sum"));
  const root = h("div", { class: "wg-calc", "data-size": ctx.size });
  const box = quiet(
    ctx.preview,
    h("input", {
      class: "wg-calc-typed",
      type: "text",
      inputmode: "text",
      autocomplete: "off",
      spellcheck: "false",
      maxlength: "120",
      "aria-label": "The sum",
      placeholder: "0"
    })
  );
  box.value = kept.text;
  const answer = h("p", { class: ctx.size === "small" ? "wg-time-said" : "wg-calc-answer", role: "status", "aria-live": "polite" });
  root.appendChild(h("div", { class: "wg-calc-screen" }, box, answer));
  const pad = h("div", { class: "wg-calc-pad", role: "group", "aria-label": "Calculator keys" });
  for (const key of KEYS) {
    const press2 = key.area === "clr" ? clearAll : key.area === "eq" ? workItOut : () => type(key.types ?? "");
    const button2 = pressable(ctx.preview, key.label, press2, key.mark, "wg-calc-key");
    button2.style.setProperty("grid-area", key.area);
    button2.dataset.key = key.area;
    pad.appendChild(button2);
  }
  root.appendChild(pad);
  ctx.body.appendChild(root);
  function hold(value, caret) {
    box.value = value;
    kept.text = value;
    kept.caret = caret ?? value.length;
    if (caret !== void 0) {
      try {
        box.setSelectionRange(caret, caret);
      } catch {
      }
    }
    ctx.save({ sum: value });
    say();
  }
  function say() {
    const sum = calculate(box.value);
    answer.textContent = sum.ok ? sumText(sum.value) : sum.error;
    root.dataset.wrong = !sum.ok && sum.error !== "" ? "yes" : "no";
  }
  function type(what) {
    const from = box.selectionStart ?? box.value.length;
    const to = box.selectionEnd ?? from;
    const next = `${box.value.slice(0, from)}${what}${box.value.slice(to)}`.slice(0, 120);
    box.focus({ preventScroll: true });
    hold(next, Math.min(from + what.length, next.length));
  }
  function clearAll() {
    box.focus({ preventScroll: true });
    hold("");
  }
  function workItOut() {
    const sum = calculate(box.value);
    if (!sum.ok) return say();
    box.focus({ preventScroll: true });
    hold(sumValue(sum.value));
  }
  if (!ctx.preview) {
    box.addEventListener("input", () => {
      kept.text = box.value;
      kept.caret = box.selectionStart ?? box.value.length;
      ctx.save({ sum: box.value });
      say();
    });
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        workItOut();
      } else if (event.key === "Escape") {
        event.preventDefault();
        clearAll();
      }
    });
  }
  resume(box, kept);
  sendBack(ctx.preview, kept, (value) => ctx.save({ sum: value }));
  say();
};
function sendBack(preview, kept, save) {
  if (preview || kept.text === kept.base) return;
  save(kept.text);
}

// src/shared/widgets.ts
var CATEGORY_NAMES = Object.freeze({
  time: "Time",
  productivity: "Productivity",
  information: "Information",
  browser: "Browser",
  orion: "Orion",
  utility: "Utilities"
});
var WIDGET_SIZES = Object.freeze(["small", "medium", "tall", "large", "wide"]);
var SIZE_NAMES = Object.freeze({ small: "Small", medium: "Medium", tall: "Tall", large: "Large", wide: "Wide" });
var SURFACE_NAMES = Object.freeze({ start: "Start page" });
var PERMISSION_WORDS = {
  tasks: "Read your tasks",
  notes: "Read your notes",
  clipboard: "Read your clipboard history",
  whiteboard: "Read your whiteboards",
  workspaces: "Read your workspaces",
  bookmarks: "Read your bookmarks",
  history: "Read your browsing history",
  downloads: "Read your downloads",
  tabs: "Read the tabs you have open",
  games: "Read your offline game scores",
  orion: "Ask Orion",
  network: "Fetch things from the internet"
};
var DEFAULT_LOOK = Object.freeze({ tone: "glass", density: "comfortable" });
var LOOK_TONES = Object.freeze(["glass", "solid", "tint", "clear"]);
var TONE_NAMES = Object.freeze({ glass: "Glass", solid: "Solid", tint: "Tinted", clear: "No card" });
var setting = (name, label, type, value, extra = {}) => ({ name, label, type, default: value, ...extra });
var WIDGETS = [
  {
    id: "clock",
    name: "Clock",
    description: "The time and date, in your own format.",
    category: "time",
    version: 1,
    sizes: ["small", "medium", "large"],
    defaultSize: "small",
    permissions: [],
    settings: [
      setting("face", "Face", "choice", "digital", { choices: [{ value: "digital", label: "Digital" }, { value: "analog", label: "Hands" }] }),
      setting("seconds", "Show seconds", "boolean", false),
      setting("date", "Show the date", "boolean", true),
      setting("hour12", "Twelve-hour clock", "boolean", false)
    ],
    refreshMs: 1e3,
    icon: "clock",
    tags: ["time", "date", "hour", "watch", "analog", "digital"],
    surfaces: ["start"],
    sources: [],
    network: false,
    featured: true,
    author: "Orbis"
  },
  {
    id: "countdown",
    name: "Countdown",
    description: "How long until something you are waiting for.",
    category: "time",
    version: 1,
    sizes: ["small", "medium"],
    defaultSize: "small",
    permissions: [],
    settings: [setting("title", "What for", "text", "Something to look forward to", { placeholder: "Exam, trip, birthday\u2026" }), setting("date", "When (YYYY-MM-DD)", "text", "", { placeholder: "2027-01-31" })],
    refreshMs: 6e4,
    icon: "hourglass",
    tags: ["exam", "deadline", "days until", "event", "birthday", "study"],
    surfaces: ["start"],
    sources: [],
    network: false,
    featured: true,
    author: "Orbis"
  },
  {
    id: "timer",
    name: "Focus timer",
    description: "A timer for a stretch of focused work, with a rest after it.",
    category: "productivity",
    version: 2,
    sizes: ["small", "medium"],
    defaultSize: "small",
    permissions: [],
    settings: [
      setting("minutes", "Minutes of focus", "number", 25, { min: 1, max: 180 }),
      setting("breakMinutes", "Minutes of rest", "number", 5, { min: 1, max: 60 }),
      // Where the timer actually stands, kept with the widget so a reload picks it up where it really is rather
      // than starting it again from the top. Set by pressing the card, so none of it appears in the settings form.
      setting("phase", "Which stretch", "choice", "focus", { onCard: true, choices: [{ value: "focus", label: "Focus" }, { value: "rest", label: "Rest" }] }),
      setting("endsAt", "When it runs out", "number", 0, { min: 0, onCard: true }),
      setting("pausedMs", "What was left when it was paused", "number", 0, { min: 0, onCard: true }),
      setting("finishedAt", "When it last ran out", "number", 0, { min: 0, onCard: true })
    ],
    refreshMs: 1e3,
    icon: "timer",
    tags: ["pomodoro", "focus", "concentrate", "study", "break", "stopwatch"],
    surfaces: ["start"],
    sources: [],
    network: false,
    featured: true,
    author: "Orbis"
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "What is due today, straight from your tasks. Ticking one off here really ticks it off.",
    category: "productivity",
    version: 1,
    // Small is the dial on its own -- how many are due, on a ring of the day -- with no room to list any of them.
    sizes: ["small", "medium", "tall", "large"],
    defaultSize: "medium",
    permissions: ["tasks"],
    settings: [setting("view", "Which tasks", "choice", "today", { choices: [{ value: "today", label: "Due today" }, { value: "overdue", label: "Overdue" }, { value: "flagged", label: "Important" }, { value: "all", label: "Everything" }] }), setting("limit", "How many", "number", 5, { min: 1, max: 20 })],
    refreshMs: 0,
    icon: "check",
    tags: ["to-do", "todo", "due", "today", "plan"],
    surfaces: ["start"],
    sources: ["Your Orbis tasks"],
    network: false,
    featured: true,
    author: "Orbis"
  },
  {
    id: "notes",
    name: "Notes",
    description: "Your most recent notes, and a way to start a new one.",
    category: "productivity",
    version: 1,
    sizes: ["medium", "tall", "large"],
    defaultSize: "medium",
    permissions: ["notes"],
    settings: [setting("limit", "How many", "number", 4, { min: 1, max: 12 })],
    refreshMs: 0,
    icon: "note",
    tags: ["writing", "ideas", "notebook"],
    surfaces: ["start"],
    sources: ["Your Orbis notes"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    description: "Bookmarks you can open in a click.",
    category: "browser",
    version: 1,
    sizes: ["medium", "tall", "large"],
    defaultSize: "medium",
    permissions: ["bookmarks"],
    settings: [setting("limit", "How many", "number", 6, { min: 1, max: 20 })],
    refreshMs: 0,
    icon: "bookmark",
    tags: ["favourites", "saved sites", "links"],
    surfaces: ["start"],
    sources: ["Your browser bookmarks"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "downloads",
    name: "Downloads",
    description: "What you have downloaded lately, and anything still coming.",
    category: "browser",
    version: 1,
    sizes: ["medium", "tall"],
    defaultSize: "medium",
    permissions: ["downloads"],
    settings: [setting("limit", "How many", "number", 4, { min: 1, max: 12 })],
    refreshMs: 0,
    icon: "download",
    tags: ["files", "saved", "progress", "track downloads"],
    surfaces: ["start"],
    sources: ["Your browser downloads"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "tabs",
    name: "Open tabs",
    description: "How many tabs and groups are open, and a way back to any of them.",
    category: "browser",
    version: 1,
    sizes: ["small", "medium", "tall"],
    defaultSize: "small",
    permissions: ["tabs"],
    settings: [setting("limit", "How many to list", "number", 5, { min: 1, max: 20 })],
    refreshMs: 0,
    icon: "tabs",
    tags: ["open pages", "windows", "groups"],
    surfaces: ["start"],
    sources: ["The tabs you have open"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "workspaces",
    name: "Workspaces",
    description: "Your saved sets of pages, to switch between them from here.",
    category: "browser",
    version: 1,
    sizes: ["medium", "tall"],
    defaultSize: "medium",
    permissions: ["workspaces"],
    settings: [],
    refreshMs: 0,
    icon: "layers",
    tags: ["sets of tabs", "projects", "sessions", "switch"],
    surfaces: ["start"],
    sources: ["Your Orbis workspaces"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "clipboard",
    name: "Clipboard",
    description: "The last things you copied, ready to copy again.",
    category: "utility",
    version: 1,
    sizes: ["medium", "tall"],
    defaultSize: "medium",
    permissions: ["clipboard"],
    settings: [setting("limit", "How many", "number", 4, { min: 1, max: 12 })],
    refreshMs: 0,
    icon: "clipboard",
    tags: ["copied", "paste", "copy again"],
    surfaces: ["start"],
    sources: ["What you have copied, as Orbis keeps it"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "whiteboard",
    name: "Whiteboards",
    description: "Your boards, and how much is on each.",
    category: "productivity",
    version: 1,
    sizes: ["medium", "tall"],
    defaultSize: "medium",
    permissions: ["whiteboard"],
    settings: [setting("limit", "How many", "number", 3, { min: 1, max: 10 })],
    refreshMs: 0,
    icon: "board",
    tags: ["sketch", "draw", "canvas", "boards"],
    surfaces: ["start"],
    sources: ["Your Orbis whiteboards"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "quote",
    name: "Quote",
    description: "A line worth reading, from a small collection kept on this computer.",
    category: "information",
    version: 2,
    sizes: ["medium", "large", "wide"],
    defaultSize: "medium",
    permissions: [],
    settings: [
      setting("rotation", "Change it", "choice", "daily", { choices: [{ value: "daily", label: "Every day" }, { value: "launch", label: "Every time Orbis starts" }, { value: "manual", label: "Only when I ask" }] }),
      // Which line "Another" has reached. Pressed on the card, so it is not a thing to type into a form.
      setting("pick", "Which line", "number", 0, { min: 0, max: 1e5, onCard: true })
    ],
    refreshMs: 0,
    icon: "quote",
    tags: ["inspiration", "words", "reading", "motivation"],
    surfaces: ["start"],
    sources: ["A small collection kept inside Orbis"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "games",
    name: "Offline games",
    description: "The game of the day and your best scores from the offline page.",
    category: "information",
    version: 1,
    sizes: ["small", "medium"],
    defaultSize: "small",
    permissions: ["games"],
    settings: [],
    refreshMs: 0,
    icon: "game",
    tags: ["play", "scores", "offline"],
    surfaces: [],
    sources: ["Your offline game scores"],
    network: false,
    featured: false,
    unavailable: "Offline game scores are kept by the Orbis window, where the start page cannot read them yet.",
    author: "Orbis"
  },
  {
    id: "calculator",
    name: "Calculator",
    description: "Works out what you type, without leaving the page.",
    category: "utility",
    version: 2,
    sizes: ["small", "medium", "tall"],
    defaultSize: "small",
    permissions: [],
    // The sum stays on the card across a reload, which is the difference between a calculator and a scrap of paper
    // that is thrown away whenever you open another tab. Typed on the card, so it is not also a box in the form.
    settings: [setting("sum", "The sum", "text", "", { maxLength: 120, onCard: true })],
    refreshMs: 0,
    icon: "calculator",
    tags: ["sum", "maths", "math", "arithmetic", "work out"],
    surfaces: ["start"],
    sources: [],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "greeting",
    name: "Greeting",
    description: "Good morning, afternoon or evening, by your own clock, with the date.",
    category: "time",
    version: 1,
    sizes: ["medium", "wide"],
    defaultSize: "wide",
    permissions: [],
    settings: [setting("name", "Your name", "text", ""), setting("date", "Show the date", "boolean", true)],
    refreshMs: 6e4,
    icon: "sun",
    tags: ["hello", "good morning", "welcome", "name"],
    surfaces: ["start"],
    sources: [],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "worldclock",
    name: "World clock",
    description: "The time in other places, with daylight saving worked out for each.",
    category: "time",
    version: 1,
    sizes: ["small", "medium", "tall"],
    defaultSize: "medium",
    permissions: [],
    settings: [
      setting("zones", "Places (Label=Area/City, separated by commas)", "text", "London=Europe/London, New York=America/New_York, Tokyo=Asia/Tokyo"),
      setting("hour12", "12-hour clock", "boolean", false)
    ],
    refreshMs: 6e4,
    icon: "globe",
    tags: ["time zones", "other countries", "abroad", "travel", "meeting"],
    surfaces: ["start"],
    sources: [],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "weather",
    name: "Weather",
    description: "The weather for a city you choose, from MET Norway. No location permission needed.",
    category: "information",
    version: 1,
    sizes: ["small", "medium", "large"],
    defaultSize: "small",
    permissions: ["network"],
    settings: [
      setting("city", "City", "text", "", { placeholder: "A city, such as Chennai" }),
      setting("unit", "Temperature", "choice", "c", { choices: [{ value: "c", label: "Celsius" }, { value: "f", label: "Fahrenheit" }] }),
      setting("hours", "Show the next few hours", "boolean", true)
    ],
    refreshMs: 30 * 6e4,
    icon: "cloud",
    tags: ["forecast", "temperature", "rain", "sun", "city"],
    surfaces: ["start"],
    sources: ["MET Norway (api.met.no) for the forecast", "OpenStreetMap for finding the city"],
    network: true,
    featured: true,
    author: "Orbis"
  },
  {
    id: "news",
    name: "News",
    description: "Headlines from RSS or Atom feeds you choose. Nothing is chosen for you.",
    category: "information",
    version: 1,
    sizes: ["medium", "tall", "large"],
    defaultSize: "medium",
    permissions: ["network"],
    settings: [setting("feeds", "Feed addresses, separated by commas", "text", "", { maxLength: 1200, placeholder: "https://example.com/feed.xml" }), setting("limit", "How many headlines", "number", 6, { min: 1, max: 20 })],
    // The widget asks again on this, so what the widget's own page says it does is what it does.
    refreshMs: 15 * 6e4,
    icon: "news",
    tags: ["headlines", "rss", "feeds", "atom", "reading", "discover"],
    surfaces: ["start"],
    sources: ["The RSS or Atom feeds you choose, and nothing else"],
    network: true,
    featured: false,
    author: "Orbis"
  },
  {
    id: "recent",
    name: "Recent sites",
    description: "The sites you visited most recently, one line each.",
    category: "browser",
    version: 1,
    sizes: ["medium", "tall", "large"],
    defaultSize: "medium",
    permissions: ["history"],
    settings: [setting("limit", "How many", "number", 6, { min: 1, max: 20 })],
    refreshMs: 0,
    icon: "history",
    tags: ["history", "visited", "top sites", "go back"],
    surfaces: ["start"],
    sources: ["Your browsing history, as the browser keeps it"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "notepad",
    name: "Sticky note",
    description: "A note kept on the page itself, for whatever is in hand.",
    category: "productivity",
    version: 1,
    sizes: ["small", "medium", "tall", "large"],
    defaultSize: "small",
    permissions: [],
    settings: [
      setting("text", "What it says", "text", "", { maxLength: 4e3, onCard: true }),
      setting("colour", "Paper", "choice", "amber", { choices: [{ value: "amber", label: "Amber" }, { value: "mint", label: "Mint" }, { value: "sky", label: "Sky" }, { value: "rose", label: "Rose" }, { value: "plain", label: "Plain" }] })
    ],
    refreshMs: 0,
    icon: "sticky",
    tags: ["sticky", "scratch", "jot", "reminder", "list", "memo"],
    surfaces: ["start"],
    sources: [],
    network: false,
    featured: true,
    author: "Orbis"
  },
  {
    id: "reminders",
    name: "Reminders",
    description: "Tasks with a time on them, soonest first.",
    category: "productivity",
    version: 1,
    sizes: ["medium", "tall"],
    defaultSize: "medium",
    permissions: ["tasks"],
    settings: [setting("limit", "How many", "number", 5, { min: 1, max: 20 })],
    refreshMs: 6e4,
    icon: "bell",
    tags: ["alarm", "due", "schedule", "upcoming", "remember"],
    surfaces: ["start"],
    sources: ["Your Orbis tasks that have a time"],
    network: false,
    featured: false,
    author: "Orbis"
  },
  {
    id: "markets",
    name: "Markets",
    description: "One price you follow, with how it has moved today. From Orbis Markets, with how fresh it is said.",
    category: "information",
    version: 1,
    sizes: ["small", "medium"],
    defaultSize: "small",
    permissions: ["network"],
    settings: [setting("symbol", "Symbol", "text", "BTC", { maxLength: 20, placeholder: "BTC, ETH, SOL\u2026" })],
    refreshMs: 6e4,
    icon: "chart",
    tags: ["price", "crypto", "bitcoin", "ticker", "stock", "trading", "coin"],
    surfaces: ["start"],
    sources: ["Orbis Markets, which reads public exchange prices"],
    network: true,
    featured: true,
    author: "Orbis"
  },
  {
    id: "orion",
    name: "Ask Orion",
    description: "A box to ask Orion from the start page. The answer opens beside what you are doing.",
    category: "orion",
    version: 1,
    sizes: ["medium", "wide"],
    defaultSize: "medium",
    permissions: ["orion"],
    settings: [setting("prompt", "What the box says when it is empty", "text", "Ask Orion anything", { maxLength: 80 })],
    refreshMs: 0,
    icon: "spark",
    tags: ["assistant", "ai", "question", "chat", "help", "ask"],
    surfaces: ["start"],
    sources: [],
    network: true,
    featured: false,
    author: "Orbis"
  }
];
var widgetById = (id) => WIDGETS.find((w) => w.id === id) ?? null;
var isAvailable = (definition, surface = "start") => !definition.unavailable && definition.surfaces.includes(surface);
var permissionsOf = (definition) => definition.permissions.map((p) => PERMISSION_WORDS[p]);
function newWidgetInstance(widget, zone, order) {
  const definition = widgetById(widget);
  if (!definition) return null;
  return {
    id: crypto.randomUUID(),
    widget,
    zone,
    order,
    size: definition.defaultSize,
    settings: Object.fromEntries(definition.settings.map((s) => [s.name, s.default])),
    collapsed: false,
    disabled: false,
    locked: false,
    hidden: false,
    look: { ...DEFAULT_LOOK },
    addedAt: Date.now()
  };
}
var clampSetting = (spec, value) => {
  if (spec.type === "boolean") return typeof value === "boolean" ? value : Boolean(spec.default);
  if (spec.type === "number") {
    const n = typeof value === "number" && Number.isFinite(value) ? value : Number(spec.default);
    return Math.min(spec.max ?? Number.MAX_SAFE_INTEGER, Math.max(spec.min ?? Number.MIN_SAFE_INTEGER, n));
  }
  if (spec.type === "choice") {
    const allowed = (spec.choices ?? []).map((c) => c.value);
    return typeof value === "string" && allowed.includes(value) ? value : String(spec.default);
  }
  return typeof value === "string" ? value.slice(0, spec.maxLength ?? 300) : String(spec.default);
};
var clampWidgetSetting = (spec, value) => clampSetting(spec, value);

// src/shared/widgetBoard.ts
var SIZE_SPAN = Object.freeze({
  small: { w: 1, h: 1 },
  medium: { w: 2, h: 1 },
  tall: { w: 1, h: 2 },
  large: { w: 2, h: 2 },
  // A full row, however many columns the page has.
  wide: { w: 99, h: 1 }
});
var GRID = Object.freeze({
  /** The side of one cell at its smallest, and the space between cells. */
  cell: 156,
  gap: 14,
  /** The most columns, on the widest page. */
  maxColumns: 6
});
function columnsFor(width) {
  if (!Number.isFinite(width) || width <= 0) return 1;
  const fit = Math.floor((width + GRID.gap) / (GRID.cell + GRID.gap));
  return Math.min(GRID.maxColumns, Math.max(1, fit));
}
function packBoard(instances, columns) {
  const cols = Math.max(1, Math.floor(columns));
  const taken = [];
  const free = (x, y, w, h2) => {
    for (let r = y; r < y + h2; r++) for (let c = x; c < x + w; c++) if (taken[r]?.[c]) return false;
    return true;
  };
  const placed = [];
  let from = 0;
  for (const one of visibleWidgets(instances)) {
    const span2 = SIZE_SPAN[one.size];
    const w = Math.min(cols, span2.w);
    const h2 = span2.h;
    let at2 = from;
    for (; ; ) {
      const x = at2 % cols;
      const y = Math.floor(at2 / cols);
      if (x + w <= cols && free(x, y, w, h2)) {
        for (let r = y; r < y + h2; r++) {
          taken[r] ??= [];
          for (let c = x; c < x + w; c++) taken[r][c] = true;
        }
        placed.push({ id: one.id, x, y, w, h: h2 });
        from = at2;
        break;
      }
      at2 += 1;
    }
  }
  return { placed, rows: placed.reduce((most, one) => Math.max(most, one.y + one.h), 0) };
}
var visibleWidgets = (instances) => [...instances].filter((one) => !one.hidden && !one.disabled).sort((a, b) => a.order - b.order || a.addedAt - b.addedAt);
var orderedWidgets = (instances) => [...instances].sort((a, b) => a.order - b.order || a.addedAt - b.addedAt);
var BOARD_LIMITS = Object.freeze({ favourites: 40, recent: 12 });
var emptyBoard = () => ({ enabled: true, instances: [], favourites: [], recent: [] });
function mergeSettings(definition, current, given) {
  return Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, Object.prototype.hasOwnProperty.call(given, spec.name) ? given[spec.name] : current[spec.name])]));
}
var WIDGET_PRESETS = Object.freeze([
  { id: "minimal", name: "Minimal", describe: "A clock and a note. Nothing else on the page.", widgets: [{ widget: "clock", size: "medium" }, { widget: "notepad", size: "small" }] },
  {
    id: "study",
    name: "Study",
    describe: "Time left, a focus timer, what is due, and somewhere to jot.",
    widgets: [{ widget: "clock", size: "small" }, { widget: "countdown", size: "small" }, { widget: "timer", size: "medium" }, { widget: "tasks", size: "tall" }, { widget: "notepad", size: "medium" }, { widget: "calculator", size: "small" }]
  },
  {
    id: "work",
    name: "Work",
    describe: "Today\u2019s tasks and reminders, the time where your colleagues are, and your notes.",
    widgets: [{ widget: "greeting", size: "wide" }, { widget: "tasks", size: "large" }, { widget: "reminders", size: "medium" }, { widget: "worldclock", size: "medium" }, { widget: "notes", size: "medium" }, { widget: "weather", size: "small" }]
  },
  {
    id: "research",
    name: "Research",
    describe: "Where you have been, what you saved, your notes, and the feeds you follow.",
    widgets: [{ widget: "recent", size: "tall" }, { widget: "bookmarks", size: "medium" }, { widget: "notes", size: "medium" }, { widget: "news", size: "large" }, { widget: "notepad", size: "medium" }, { widget: "orion", size: "medium" }]
  },
  {
    id: "development",
    name: "Development",
    describe: "Open tabs, downloads, the clipboard, and a timer for the next stretch.",
    widgets: [{ widget: "clock", size: "small" }, { widget: "timer", size: "small" }, { widget: "tabs", size: "tall" }, { widget: "downloads", size: "medium" }, { widget: "clipboard", size: "medium" }, { widget: "calculator", size: "small" }, { widget: "workspaces", size: "medium" }]
  },
  {
    id: "personal",
    name: "Personal",
    describe: "A greeting, the weather, a line worth reading, a price you follow, and a note.",
    widgets: [{ widget: "greeting", size: "wide" }, { widget: "weather", size: "medium" }, { widget: "quote", size: "medium" }, { widget: "markets", size: "small" }, { widget: "notepad", size: "small" }, { widget: "clock", size: "small", settings: { face: "analog" } }]
  }
]);
function presetInstances(preset, now = Date.now(), makeId = () => crypto.randomUUID()) {
  const out = [];
  for (const [order, wanted] of preset.widgets.entries()) {
    const definition = widgetById(wanted.widget);
    if (!definition) return { error: `The "${preset.name}" layout needs a widget Orbis does not have: ${wanted.widget}.` };
    if (!isAvailable(definition)) return { error: `The "${preset.name}" layout needs ${definition.name}, which cannot be added: ${definition.unavailable ?? "it is not available here"}` };
    const size = wanted.size ?? definition.defaultSize;
    if (!definition.sizes.includes(size)) return { error: `The "${preset.name}" layout asks for ${definition.name} in ${SIZE_NAMES[size]}, which it does not come in.` };
    const made3 = newWidgetInstance(definition.id, "centre", order);
    out.push({ ...made3, id: makeId(), order, size, settings: mergeSettings(definition, made3.settings, wanted.settings ?? {}), addedAt: now + order });
  }
  return { instances: out };
}
var haystack = (definition) => ({
  name: definition.name.toLowerCase(),
  tags: definition.tags.map((one) => one.toLowerCase()),
  rest: `${definition.description} ${CATEGORY_NAMES[definition.category]} ${definition.sources.join(" ")} ${definition.sizes.map((one) => SIZE_NAMES[one]).join(" ")} ${definition.network ? "online internet" : "offline"}`.toLowerCase()
});
var FILLER = /* @__PURE__ */ new Set(["a", "an", "the", "i", "my", "me", "to", "for", "of", "in", "on", "and", "or", "need", "want", "see", "show", "widget", "widgets", "something", "that", "can", "help", "with", "is", "it", "some", "please", "add", "find", "would", "like"]);
function findWidgets(query, board) {
  const installed = new Set(board.instances.map((one) => one.widget));
  const words = (query.query ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((one) => one !== "" && !FILLER.has(one));
  const scored = [];
  WIDGETS.forEach((definition, at2) => {
    if (query.category && query.category !== "all" && definition.category !== query.category) return;
    if (query.filter === "installed" && !installed.has(definition.id)) return;
    if (query.filter === "favourites" && !board.favourites.includes(definition.id)) return;
    if (query.filter === "offline" && definition.network) return;
    const hay = haystack(definition);
    let score = 0;
    for (const word of words) {
      const stem = word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
      const inName = hay.name.includes(stem);
      const inTag = hay.tags.some((tag) => tag.includes(stem) || stem.length > 3 && stem.includes(tag));
      const inRest = hay.rest.includes(stem);
      if (!inName && !inTag && !inRest) return;
      score += inName ? 6 : inTag ? 3 : 1;
    }
    scored.push({ definition, score, at: at2 });
  });
  return scored.sort((a, b) => b.score - a.score || Number(b.definition.featured) - Number(a.definition.featured) || a.at - b.at).map((one) => one.definition);
}
function galleryCategories() {
  const order = [];
  for (const one of WIDGETS) if (!order.includes(one.category)) order.push(one.category);
  return order.map((id) => ({ id, name: CATEGORY_NAMES[id], count: WIDGETS.filter((one) => one.category === id).length }));
}
function searchSuggestions(limit = 4) {
  const counts = /* @__PURE__ */ new Map();
  for (const one of WIDGETS) if (isAvailable(one)) {
    for (const tag of one.tags) if (!tag.includes(" ")) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag]) => tag);
}
function galleryState(definition, board) {
  if (!isAvailable(definition)) return { state: "unavailable", count: 0, reason: definition.unavailable ?? "Not available on the start page." };
  const mine = board.instances.filter((one) => one.widget === definition.id);
  if (mine.length === 0) return { state: "available", count: 0 };
  if (mine.every((one) => one.disabled)) return { state: "disabled", count: mine.length, reason: "Set aside after it failed several times. It can be started again." };
  if (mine.every((one) => one.hidden || one.disabled)) return { state: "hidden", count: mine.length };
  return { state: "installed", count: mine.length };
}

// orbis-ui/newtab/widgets/studioLogic.ts
var SIDE_BY_SIDE_MOST = 4;
var TEXT_MOST = 300;
function formFields(definition, settings) {
  const fields = [];
  for (const spec of definition.settings) {
    if (spec.onCard) continue;
    const value = clampWidgetSetting(spec, settings[spec.name]);
    if (spec.type === "text") fields.push({ kind: "text", name: spec.name, label: spec.label, value: String(value), maxLength: spec.maxLength ?? TEXT_MOST, placeholder: spec.placeholder ?? "" });
    else if (spec.type === "number") fields.push({ kind: "number", name: spec.name, label: spec.label, value: Number(value), min: spec.min ?? null, max: spec.max ?? null, whole: wholeNumbers(spec), range: rangeWords(spec) });
    else if (spec.type === "boolean") fields.push({ kind: "switch", name: spec.name, label: spec.label, value: value === true });
    else {
      const choices = (spec.choices ?? []).map((one) => ({ value: one.value, label: one.label }));
      if (choices.length < 2) continue;
      fields.push({ kind: choices.length <= SIDE_BY_SIDE_MOST ? "segmented" : "select", name: spec.name, label: spec.label, value: String(value), choices });
    }
  }
  return fields;
}
var defaultSettings = (definition) => Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, spec.default)]));
var clampDraft = (definition, draft) => Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, draft[spec.name])]));
function diffDraft(definition, before, after) {
  const was = clampDraft(definition, before);
  const now = clampDraft(definition, after);
  return Object.fromEntries(definition.settings.filter((spec) => was[spec.name] !== now[spec.name]).map((spec) => [spec.name, now[spec.name]]));
}
var isAsItComes = (definition, settings) => {
  const changed = diffDraft(definition, defaultSettings(definition), settings);
  return definition.settings.every((spec) => spec.onCard || !(spec.name in changed));
};
var wholeNumbers = (spec) => [spec.default, spec.min ?? 0, spec.max ?? 0].every((one) => typeof one === "number" && Number.isInteger(one));
function rangeWords(spec) {
  if (spec.min !== void 0 && spec.max !== void 0) return `From ${spec.min} to ${spec.max}.`;
  if (spec.min !== void 0) return `${spec.min} or more.`;
  if (spec.max !== void 0) return `${spec.max} or fewer.`;
  return "";
}
function readNumber(spec, typed) {
  const text2 = typed.trim();
  const asked = text2 === "" ? Number.NaN : Number(text2);
  if (!Number.isFinite(asked)) {
    const range = rangeWords(spec);
    return { ok: false, error: range === "" ? "Type a number." : `Type a number. ${range}` };
  }
  const wanted = wholeNumbers(spec) ? Math.round(asked) : asked;
  const value = Number(clampWidgetSetting(spec, wanted));
  if (spec.max !== void 0 && wanted > spec.max) return { ok: true, value, note: `${spec.max} is the most.` };
  if (spec.min !== void 0 && wanted < spec.min) return { ok: true, value, note: `${spec.min} is the least.` };
  return { ok: true, value, note: "" };
}
function stepNumber(spec, from, by) {
  const start = Number.isFinite(from) ? from : Number(spec.default);
  return Number(clampWidgetSetting(spec, (wholeNumbers(spec) ? Math.round(start) : start) + by));
}
function roomLeft(length, most) {
  const left = most - length;
  if (most <= 0 || left > Math.max(5, Math.floor(most / 5))) return "";
  if (left <= 0) return "That is as much as fits.";
  return left === 1 ? "1 character left" : `${left} characters left`;
}
function refreshWords(refreshMs) {
  if (!Number.isFinite(refreshMs) || refreshMs <= 0) return "when something changes";
  const seconds = Math.max(1, Math.round(refreshMs / 1e3));
  if (seconds === 1) return "every second";
  if (seconds < 120 && seconds !== 60) return `every ${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes === 1) return "every minute";
  if (minutes < 120 && minutes !== 60) return `every ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "every hour";
  if (hours < 48 && hours !== 24) return `every ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "once a day" : `every ${days} days`;
}
var networkWords = (definition) => definition.network ? "Needs the internet for anything new" : "Works with no connection";
function sizeMeasure(size) {
  const span2 = SIZE_SPAN[size];
  return size === "wide" ? `Full row \xD7 ${span2.h}` : `${span2.w} \xD7 ${span2.h}`;
}
function sizeSpoken(size) {
  if (size === "wide") return `${SIZE_NAMES[size]}, a full row across and 1 cell down`;
  const span2 = SIZE_SPAN[size];
  const cells = (n) => n === 1 ? "1 cell" : `${n} cells`;
  return `${SIZE_NAMES[size]}, ${cells(span2.w)} across and ${span2.h} down`;
}
function sizeGlyph(size) {
  const span2 = SIZE_SPAN[size];
  const columns = size === "wide" ? 3 : 2;
  return { columns, rows: 2, w: Math.min(columns, span2.w), h: Math.min(2, span2.h) };
}
var placeWords = (instance, position) => `${SIZE_NAMES[instance.size]}, place ${position + 1}`;
var STAGE_PAD = 28;
var STAGE_SMALLEST = 0.3;
function sizePixels(size, columns) {
  const span2 = SIZE_SPAN[size];
  const across = Math.min(span2.w, Math.max(1, Math.floor(columns)));
  return { width: across * GRID.cell + (across - 1) * GRID.gap, height: span2.h * GRID.cell + (span2.h - 1) * GRID.gap };
}
function stageFit(size, stageWidth, stageHeight, pad = STAGE_PAD) {
  const room = (side) => Number.isFinite(side) ? Math.max(0, side - 2 * pad) : 0;
  const roomW = room(stageWidth);
  const roomH = room(stageHeight);
  const columns = size === "wide" ? Math.max(2, columnsFor(roomW)) : SIZE_SPAN[size].w;
  const { width, height } = sizePixels(size, columns);
  if (roomW === 0 || roomH === 0) return { width, height, columns, scale: 1 };
  const scale = Math.min(1, roomW / width, roomH / height);
  return { width, height, columns, scale: Math.max(STAGE_SMALLEST, Math.round(scale * 1e3) / 1e3) };
}
var scaleWords = (scale) => scale >= 0.995 ? "Real size" : `Shown at ${Math.round(scale * 100)}% of real size`;
function previewInstance(definition, size, settings) {
  return {
    id: `preview-${definition.id}`,
    widget: definition.id,
    zone: "centre",
    order: 0,
    size: definition.sizes.includes(size) ? size : definition.defaultSize,
    settings: clampDraft(definition, settings),
    collapsed: false,
    disabled: false,
    locked: false,
    hidden: false,
    look: { ...DEFAULT_LOOK },
    addedAt: 0
  };
}

// orbis-ui/newtab/widgets/renderers/time/quotes.ts
var LINES = Object.freeze([
  { text: "The way to get started is to quit talking and begin doing.", who: "Walt Disney" },
  { text: "Simplicity is the soul of efficiency.", who: "Austin Freeman" },
  { text: "It always seems impossible until it\u2019s done.", who: "Nelson Mandela" },
  { text: "What we know is a drop, what we don\u2019t know is an ocean.", who: "Isaac Newton" },
  { text: "Make it work, make it right, make it fast.", who: "Kent Beck" },
  { text: "An ounce of practice is worth more than tons of preaching.", who: "Mahatma Gandhi" },
  { text: "Perfection is achieved when there is nothing left to take away.", who: "Antoine de Saint-Exup\xE9ry" },
  { text: "The best time to plant a tree was twenty years ago. The second best time is now.", who: "Proverb" }
]);
function lineFor(rotation, now, pick, startedAt) {
  const count = LINES.length;
  if (rotation === "manual") {
    const asked = Number.isFinite(pick) ? Math.trunc(pick) : 0;
    return LINES[(asked % count + count) % count];
  }
  const key = rotation === "launch" ? `start:${Math.round(startedAt)}` : `day:${dayKey(now)}`;
  return LINES[pickByKey(count, key)];
}

// orbis-ui/newtab/widgets/renderers/time/notes.ts
var greetingWidget = (ctx) => {
  const withDate = flag(ctx.settings, "date", true);
  const root = h("div", { class: "wg-greet", "data-size": ctx.size });
  const hello = h("p", { class: "wg-greet-hello" });
  const date = withDate ? h("p", { class: "wg-greet-date" }) : null;
  root.appendChild(h("div", { class: "wg-greet-words" }, hello, date));
  const sky = svg("svg", { class: "wg-greet-sky", viewBox: "0 0 200 100", "aria-hidden": "true", focusable: "false", preserveAspectRatio: "xMidYMid slice" });
  sky.appendChild(svg("rect", { class: "wg-greet-air", x: 0, y: 0, width: 200, height: 100 }));
  for (const star of STARS) sky.appendChild(svg("circle", { class: "wg-greet-star", cx: star[0], cy: star[1], r: star[2] }));
  sky.appendChild(svg("path", { class: "wg-greet-track", d: "M38 78A62 62 0 0 1 162 78", fill: "none" }));
  const glow = svg("circle", { class: "wg-greet-glow", cx: 100, cy: 16, r: 19 });
  const disc = svg("circle", { class: "wg-greet-disc", cx: 100, cy: 16, r: 10.5 });
  sky.append(glow, disc);
  sky.appendChild(svg("path", { class: "wg-greet-ground", d: "M0 78H200", fill: "none" }));
  root.appendChild(sky);
  ctx.body.appendChild(root);
  const tick = () => {
    const now = ctx.now();
    const when = new Date(now);
    const parts = clockParts(now);
    if (!parts) return;
    hello.textContent = greeting(when, text(ctx.settings, "name"));
    if (date) date.textContent = dayName(now);
    root.dataset.part = partOfDay(when);
    const turn = dayFraction(parts) * Math.PI * 2;
    const x = 100 - 62 * Math.sin(turn);
    const y = 78 + 62 * Math.cos(turn);
    for (const node of [glow, disc]) {
      node.setAttribute("cx", x.toFixed(2));
      node.setAttribute("cy", y.toFixed(2));
    }
  };
  tick();
  ctx.every(6e4, tick);
};
var STARS = Object.freeze([
  [24, 20, 1.1],
  [52, 38, 0.8],
  [78, 14, 1.3],
  [118, 28, 0.9],
  [146, 46, 1.1],
  [172, 18, 1.2],
  [96, 52, 0.7],
  [12, 54, 0.9]
]);
var quote = (ctx) => {
  const rotation = text(ctx.settings, "rotation", "daily");
  const pick = number(ctx.settings, "pick", 0);
  const line = lineFor(rotation, ctx.now(), pick, typeof performance === "object" ? performance.timeOrigin : 0);
  const words = h("p", { class: "wg-quote-words", text: line.text });
  const who = h("figcaption", { class: "wg-quote-who", text: line.who });
  const root = h("figure", { class: "wg-quote", "data-size": ctx.size }, mark(), h("blockquote", { class: "wg-quote-line" }, words), who);
  if (rotation === "manual") {
    root.appendChild(
      pressable(
        ctx.preview,
        "Another line",
        () => {
          const next = Math.trunc(pick) + 1;
          ctx.save({ pick: next });
          const shown = lineFor(rotation, ctx.now(), next, 0);
          words.textContent = shown.text;
          who.textContent = shown.who;
        },
        "Another",
        "wg-quote-more"
      )
    );
  }
  ctx.body.appendChild(root);
};
var mark = () => svg(
  "svg",
  { class: "wg-quote-mark", viewBox: "0 0 40 30", "aria-hidden": "true", focusable: "false" },
  svg("path", { d: "M0 30V17.5C0 7.8 5.4 1.4 15.4 0l1.8 5.2C11.3 6.6 8 10 7.8 14.6h6.6V30Z" }),
  svg("path", { d: "M22.8 30V17.5C22.8 7.8 28.2 1.4 38.2 0L40 5.2c-5.9 1.4-9.2 4.8-9.4 9.4h6.6V30Z" })
);
var NOTE_MOST = 4e3;
var notepad = (ctx) => {
  const kept = typing(ctx.body, text(ctx.settings, "text"));
  const root = h("div", { class: "wg-notepad", "data-size": ctx.size, "data-paper": text(ctx.settings, "colour", "amber") });
  const paper = quiet(
    ctx.preview,
    h("textarea", {
      class: "wg-notepad-text",
      "aria-label": "Your note",
      placeholder: "Write something",
      maxlength: String(NOTE_MOST),
      spellcheck: "true",
      rows: "2"
    })
  );
  paper.value = kept.text;
  const left = h("p", { class: "wg-notepad-left", "aria-hidden": "true" });
  root.append(paper, left);
  ctx.body.appendChild(root);
  const count = () => {
    left.textContent = roomLeft(paper.value.length, NOTE_MOST);
  };
  if (!ctx.preview) {
    paper.addEventListener("input", () => {
      kept.text = paper.value;
      kept.caret = paper.selectionStart ?? paper.value.length;
      ctx.save({ text: paper.value });
      count();
    });
    paper.addEventListener("keyup", () => {
      kept.caret = paper.selectionStart ?? paper.value.length;
    });
    paper.addEventListener("click", () => {
      kept.caret = paper.selectionStart ?? paper.value.length;
    });
    if (kept.text !== kept.base) ctx.save({ text: kept.text });
  }
  resume(paper, kept);
  count();
};

// orbis-ui/newtab/widgets/renderers/time.ts
var TIME_RENDERERS = Object.freeze({
  clock,
  worldclock,
  countdown,
  timer,
  calculator,
  greeting: greetingWidget,
  quote,
  notepad
});

// orbis-ui/newtab/widgets/renderers/personal/sums.ts
var DAY2 = 864e5;
function rowsFor(size, asked, caps) {
  const room = caps[size] ?? caps.medium;
  const wanted = Number.isFinite(asked) ? Math.floor(asked) : room;
  return Math.max(1, Math.min(room, wanted));
}
var asCount = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
function shareOf(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.min(1, Math.max(0, part / whole));
}
var round2 = (n) => Math.round(n * 100) / 100;
function arcDash(fraction, circumference) {
  const on = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * Math.max(0, circumference);
  return `${round2(on)} ${round2(Math.max(0, circumference - on))}`;
}
function onDial(turn, radius, centre) {
  const angle = (Math.max(0, Math.min(1, Number.isFinite(turn) ? turn : 0)) - 0.25) * Math.PI * 2;
  return { x: round2(centre + Math.cos(angle) * radius), y: round2(centre + Math.sin(angle) * radius) };
}
var countOf = (n, one, many) => `${Math.max(0, Math.floor(n))} ${Math.floor(n) === 1 ? one : many}`;
function moreWords(shown, total) {
  const left = Math.max(0, Math.floor(total) - Math.floor(shown));
  return left === 0 ? "" : `and ${left} more`;
}
function restWords(shown, read, asked) {
  if (read - shown <= 0) return "";
  return read < asked ? moreWords(shown, read) : "and more";
}
var boardWords = (elements) => countOf(elements, "thing", "things");
function snippet(text2, most) {
  const tidy = String(text2 ?? "").replace(/\s+/g, " ").trim();
  if (most <= 0) return "";
  return tidy.length <= most ? tidy : `${tidy.slice(0, most - 1).trimEnd()}\u2026`;
}
function monogram(text2) {
  const found = String(text2 ?? "").trim().replace(/^www\./, "").match(/[\p{L}\p{N}]/u);
  return found ? found[0].toUpperCase() : "\xB7";
}
function startOfDay(at2) {
  const day = new Date(at2);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}
var dayTurn = (at2) => shareOf(at2 - startOfDay(at2), DAY2);
function dayWord(at2, now) {
  const days = Math.round((startOfDay(at2) - startOfDay(now)) / DAY2);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : "";
}
function readTasks(value) {
  const items = value.items ?? [];
  const total = Math.max(items.length, Math.floor(value.total ?? 0));
  return {
    total,
    shown: items.length,
    overdue: items.filter((one) => one.overdue).length,
    important: items.filter((one) => one.important).length,
    whole: items.length >= total
  };
}
var viewWords = (view) => view === "overdue" ? "overdue" : view === "flagged" ? "important" : view === "all" ? "in all" : "due today";
function dayMarks(items, now) {
  const today = startOfDay(now);
  const marks = [];
  for (const one of items) {
    if (one.dueAt === null || !one.hasTime || !Number.isFinite(one.dueAt)) continue;
    if (startOfDay(one.dueAt) !== today) continue;
    marks.push({ id: one.id, turn: dayTurn(one.dueAt), overdue: one.overdue === true });
  }
  return marks;
}
var stillComing = (one) => one.state === "downloading" || one.state === "paused";
var downloadShare = (one) => Number.isFinite(one.total) && one.total > 0 ? shareOf(one.received, one.total) : null;
function leadDownload(items) {
  let lead2 = null;
  for (const one of items) {
    if (!stillComing(one)) continue;
    const better = lead2 === null || one.state === "downloading" && lead2.state === "paused" || one.state === lead2.state && one.at > lead2.at;
    if (better) lead2 = one;
  }
  return lead2;
}
var clipWord = (kind) => kind === "link" ? "Link" : kind === "image" ? "Picture" : kind === "text" ? "Text" : "Copied";
var currentFirst = (items) => [...items].sort((a, b) => Number(b.current) - Number(a.current));
function stackOf(items, most, total) {
  const shown = items.slice(0, Math.max(0, Math.floor(most)));
  return { shown, hidden: Math.max(0, Math.floor(total) - shown.length) };
}

// orbis-ui/newtab/widgets/renderers/personal/parts.ts
function press(ctx, label, act, content, cls = "wg-btn") {
  const node = h("button", {
    class: cls,
    type: "button",
    "aria-label": label,
    ...ctx.preview ? { tabindex: "-1", "aria-disabled": "true" } : {}
  });
  for (const one of content) if (one !== false && one !== null) node.append(one);
  node.addEventListener("click", () => {
    if (!ctx.preview) act();
  });
  return node;
}
var openPanel = (ctx, view, label, cls = "wg-btn") => press(ctx, label, () => void ctx.run({ do: "panel.open", view }), [label], cls);
var saidAloud = () => h("p", { class: "wg-p-said", role: "status", "aria-live": "polite" });
var spoken = (text2) => h("span", { class: "wg-p-said", text: text2 });
function flash(ctx, where, said3, text2, ms = 1800) {
  said3.textContent = text2;
  where.classList.add("wg-p-flash");
  where.setAttribute("data-said", text2);
  const end = setTimeout(() => {
    said3.textContent = "";
    where.classList.remove("wg-p-flash");
    where.removeAttribute("data-said");
  }, ms);
  ctx.onCleanup(() => clearTimeout(end));
}
function siteMark(url, name, px = 20) {
  const box = h("span", { class: "wg-p-site", style: { "--wg-site": `${px}px` } }, h("span", { class: "wg-p-site-letter", text: monogram(name || hostOf(url)) }));
  const picture = h("img", { class: "wg-p-site-img", src: favicon(url, px * 2), alt: "", width: String(px), height: String(px), loading: "lazy", decoding: "async" });
  picture.addEventListener("load", () => box.setAttribute("data-icon", "yes"));
  picture.addEventListener("error", () => picture.remove());
  box.append(picture);
  return box;
}
function siteTile(ctx, url, title, sub) {
  const name = snippet(title, 60) || hostOf(url);
  const lines = [siteMark(url, name, 26), h("span", { class: "wg-p-tile-name", text: name })];
  if (sub !== "") lines.push(h("span", { class: "wg-p-tile-sub", text: sub }));
  return press(ctx, `${name}, ${hostOf(url)}`, () => ctx.open(url), lines, "wg-p-tile");
}
function progressRing(share, px, thickness, tone, inside) {
  const half = px / 2;
  const radius = half - thickness / 2;
  const round4 = 2 * Math.PI * radius;
  const drawing = svg(
    "svg",
    { class: "wg-p-ring-art", viewBox: `0 0 ${px} ${px}`, width: px, height: px, "aria-hidden": "true", focusable: "false" },
    svg("circle", { class: "wg-p-ring-track", cx: half, cy: half, r: radius, "stroke-width": thickness })
  );
  if (share !== null) {
    drawing.append(
      svg("circle", {
        class: "wg-p-ring-arc",
        cx: half,
        cy: half,
        r: radius,
        "stroke-width": thickness,
        "stroke-linecap": "round",
        "stroke-dasharray": arcDash(share, round4),
        transform: `rotate(-90 ${half} ${half})`
      })
    );
  }
  const box = h("span", { class: "wg-p-ring", "data-wg-tone": tone, style: { "--wg-ring": `${px}px` } }, drawing);
  if (inside) box.append(h("span", { class: "wg-p-ring-mid" }, inside));
  return box;
}
function progressBar(share, tone) {
  const bar = h("span", { class: "wg-p-bar", "data-wg-tone": tone });
  if (share !== null) bar.append(h("span", { class: "wg-p-bar-fill", style: { width: `${Math.round(shareOf(share, 1) * 1e3) / 10}%` } }));
  return bar;
}
function glyph2(name, px = 16) {
  const parts = {
    text: () => [svg("path", { d: "M4.5 6h11M4.5 10h11M4.5 14h6.5", "stroke-width": 1.6, "stroke-linecap": "round" })],
    link: () => [
      svg("path", { d: "M8.6 11.4a3.3 3.3 0 0 0 4.7 0l2.1-2.1a3.3 3.3 0 0 0-4.7-4.7l-1 1", "stroke-width": 1.6, "stroke-linecap": "round" }),
      svg("path", { d: "M11.4 8.6a3.3 3.3 0 0 0-4.7 0l-2.1 2.1a3.3 3.3 0 0 0 4.7 4.7l1-1", "stroke-width": 1.6, "stroke-linecap": "round" })
    ],
    image: () => [
      svg("rect", { x: 3, y: 4.5, width: 14, height: 11, rx: 2, "stroke-width": 1.5 }),
      svg("circle", { cx: 7.4, cy: 8.6, r: 1.3, fill: "currentColor", stroke: "none" }),
      svg("path", { d: "M3.8 13.8l3.6-3.4 2.6 2.4 2.4-2.1 3.4 3.1", "stroke-width": 1.5, "stroke-linejoin": "round" })
    ],
    other: () => [svg("circle", { cx: 10, cy: 10, r: 5.6, "stroke-width": 1.6 }), svg("circle", { cx: 10, cy: 10, r: 1.4, fill: "currentColor", stroke: "none" })],
    board: () => [
      svg("rect", { x: 2.5, y: 3.5, width: 15, height: 11, rx: 1.8, "stroke-width": 1.5 }),
      svg("path", { d: "M10 14.5v2.2M7 17.2h6", "stroke-width": 1.5, "stroke-linecap": "round" })
    ],
    stack: () => [
      svg("rect", { x: 2.5, y: 6.5, width: 15, height: 10, rx: 2, "stroke-width": 1.5 }),
      svg("path", { d: "M5 4.4h10M6.6 2.4h6.8", "stroke-width": 1.5, "stroke-linecap": "round" })
    ],
    tick: () => [svg("path", { d: "M5 10.4l3.5 3.5L15.2 7", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })],
    pause: () => [svg("path", { d: "M8 6.4v7.2M12 6.4v7.2", "stroke-width": 2, "stroke-linecap": "round" })],
    alert: () => [svg("path", { d: "M10 5.4v5.4", "stroke-width": 2, "stroke-linecap": "round" }), svg("circle", { cx: 10, cy: 14.3, r: 1.1, fill: "currentColor", stroke: "none" })],
    down: () => [svg("path", { d: "M10 4.6v8.6M6.3 9.6L10 13.3l3.7-3.7", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" })],
    plus: () => [svg("path", { d: "M10 5.2v9.6M5.2 10h9.6", "stroke-width": 1.8, "stroke-linecap": "round" })],
    clock: () => [svg("circle", { cx: 10, cy: 10, r: 6.4, "stroke-width": 1.5 }), svg("path", { d: "M10 6.3V10l2.6 1.6", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" })],
    star: () => [svg("path", { d: "M10 3.4l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8.4l4.7-.7z", "stroke-width": 1.4, "stroke-linejoin": "round" })],
    paper: () => [
      svg("path", { d: "M4.5 3h7.2l4 4v10a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4a1 1 0 0 1 .8-1z", "stroke-width": 1.5, "stroke-linejoin": "round" }),
      svg("path", { d: "M11.6 3v4.2h4", "stroke-width": 1.5, "stroke-linejoin": "round" })
    ]
  };
  return svg("svg", { class: "wg-p-glyph", viewBox: "0 0 20 20", width: px, height: px, stroke: "currentColor", fill: "none", "aria-hidden": "true", focusable: "false" }, ...parts[name]());
}

// orbis-ui/newtab/widgets/renderers/personal/tasks.ts
var VIEWS = ["today", "overdue", "flagged", "all"];
var viewOf = (value) => VIEWS.includes(String(value)) ? String(value) : "today";
var ROWS = { small: 1, medium: 3, tall: 5, large: 6, wide: 3 };
var DIAL = { small: 112, medium: 88, tall: 104, large: 100, wide: 88 };
var nothingWords = (view) => view === "overdue" ? "Nothing overdue" : view === "flagged" ? "Nothing marked important" : view === "all" ? "No tasks" : "Nothing due";
function dueWords(one, now) {
  if (one.dueAt === null || !Number.isFinite(one.dueAt)) return "";
  if (one.overdue) return "Overdue";
  if (one.hasTime) return until(one.dueAt, now);
  return dayWord(one.dueAt, now) || (one.dueAt < now ? ago(one.dueAt, now) : until(one.dueAt, now));
}
function dial(ctx, reading, marks, px, word) {
  const half = px / 2;
  const thickness = Math.max(5, Math.round(px * 0.075));
  const radius = half - thickness / 2 - 2;
  const round4 = 2 * Math.PI * radius;
  const turn = dayTurn(ctx.now());
  const art = svg("svg", { class: "wg-tasks-art", viewBox: `0 0 ${px} ${px}`, width: px, height: px, "aria-hidden": "true", focusable: "false" });
  art.append(svg("circle", { class: "wg-tasks-track", cx: half, cy: half, r: radius, "stroke-width": thickness }));
  art.append(
    svg("circle", {
      class: "wg-tasks-day",
      cx: half,
      cy: half,
      r: radius,
      "stroke-width": thickness,
      "stroke-linecap": "round",
      "stroke-dasharray": arcDash(turn, round4),
      transform: `rotate(-90 ${half} ${half})`
    })
  );
  for (const mark3 of marks) {
    const inner = onDial(mark3.turn, radius - thickness / 2 - 0.5, half);
    const outer = onDial(mark3.turn, radius + thickness / 2 + 1.5, half);
    art.append(svg("line", { class: "wg-tasks-mark", ...mark3.overdue ? { "data-late": "yes" } : {}, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, "stroke-width": 2.6, "stroke-linecap": "round" }));
  }
  const at2 = onDial(turn, radius, half);
  art.append(svg("circle", { class: "wg-tasks-now", cx: at2.x, cy: at2.y, r: Math.max(2.2, thickness * 0.38) }));
  const middle = h(
    "span",
    { class: "wg-tasks-mid" },
    h("span", { class: "wg-big wg-tasks-count", text: String(reading.total) }),
    h("span", { class: "wg-label wg-tasks-word", text: word })
  );
  const late = reading.whole && reading.overdue > 0 ? `, ${reading.overdue} of them overdue` : "";
  const face = press(ctx, `Open Tasks. ${countOf(reading.total, "task", "tasks")} ${word}${late}.`, () => void ctx.run({ do: "panel.open", view: "tasks" }), [art, middle], "wg-tasks-dial");
  face.style.setProperty("--wg-dial", `${px}px`);
  face.title = "Open Tasks";
  return face;
}
function taskRow(ctx, one, now, said3) {
  const title = snippet(one.title, 90) || "Untitled task";
  const row2 = h("div", { class: "wg-tasks-row", ...one.overdue ? { "data-late": "yes" } : {} });
  const tick = press(
    ctx,
    `Tick off ${title}`,
    async () => {
      const result = await ctx.run({ do: "task.complete", id: one.id });
      if (!result.ok) {
        flash(ctx, row2, said3, result.message, 3200);
        return;
      }
      row2.setAttribute("data-done", "yes");
      tick.disabled = true;
      flash(ctx, row2, said3, `${title} is ticked off.`);
    },
    [glyph2("tick", 13)],
    "wg-tasks-tick"
  );
  const name = h("span", { class: "wg-row-main wg-tasks-name", text: title });
  const when = dueWords(one, now);
  row2.append(tick);
  if (one.important) row2.append(glyph2("star", 13), spoken("Important. "));
  row2.append(name);
  if (when !== "") row2.append(h("span", { class: "wg-row-side wg-tasks-when", text: when }));
  return row2;
}
function drawTasks(ctx) {
  const view = viewOf(ctx.settings.view);
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 5), ROWS);
  ctx.feed(
    { source: "tasks", view, limit },
    (feed) => {
      const now = ctx.now();
      const reading = readTasks(feed.value);
      const word = viewWords(view);
      const lists = ctx.size !== "small";
      const marks = lists ? dayMarks(feed.value.items, now) : [];
      const said3 = saidAloud();
      const face = dial(ctx, reading, marks, DIAL[ctx.size], word);
      const root = h("div", { class: "wg-tasks", "data-size": ctx.size }, said3);
      if (ctx.size === "large") {
        const chips = h("div", { class: "wg-tasks-chips" });
        if (reading.whole && reading.overdue > 0) chips.append(h("span", { class: "wg-chip", "data-wg-tone": "red" }, glyph2("alert", 12), h("span", { text: countOf(reading.overdue, "overdue", "overdue") })));
        if (reading.whole && reading.important > 0) chips.append(h("span", { class: "wg-chip", "data-wg-tone": "amber" }, glyph2("star", 12), h("span", { text: countOf(reading.important, "important", "important") })));
        root.append(h("div", { class: "wg-tasks-head" }, face, chips));
      } else {
        root.append(face);
      }
      if (lists) {
        root.append(h("div", { class: "wg-list wg-tasks-list" }, ...feed.value.items.slice(0, limit).map((one) => taskRow(ctx, one, now, said3))));
      }
      ctx.body.append(root);
      const more = moreWords(lists ? Math.min(limit, feed.value.items.length) : 0, reading.total);
      if (lists && more !== "") ctx.show.note(more);
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: nothingWords(view),
      emptyAction: { label: "Open Tasks", press: () => void ctx.run({ do: "panel.open", view: "tasks" }) },
      everyMs: 6e4
    }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/reminders.ts
var ROWS2 = { small: 2, medium: 3, tall: 5, large: 5, wide: 3 };
var pip = (lead2) => svg(
  "svg",
  { class: "wg-reminders-pip", ...lead2 ? { "data-lead": "yes" } : {}, viewBox: "0 0 12 12", width: 12, height: 12, "aria-hidden": "true", focusable: "false" },
  svg("circle", { class: "wg-reminders-pip-ring", cx: 6, cy: 6, r: 4.4 }),
  svg("circle", { class: "wg-reminders-pip-dot", cx: 6, cy: 6, r: lead2 ? 2.6 : 1.8 })
);
var dayPart = (at2, now) => {
  const word = dayWord(at2, now);
  if (word === "Today") return "";
  return word !== "" ? word : new Intl.DateTimeFormat(void 0, { weekday: "short", day: "numeric", month: "short" }).format(at2);
};
function drawReminders(ctx) {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 5), ROWS2);
  ctx.feed(
    { source: "reminders", limit: limit + 1 },
    (feed) => {
      const now = ctx.now();
      const items = feed.value.items;
      const [next, ...rest] = items;
      const root = h("div", { class: "wg-reminders", "data-size": ctx.size, "data-still": ctx.still ? "yes" : "no" });
      const when = dayPart(next.at, now);
      const lead2 = h(
        "div",
        { class: "wg-reminders-next" },
        h("div", { class: "wg-reminders-face" }, pip(true), h("span", { class: "wg-big wg-reminders-time", text: clockTime(next.at, ctx.hour12) })),
        h("p", { class: "wg-sub wg-reminders-title", text: snippet(next.title, 90) || "Untitled reminder" }),
        h("p", { class: "wg-reminders-away" }, spoken("Starts "), h("span", { text: until(next.at, now) }), when !== "" && h("span", { class: "wg-reminders-day", text: when }))
      );
      root.append(lead2);
      const others = rest.slice(0, limit);
      if (others.length > 0) {
        const rail = h("ul", { class: "wg-list wg-reminders-rail" });
        for (const one of others) {
          const side = dayPart(one.at, now);
          rail.append(
            h(
              "li",
              { class: "wg-reminders-row" },
              h("span", { class: "wg-reminders-stem" }, pip(false)),
              h("span", { class: "wg-row-main", text: snippet(one.title, 70) || "Untitled reminder" }),
              h("span", { class: "wg-row-side wg-reminders-at", text: side === "" ? clockTime(one.at, ctx.hour12) : `${side} ${clockTime(one.at, ctx.hour12)}` })
            )
          );
        }
        root.append(rail);
      }
      ctx.body.append(root);
      const more = moreWords(1 + others.length, Math.max(feed.value.total, items.length));
      if (more !== "") ctx.show.note(more);
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: "Nothing coming up",
      emptyAction: { label: "Open Tasks", press: () => void ctx.run({ do: "panel.open", view: "tasks" }) },
      everyMs: 6e4
    }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/notes.ts
var SHEETS = { small: 1, medium: 2, tall: 3, large: 4, wide: 4 };
function drawNotes(ctx) {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 4), SHEETS);
  const said3 = saidAloud();
  const start = (root) => press(
    ctx,
    "New note",
    async () => {
      const result = await ctx.run({ do: "note.create" });
      flash(ctx, root, said3, result.ok ? result.message ?? "A new note is started." : result.message, 2600);
    },
    [glyph2("plus", 13), h("span", { text: "New note" })],
    "wg-btn primary wg-notes-new"
  );
  ctx.feed(
    { source: "notes", limit },
    (feed) => {
      const now = ctx.now();
      const root = h("div", { class: "wg-notes", "data-size": ctx.size }, said3);
      const sheets = h("div", { class: "wg-notes-sheets" });
      for (const one of feed.value.items.slice(0, limit)) {
        const excerpt = snippet(one.excerpt, 140);
        sheets.append(
          h(
            "article",
            { class: "wg-notes-paper" },
            h("h3", { class: "wg-notes-name", text: snippet(one.title, 70) || "Untitled note" }),
            excerpt !== "" && h("p", { class: "wg-notes-excerpt", text: excerpt }),
            h("p", { class: "wg-label wg-notes-when", text: ago(one.updatedAt, now) })
          )
        );
      }
      root.append(sheets, h("div", { class: "wg-row wg-notes-feet" }, start(root), openPanel(ctx, "notes", "Open Notes")));
      ctx.body.append(root);
      const more = moreWords(Math.min(limit, feed.value.items.length), Math.max(feed.value.total, feed.value.items.length));
      if (more !== "") ctx.show.note(more);
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: "No notes yet",
      emptyAction: { label: "New note", press: () => void ctx.run({ do: "note.create" }) }
    }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/sites.ts
var BOOKMARKS = { small: 4, medium: 4, tall: 6, large: 8, wide: 6 };
var RECENT = { small: 3, medium: 3, tall: 4, large: 6, wide: 5 };
function drawBookmarks(ctx) {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 6), BOOKMARKS);
  ctx.feed(
    { source: "bookmarks", limit },
    (feed) => {
      const sites = feed.value.items.filter((one) => isWeb(one.url)).slice(0, limit);
      ctx.body.append(h("div", { class: "wg-p-grid wg-bookmarks", "data-size": ctx.size }, ...sites.map((one) => siteTile(ctx, one.url, one.title, ""))));
      const more = moreWords(sites.length, Math.max(feed.value.total, feed.value.items.length));
      if (more !== "") ctx.show.note(more);
    },
    {
      empty: (value) => value.items.filter((one) => isWeb(one.url)).length === 0,
      emptyText: "No bookmarks yet"
    }
  );
}
function drawRecent(ctx) {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 6), RECENT);
  ctx.feed(
    { source: "recent", limit },
    (feed) => {
      const now = ctx.now();
      const sites = feed.value.items.filter((one) => isWeb(one.url)).slice(0, limit);
      ctx.body.append(h("div", { class: "wg-p-grid wg-recent", "data-size": ctx.size }, ...sites.map((one) => siteTile(ctx, one.url, one.title || one.host, ago(one.at, now)))));
    },
    {
      empty: (value) => value.items.filter((one) => isWeb(one.url)).length === 0,
      emptyText: "No sites visited yet",
      everyMs: 6e4
    }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/downloads.ts
var ROWS3 = { small: 2, medium: 3, tall: 5, large: 5, wide: 3 };
var MARKS = {
  done: { glyph: "tick", tone: "green" },
  downloading: { glyph: "down", tone: "accent" },
  paused: { glyph: "pause", tone: "amber" },
  failed: { glyph: "alert", tone: "red" }
};
var sizeWords = (one) => bytes(one.total > 0 ? one.total : one.received);
function stateWords(one, now) {
  const share = downloadShare(one);
  const percent = share === null ? "" : `${Math.round(share * 100)}%`;
  if (one.state === "done") return [`Done`, sizeWords(one), ago(one.at, now)].filter((part) => part !== "").join(" \xB7 ");
  if (one.state === "failed") return "Failed";
  if (one.state === "paused") return share === null ? `Paused \xB7 ${bytes(one.received)} so far` : `Paused \xB7 ${percent}`;
  return share === null ? `${bytes(one.received)} so far` : `${percent} \xB7 ${bytes(one.received)} of ${bytes(one.total)}`;
}
function row(ctx, one, now, said3) {
  const name = snippet(one.name, 80) || "A file";
  const mark3 = MARKS[one.state] ?? MARKS.downloading;
  const share = one.state === "done" ? 1 : downloadShare(one);
  const words = stateWords(one, now);
  const inside = h("span", { class: "wg-downloads-inside" }, glyph2(mark3.glyph, 13));
  const body = [
    progressRing(share, 34, 3, mark3.tone, inside),
    h("span", { class: "wg-downloads-text" }, h("span", { class: "wg-row-main wg-downloads-name", text: name }), h("span", { class: "wg-downloads-state", text: words }))
  ];
  if (one.state !== "done") return h("div", { class: "wg-downloads-row", "data-state": one.state }, ...body);
  const button2 = press(
    ctx,
    `Show ${name}. ${words}.`,
    async () => {
      const result = await ctx.run({ do: "download.show", id: one.id });
      if (!result.ok) flash(ctx, button2, said3, result.message, 3200);
    },
    body,
    "wg-downloads-row"
  );
  button2.setAttribute("data-state", one.state);
  return button2;
}
function lead(ctx, one, now) {
  const share = downloadShare(one);
  const percent = share === null ? bytes(one.received) : `${Math.round(share * 100)}%`;
  return h(
    "div",
    { class: "wg-downloads-lead", "data-state": one.state, "data-still": ctx.still ? "yes" : "no" },
    h("div", { class: "wg-row wg-downloads-leadtop" }, h("span", { class: "wg-big wg-downloads-pc", text: percent }), glyph2(MARKS[one.state].glyph, 15)),
    h("p", { class: "wg-downloads-leadname", text: snippet(one.name, 70) || "A file" }),
    progressBar(share, MARKS[one.state].tone),
    h("p", { class: "wg-label wg-downloads-leadstate", text: stateWords(one, now) })
  );
}
function drawDownloads(ctx) {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 4), ROWS3);
  const asked = limit + 1;
  ctx.feed(
    { source: "downloads", limit: asked },
    (feed) => {
      const now = ctx.now();
      const said3 = saidAloud();
      const items = feed.value.items;
      const root = h("div", { class: "wg-downloads", "data-size": ctx.size }, said3);
      const big = ctx.size === "tall" || ctx.size === "large" ? leadDownload(items) : null;
      if (big) root.append(lead(ctx, big, now));
      const rest = items.filter((one) => one !== big).slice(0, big ? limit - 1 : limit);
      if (rest.length > 0) root.append(h("div", { class: "wg-list wg-downloads-list" }, ...rest.map((one) => row(ctx, one, now, said3))));
      ctx.body.append(root);
      const shown = rest.length + (big ? 1 : 0);
      const left = restWords(shown, items.length, asked);
      const coming = items.length < asked && !big ? items.filter(stillComing).length : 0;
      const note = left !== "" ? left : coming > 0 ? coming === 1 ? "1 still coming" : `${coming} still coming` : "";
      if (note !== "") ctx.show.note(note);
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: "Nothing downloaded yet",
      everyMs: 6e4
    }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/tabs.ts
var ROWS4 = { small: 4, medium: 3, tall: 6, large: 6, wide: 4 };
var PILE = { small: 5, medium: 4, tall: 5, large: 5, wide: 5 };
function drawTabs(ctx) {
  const rows = rowsFor(ctx.size, asCount(ctx.settings.limit, 5), ROWS4);
  ctx.feed(
    { source: "tabs", limit: Math.max(rows, PILE[ctx.size]) },
    (feed) => {
      const said3 = saidAloud();
      const { count, groups, items } = feed.value;
      const lists = ctx.size !== "small";
      const pile = stackOf(items, PILE[ctx.size], count);
      const root = h("div", { class: "wg-tabs", "data-size": ctx.size }, said3);
      const face = h(
        "div",
        { class: "wg-tabs-face" },
        h("span", { class: "wg-big wg-tabs-count", text: String(count) }),
        h("span", { class: "wg-label wg-tabs-word", text: count === 1 ? "open tab" : "open tabs" })
      );
      if (groups > 0) face.append(h("span", { class: "wg-chip wg-tabs-groups", text: countOf(groups, "group", "groups") }));
      const heap = h("div", { class: "wg-tabs-pile", role: "img", "aria-label": `${countOf(count, "tab", "tabs")} open` });
      for (const one of pile.shown) heap.append(h("span", { class: "wg-tabs-card", ...one.active ? { "data-here": "yes" } : {} }, siteMark(one.url, one.title || hostOf(one.url), 22)));
      if (pile.hidden > 0) heap.append(h("span", { class: "wg-tabs-card wg-tabs-rest", text: `+${pile.hidden}` }));
      root.append(h("div", { class: "wg-tabs-head" }, face, heap));
      if (lists) {
        const list = h("div", { class: "wg-list wg-tabs-list" });
        for (const one of items.slice(0, rows)) {
          const name = snippet(one.title, 80) || hostOf(one.url);
          const here = one.active === true;
          const button2 = press(
            ctx,
            here ? `${name}. The tab you are on.` : `Go to ${name}`,
            async () => {
              const result = await ctx.run({ do: "tab.activate", id: one.id });
              if (!result.ok) flash(ctx, button2, said3, result.message, 3200);
            },
            [
              siteMark(one.url, name, 18),
              h("span", { class: "wg-row-main", text: name }),
              here && h("span", { class: "wg-chip wg-tabs-here", text: "Here" })
            ],
            "wg-tabs-row"
          );
          if (here) button2.setAttribute("data-here", "yes");
          list.append(button2);
        }
        root.append(list);
      }
      ctx.body.append(root);
    },
    { empty: (value) => value.count === 0 && value.items.length === 0, emptyText: "No tabs open" }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/workspaces.ts
var TILES = { small: 2, medium: 3, tall: 4, large: 6, wide: 4 };
var stack = () => svg(
  "svg",
  { class: "wg-workspaces-art", viewBox: "0 0 44 34", width: 44, height: 34, "aria-hidden": "true", focusable: "false" },
  svg("rect", { class: "wg-workspaces-back", x: 8.5, y: 2.5, width: 27, height: 20, rx: 4 }),
  svg("rect", { class: "wg-workspaces-mid", x: 5.5, y: 6.5, width: 33, height: 22, rx: 4.5 }),
  svg("rect", { class: "wg-workspaces-front", x: 2.5, y: 10.5, width: 39, height: 21, rx: 5 }),
  svg("path", { class: "wg-workspaces-line", d: "M8 17h14M8 22h22", "stroke-width": 1.6, "stroke-linecap": "round" })
);
function drawWorkspaces(ctx) {
  const tiles = TILES[ctx.size];
  const asked = tiles + 1;
  ctx.feed(
    { source: "workspaces", limit: asked },
    (feed) => {
      const said3 = saidAloud();
      const items = currentFirst(feed.value.items);
      const root = h("div", { class: "wg-p-grid wg-workspaces", "data-size": ctx.size }, said3);
      for (const one of items.slice(0, tiles)) {
        const name = snippet(one.name, 50) || "Untitled workspace";
        const held = countOf(one.tabs, "page", "pages");
        const tile = press(
          ctx,
          one.current ? `${name}. The workspace you are in. ${held}.` : `Open ${name}. ${held}.`,
          async () => {
            const result = await ctx.run({ do: "workspace.open", id: one.id });
            if (!result.ok) flash(ctx, tile, said3, result.message, 3200);
          },
          [
            stack(),
            h("span", { class: "wg-workspaces-name", text: name }),
            h("span", { class: "wg-label wg-workspaces-held", text: held }),
            one.current && h("span", { class: "wg-chip wg-workspaces-now", text: "Now" })
          ],
          "wg-p-tile wg-workspaces-tile"
        );
        if (one.current) tile.setAttribute("data-here", "yes");
        root.append(tile);
      }
      ctx.body.append(root);
      const rest = restWords(Math.min(tiles, items.length), items.length, asked);
      if (rest !== "") ctx.show.note(rest);
    },
    // There is no "Open Workspaces" to offer here: the side panel has no workspaces screen, and a button that
    // quietly showed something else would be a button that lies about what it does.
    { empty: (value) => value.items.length === 0, emptyText: "No workspaces saved yet" }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/clipboard.ts
var SCRAPS = { small: 2, medium: 2, tall: 4, large: 4, wide: 3 };
function drawClipboard(ctx) {
  const limit = rowsFor(ctx.size, asCount(ctx.settings.limit, 4), SCRAPS);
  ctx.feed(
    { source: "clipboard", limit },
    (feed) => {
      const now = ctx.now();
      const said3 = saidAloud();
      const root = h("div", { class: "wg-clipboard", "data-size": ctx.size }, said3);
      for (const one of feed.value.items.slice(0, limit)) {
        const kind = clipWord(one.kind);
        const text2 = snippet(one.preview, 160);
        const scrap = press(
          ctx,
          `Copy again: ${kind}. ${text2}`,
          async () => {
            const result = await ctx.run({ do: "clip.copy", id: one.id });
            flash(ctx, scrap, said3, result.ok ? "Copied" : result.message, result.ok ? 1600 : 3200);
          },
          [
            h("span", { class: "wg-clipboard-kind" }, glyph2(one.kind, 13), h("span", { class: "wg-label", text: kind })),
            h("span", { class: "wg-clipboard-text", text: text2 }),
            h("span", { class: "wg-clipboard-when wg-label", text: ago(one.at, now) }),
            spoken("Press to copy it again.")
          ],
          "wg-clipboard-scrap"
        );
        scrap.setAttribute("data-kind", one.kind);
        root.append(scrap);
      }
      ctx.body.append(root);
      const more = moreWords(Math.min(limit, feed.value.items.length), Math.max(feed.value.total, feed.value.items.length));
      if (more !== "") ctx.show.note(more);
    },
    {
      empty: (value) => value.items.length === 0,
      emptyText: "Nothing copied yet",
      everyMs: 6e4
    }
  );
}

// orbis-ui/newtab/widgets/renderers/personal/whiteboard.ts
var TILES2 = { small: 2, medium: 3, tall: 4, large: 6, wide: 4 };
var frame = () => svg(
  "svg",
  { class: "wg-whiteboard-art", viewBox: "0 0 48 36", width: 48, height: 36, "aria-hidden": "true", focusable: "false" },
  svg("rect", { class: "wg-whiteboard-face", x: 2.5, y: 2.5, width: 43, height: 26, rx: 3.5 }),
  svg("path", { class: "wg-whiteboard-rule", d: "M9 10h30M9 16h30M9 22h18", "stroke-width": 1.2, "stroke-linecap": "round" }),
  svg("path", { class: "wg-whiteboard-stand", d: "M24 28.5v5M16 33.5h16", "stroke-width": 1.8, "stroke-linecap": "round" })
);
function drawWhiteboard(ctx) {
  const tiles = rowsFor(ctx.size, asCount(ctx.settings.limit, 3), TILES2);
  const asked = tiles + 1;
  ctx.feed(
    { source: "whiteboard", limit: asked },
    (feed) => {
      const now = ctx.now();
      const items = feed.value.items;
      const root = h("div", { class: "wg-p-grid wg-whiteboard", "data-size": ctx.size });
      for (const one of items.slice(0, tiles)) {
        const name = snippet(one.name, 50) || "Untitled board";
        root.append(
          h(
            "article",
            { class: "wg-whiteboard-tile" },
            frame(),
            h("h3", { class: "wg-whiteboard-name", text: name }),
            h("p", { class: "wg-label wg-whiteboard-held", text: `${boardWords(one.elements)} \xB7 ${ago(one.updatedAt, now)}` })
          )
        );
      }
      ctx.body.append(root);
      const rest = restWords(Math.min(tiles, items.length), items.length, asked);
      if (rest !== "") ctx.show.note(rest);
    },
    { empty: (value) => value.items.length === 0, emptyText: "No boards yet" }
  );
}

// orbis-ui/newtab/widgets/renderers/personal.ts
var PERSONAL_RENDERERS = Object.freeze({
  tasks: drawTasks,
  reminders: drawReminders,
  notes: drawNotes,
  bookmarks: drawBookmarks,
  downloads: drawDownloads,
  tabs: drawTabs,
  workspaces: drawWorkspaces,
  clipboard: drawClipboard,
  whiteboard: drawWhiteboard,
  recent: drawRecent
});

// orbis-ui/newtab/widgets/renderers/live/curve.ts
var round = (n) => Math.round(n * 100) / 100;
function curvePoints(values, box) {
  if (values.length < 2 || !values.every((one) => Number.isFinite(one))) return [];
  const pad = Math.max(0, box.pad);
  const padX = Math.max(0, box.padX ?? pad);
  const left = padX;
  const right = Math.max(left, box.width - padX);
  const top = pad;
  const bottom = Math.max(top, box.height - pad);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span2 = high - low;
  const middle = (top + bottom) / 2;
  return values.map((value, at2) => ({
    x: round(left + (right - left) * at2 / (values.length - 1)),
    y: round(span2 === 0 ? middle : bottom - (value - low) / span2 * (bottom - top)),
    value
  }));
}
function linePath(points) {
  if (points.length === 0) return "";
  return points.map((one, at2) => `${at2 === 0 ? "M" : "L"}${one.x} ${one.y}`).join(" ");
}
function smoothPath(points, box) {
  if (points.length === 0) return "";
  if (points.length < 3) return linePath(points);
  const hold = (y) => round(Math.min(box.height, Math.max(0, y)));
  const parts = [`M${points[0].x} ${points[0].y}`];
  for (let at2 = 0; at2 < points.length - 1; at2 += 1) {
    const before = points[at2 - 1] ?? points[at2];
    const from = points[at2];
    const to = points[at2 + 1];
    const after = points[at2 + 2] ?? to;
    const c1x = round(from.x + (to.x - before.x) / 6);
    const c1y = hold(from.y + (to.y - before.y) / 6);
    const c2x = round(to.x - (after.x - from.x) / 6);
    const c2y = hold(to.y - (after.y - from.y) / 6);
    parts.push(`C${c1x} ${c1y} ${c2x} ${c2y} ${to.x} ${to.y}`);
  }
  return parts.join(" ");
}
function areaPath(line, points, floor) {
  if (line === "" || points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L${last.x} ${round(floor)} L${first.x} ${round(floor)} Z`;
}
function highLow(points) {
  if (points.length === 0) return null;
  let high = points[0];
  let low = points[0];
  for (const one of points) {
    if (one.value > high.value) high = one;
    if (one.value < low.value) low = one;
  }
  return { high, low };
}

// orbis-ui/newtab/widgets/renderers/live/sky.ts
var LOOKS = Object.freeze({
  clear: { sky: "clear", parts: ["sun"], mini: "sun", said: "A clear sky, with the sun out" },
  partly: { sky: "partly", parts: ["sun", "cloud-small"], mini: "partly", said: "The sun behind a cloud" },
  cloudy: { sky: "cloudy", parts: ["cloud-small", "cloud-big"], mini: "cloud", said: "A sky covered in cloud" },
  rain: { sky: "rain", parts: ["cloud-big", "drops-many"], mini: "drop", said: "Rain falling from a cloud" },
  showers: { sky: "rain", parts: ["sun", "cloud-small", "drops-few"], mini: "drop", said: "Showers, with the sun between them" },
  snow: { sky: "snow", parts: ["cloud-big", "flakes"], mini: "flake", said: "Snow falling from a cloud" },
  sleet: { sky: "snow", parts: ["cloud-big", "mixed"], mini: "flake", said: "Sleet: rain and snow falling together" },
  fog: { sky: "fog", parts: ["cloud-small", "fog"], mini: "haze", said: "Fog lying in bands" },
  thunder: { sky: "thunder", parts: ["cloud-big", "bolt", "drops-few"], mini: "bolt", said: "A thunder cloud, with lightning under it" },
  night: { sky: "night", parts: ["stars", "moon"], mini: "moon", said: "A clear night sky, with the moon out" },
  unknown: { sky: "plain", parts: ["blank"], mini: "none", said: "No picture for this weather" }
});
var lookOf = (symbol) => LOOKS[symbol] ?? LOOKS.unknown;
var hasPart = (look, part) => look.parts.includes(part);

// orbis-ui/newtab/widgets/renderers/live/parts.ts
var said2 = (text2) => h("span", { class: "wg-live-said", text: text2 });
function inert(node, preview) {
  if (preview) {
    node.setAttribute("disabled", "");
    node.setAttribute("tabindex", "-1");
  }
  return node;
}
var ARROWS = Object.freeze({
  up: "M6 10.5 L6 2.4 M2.6 5.6 L6 2.2 L9.4 5.6",
  down: "M6 2 L6 10.1 M2.6 6.9 L6 10.3 L9.4 6.9",
  flat: "M2.4 6.2 L9.6 6.2"
});

// orbis-ui/newtab/widgets/renderers/live/weatherArt.ts
var made = 0;
var nextId = (name) => `wg-${name}-${made += 1}`;
var at = (x, y, scale = 1) => `translate(${x} ${y})${scale === 1 ? "" : ` scale(${scale})`}`;
function cloud(cls) {
  return svg(
    "g",
    { class: cls },
    svg("circle", { cx: -15, cy: -3, r: 13 }),
    svg("circle", { cx: 2, cy: -10, r: 17 }),
    svg("circle", { cx: 18, cy: -1, r: 12 }),
    svg("rect", { x: -28, y: -1, width: 56, height: 14, rx: 7 })
  );
}
function sun(cx, cy, r) {
  const rays = svg("g", { class: "wg-weather-rays" });
  for (let turn = 0; turn < 8; turn += 1) {
    const angle = turn * Math.PI / 4;
    const from = r + 5;
    const to = r + 12;
    rays.appendChild(svg("line", {
      x1: (Math.cos(angle) * from).toFixed(2),
      y1: (Math.sin(angle) * from).toFixed(2),
      x2: (Math.cos(angle) * to).toFixed(2),
      y2: (Math.sin(angle) * to).toFixed(2)
    }));
  }
  return svg(
    "g",
    { class: "wg-weather-sun", transform: at(cx, cy) },
    svg("circle", { class: "wg-weather-halo", cx: 0, cy: 0, r: r + 16 }),
    rays,
    svg("circle", { class: "wg-weather-disc", cx: 0, cy: 0, r })
  );
}
function moon(cx, cy, r, cls) {
  const id = nextId("moon");
  return svg(
    "g",
    { class: cls, transform: at(cx, cy) },
    svg(
      "defs",
      null,
      svg(
        "mask",
        { id },
        svg("circle", { cx: 0, cy: 0, r, fill: "#fff" }),
        svg("circle", { cx: r * 0.62, cy: -r * 0.46, r: r * 0.88, fill: "#000" })
      )
    ),
    svg("circle", { cx: 0, cy: 0, r, mask: `url(#${id})` })
  );
}
function rainfall(drops) {
  const group = svg("g", { class: "wg-weather-rain" });
  for (const drop of drops) {
    group.appendChild(svg("line", {
      class: "wg-weather-drop",
      style: { "--wg-d": `${drop.delay}s` },
      x1: drop.x,
      y1: 0,
      x2: drop.x - 4,
      y2: 11
    }));
  }
  return group;
}
function flake(x, y, size, delay) {
  const arms = svg("g", { class: "wg-weather-flake-arms" });
  for (let turn = 0; turn < 3; turn += 1) {
    const angle = turn * Math.PI / 3;
    const dx = Math.cos(angle) * size;
    const dy = Math.sin(angle) * size;
    arms.appendChild(svg("line", { x1: (-dx).toFixed(2), y1: (-dy).toFixed(2), x2: dx.toFixed(2), y2: dy.toFixed(2) }));
  }
  return svg(
    "g",
    { transform: at(x, y) },
    svg("g", { class: "wg-weather-flake", style: { "--wg-d": `${delay}s` } }, arms)
  );
}
var snowfall = (flakes) => svg("g", { class: "wg-weather-snow" }, ...flakes.map((one) => flake(one.x, one.y, one.size, one.delay)));
function fogBands() {
  const bands = [{ x: 24, y: 74, w: 72, d: 0 }, { x: 34, y: 86, w: 54, d: 1.6 }, { x: 26, y: 98, w: 64, d: 0.8 }];
  return svg(
    "g",
    { class: "wg-weather-fog" },
    ...bands.map((band2) => svg("rect", { class: "wg-weather-band", style: { "--wg-d": `${band2.d}s` }, x: band2.x, y: band2.y, width: band2.w, height: 6, rx: 3 }))
  );
}
var bolt = (x, y) => svg("path", { class: "wg-weather-bolt", transform: at(x, y), d: "M6 0 L-6 16 L1 16 L-4 32 L12 11 L4 11 Z" });
var stars = () => {
  const places = [{ x: 22, y: 24, r: 1.6, d: 0 }, { x: 38, y: 14, r: 1.1, d: 1.1 }, { x: 15, y: 48, r: 1.4, d: 2.2 }, { x: 46, y: 36, r: 1, d: 0.6 }, { x: 30, y: 60, r: 1.2, d: 1.7 }, { x: 54, y: 20, r: 1.5, d: 2.8 }, { x: 12, y: 33, r: 1, d: 3.4 }];
  return svg(
    "g",
    { class: "wg-weather-stars" },
    ...places.map((one) => svg("circle", { class: "wg-weather-star", style: { "--wg-d": `${one.d}s` }, cx: one.x, cy: one.y, r: one.r }))
  );
};
var RAIN_MANY = [{ x: 30, delay: 0 }, { x: 41, delay: 0.55 }, { x: 52, delay: 0.2 }, { x: 63, delay: 0.75 }, { x: 74, delay: 0.35 }, { x: 36, delay: 0.95 }, { x: 58, delay: 1.15 }];
var RAIN_FEW = [{ x: 38, delay: 0 }, { x: 54, delay: 0.6 }, { x: 70, delay: 0.3 }];
var SNOW_ALL = [{ x: 34, y: 84, size: 5, delay: 0 }, { x: 52, y: 80, size: 6, delay: 1.1 }, { x: 70, y: 86, size: 4.5, delay: 0.5 }, { x: 44, y: 98, size: 4, delay: 1.7 }, { x: 62, y: 100, size: 5, delay: 0.8 }];
var SNOW_MIXED = [{ x: 36, y: 84, size: 5, delay: 0 }, { x: 66, y: 88, size: 4.5, delay: 0.9 }];
function weatherArt(symbol) {
  const look = lookOf(symbol);
  const art = svg("svg", { class: "wg-weather-art", viewBox: "0 0 120 120", role: "img", "aria-label": look.said, focusable: "false" });
  const withCloud = hasPart(look, "cloud-small") || hasPart(look, "cloud-big");
  if (hasPart(look, "stars")) art.appendChild(stars());
  if (hasPart(look, "sun")) art.appendChild(withCloud ? sun(84, 32, 14) : sun(72, 48, 22));
  if (hasPart(look, "moon")) art.appendChild(moon(80, 40, 18, "wg-weather-moon"));
  if (hasPart(look, "cloud-small")) {
    const back = svg("g", { class: "wg-weather-cloud wg-weather-cloud-back", transform: at(hasPart(look, "cloud-big") ? 74 : 58, hasPart(look, "cloud-big") ? 46 : 54, 0.74) }, cloud("wg-weather-puff"));
    art.appendChild(back);
  }
  if (hasPart(look, "cloud-big")) art.appendChild(svg("g", { class: "wg-weather-cloud", transform: at(54, 64) }, cloud("wg-weather-puff")));
  if (hasPart(look, "bolt")) art.appendChild(bolt(52, 74));
  if (hasPart(look, "drops-many")) art.appendChild(svg("g", { transform: at(0, 80) }, rainfall(RAIN_MANY)));
  if (hasPart(look, "drops-few")) art.appendChild(svg("g", { transform: at(0, hasPart(look, "cloud-big") ? 84 : 72) }, rainfall(RAIN_FEW)));
  if (hasPart(look, "flakes")) art.appendChild(snowfall(SNOW_ALL));
  if (hasPart(look, "mixed")) {
    art.appendChild(svg("g", { transform: at(0, 80) }, rainfall(RAIN_FEW)));
    art.appendChild(snowfall(SNOW_MIXED));
  }
  if (hasPart(look, "fog")) art.appendChild(fogBands());
  if (hasPart(look, "blank")) {
    art.appendChild(svg("circle", { class: "wg-weather-blank-ring", cx: 60, cy: 58, r: 27 }));
    art.appendChild(svg("circle", { class: "wg-weather-blank-dot", cx: 60, cy: 58, r: 4.5 }));
  }
  return art;
}
function weatherMini(symbol) {
  const mark3 = lookOf(symbol).mini;
  const glyph3 = svg("svg", { class: "wg-weather-mini", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" });
  if (mark3 === "sun") {
    const rays = svg("g", { class: "wg-weather-mini-rays" });
    for (let turn = 0; turn < 8; turn += 1) {
      const angle = turn * Math.PI / 4;
      rays.appendChild(svg("line", { x1: (12 + Math.cos(angle) * 7.5).toFixed(2), y1: (12 + Math.sin(angle) * 7.5).toFixed(2), x2: (12 + Math.cos(angle) * 10).toFixed(2), y2: (12 + Math.sin(angle) * 10).toFixed(2) }));
    }
    glyph3.appendChild(rays);
    glyph3.appendChild(svg("circle", { class: "wg-weather-mini-disc", cx: 12, cy: 12, r: 5.5 }));
  } else if (mark3 === "partly") {
    glyph3.appendChild(svg("circle", { class: "wg-weather-mini-disc", cx: 15, cy: 8.5, r: 4.5 }));
    glyph3.appendChild(svg("g", { class: "wg-weather-mini-cloud", transform: at(11, 15, 0.3) }, cloud("wg-weather-puff")));
  } else if (mark3 === "cloud") {
    glyph3.appendChild(svg("g", { class: "wg-weather-mini-cloud", transform: at(12, 14, 0.34) }, cloud("wg-weather-puff")));
  } else if (mark3 === "drop") {
    glyph3.appendChild(svg("path", { class: "wg-weather-mini-drop", d: "M12 3 C12 3 5 12 5 16 a7 7 0 0 0 14 0 C19 12 12 3 12 3 Z" }));
  } else if (mark3 === "flake") {
    const arms = svg("g", { class: "wg-weather-mini-flake" });
    for (let turn = 0; turn < 3; turn += 1) {
      const angle = turn * Math.PI / 3;
      arms.appendChild(svg("line", { x1: (12 - Math.cos(angle) * 8).toFixed(2), y1: (12 - Math.sin(angle) * 8).toFixed(2), x2: (12 + Math.cos(angle) * 8).toFixed(2), y2: (12 + Math.sin(angle) * 8).toFixed(2) }));
    }
    glyph3.appendChild(arms);
  } else if (mark3 === "bolt") {
    glyph3.appendChild(svg("path", { class: "wg-weather-mini-bolt", d: "M14 2 L6 13 L11 13 L9 22 L18 10 L13 10 Z" }));
  } else if (mark3 === "haze") {
    glyph3.appendChild(svg(
      "g",
      { class: "wg-weather-mini-haze" },
      svg("rect", { x: 3, y: 8, width: 18, height: 2.4, rx: 1.2 }),
      svg("rect", { x: 5, y: 13, width: 14, height: 2.4, rx: 1.2 }),
      svg("rect", { x: 3, y: 18, width: 16, height: 2.4, rx: 1.2 })
    ));
  } else if (mark3 === "moon") {
    glyph3.appendChild(moon(12, 12, 8, "wg-weather-mini-moon"));
  } else {
    glyph3.appendChild(svg("circle", { class: "wg-weather-mini-none", cx: 12, cy: 12, r: 3 }));
  }
  return glyph3;
}

// orbis-ui/newtab/widgets/renderers/live/weather.ts
var STRIPS = Object.freeze({
  small: null,
  medium: { width: 298, height: 46, count: 5, mini: false, tempY: 9, bandTop: 14, bandHeight: 18, hourY: 43 },
  large: { width: 298, height: 86, count: 7, mini: true, tempY: 32, bandTop: 38, bandHeight: 30, hourY: 82 },
  tall: { width: 128, height: 84, count: 4, mini: true, tempY: 30, bandTop: 36, bandHeight: 28, hourY: 80 },
  wide: { width: 298, height: 46, count: 6, mini: false, tempY: 9, bandTop: 14, bandHeight: 18, hourY: 43 }
});
function hourText(at2, hour12) {
  try {
    return new Intl.DateTimeFormat(void 0, { hour: "numeric", hour12 }).format(at2);
  } catch {
    return "";
  }
}
var degrees = (value) => `${Math.round(value)}\xB0`;
function hoursStrip(hours, strip, hour12) {
  const shown = hours.slice(0, strip.count).filter((one) => Number.isFinite(one.temperature));
  if (shown.length < 2) return null;
  const points = curvePoints(shown.map((one) => one.temperature), { width: strip.width, height: strip.bandHeight, pad: 4, padX: strip.width / (2 * shown.length) });
  if (points.length === 0) return null;
  const spoken2 = shown.map((one) => `${hourText(one.at, hour12)}, ${Math.round(one.temperature)} degrees`).join("; ");
  const node = svg("svg", {
    class: "wg-weather-strip",
    viewBox: `0 0 ${strip.width} ${strip.height}`,
    role: "img",
    "aria-label": `The next ${shown.length} hours: ${spoken2}`,
    focusable: "false"
  });
  const line = smoothPath(points, { width: strip.width, height: strip.bandHeight, pad: 4 });
  const band2 = svg("g", { transform: `translate(0 ${strip.bandTop})` });
  band2.appendChild(svg("path", { class: "wg-weather-curve-fill", d: areaPath(line, points, strip.bandHeight + 4) }));
  band2.appendChild(svg("path", { class: "wg-weather-curve-line", d: line }));
  for (const point of points) band2.appendChild(svg("circle", { class: "wg-weather-curve-dot", cx: point.x, cy: point.y, r: 2.6 }));
  node.appendChild(band2);
  shown.forEach((hour, index) => {
    const x = points[index].x;
    if (strip.mini) {
      const glyph3 = weatherMini(hour.symbol);
      glyph3.setAttribute("x", String(x - 8));
      glyph3.setAttribute("y", "2");
      glyph3.setAttribute("width", "16");
      glyph3.setAttribute("height", "16");
      node.appendChild(glyph3);
    }
    node.appendChild(svg("text", { class: "wg-weather-hourtemp", x, y: strip.tempY, "text-anchor": "middle" }, degrees(hour.temperature)));
    node.appendChild(svg("text", { class: "wg-weather-hourtime", x, y: strip.hourY, "text-anchor": "middle" }, hourText(hour.at, hour12)));
  });
  return node;
}
function weather(ctx) {
  const city = String(ctx.settings.city ?? "");
  const unit = ctx.settings.unit === "f" ? "f" : "c";
  const wanted = ctx.settings.hours !== false;
  const strip = STRIPS[ctx.size] ?? null;
  ctx.feed({ source: "weather", city, unit }, (feed) => {
    const value = feed.value;
    const look = lookOf(value.symbol);
    clear(ctx.body);
    const root = h("div", { class: "wg-weather", "data-sky": look.sky, "data-size": ctx.size, ...ctx.still ? { "data-still": "" } : {} });
    root.appendChild(h("span", { class: "wg-weather-sky", "aria-hidden": "true" }));
    root.appendChild(weatherArt(value.symbol));
    const head = h("div", { class: "wg-weather-head" });
    if (Number.isFinite(value.temperature)) {
      const mark3 = unit === "f" ? "F" : "C";
      head.appendChild(h(
        "p",
        { class: "wg-weather-temp" },
        said2(`${Math.round(value.temperature)} degrees ${mark3 === "F" ? "Fahrenheit" : "Celsius"}`),
        h("span", { class: "wg-weather-deg", "aria-hidden": "true", text: String(Math.round(value.temperature)) }),
        h(
          "span",
          { class: "wg-weather-unit", "aria-hidden": "true" },
          h("span", { class: "wg-weather-ring", text: "\xB0" }),
          h("span", { text: mark3 })
        )
      ));
    }
    if (value.summary) head.appendChild(h("p", { class: "wg-weather-sum", text: value.summary }));
    root.appendChild(head);
    root.appendChild(h("span", { class: "wg-weather-gap", "aria-hidden": "true" }));
    const hours = wanted && strip ? hoursStrip(value.hours ?? [], strip, ctx.hour12) : null;
    root.setAttribute("data-hours", hours ? "on" : "off");
    if (hours) root.appendChild(hours);
    const foot = h("div", { class: "wg-weather-foot" });
    if (value.place) foot.appendChild(h("p", { class: "wg-weather-where", text: value.place }));
    if (value.attribution) foot.appendChild(h("p", { class: "wg-weather-credit", text: value.attribution }));
    root.appendChild(foot);
    ctx.body.appendChild(root);
  }, { everyMs: ctx.definition.refreshMs });
}

// orbis-ui/newtab/widgets/renderers/live/news.ts
var AFTER = Object.freeze({ small: 0, medium: 2, tall: 4, large: 5, wide: 3 });
function briefly(at2, now) {
  const gap = now - at2;
  if (!Number.isFinite(gap) || gap < 0) return "";
  if (gap < 6e4) return "now";
  const minutes = Math.floor(gap / 6e4);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day" : `${days} days`;
  return new Intl.DateTimeFormat(void 0, { day: "numeric", month: "short" }).format(at2);
}
function mark2(url) {
  if (!isWeb(url)) return null;
  const image = h("img", { class: "wg-news-mark", src: favicon(url, 32), alt: "", width: 16, height: 16, loading: "lazy" });
  image.addEventListener("error", () => image.remove());
  return image;
}
function headline(ctx, url, cls, inside) {
  const openable = isWeb(url) && !ctx.preview;
  const node = h("a", {
    class: cls,
    ...openable ? { href: url, title: hostOf(url) } : {},
    onclick: (event) => {
      event.preventDefault();
      if (openable) ctx.open(url);
    }
  });
  for (const one of inside) if (one) node.append(one);
  return node;
}
function news(ctx) {
  const feeds = String(ctx.settings.feeds ?? "").split(",").map((one) => one.trim()).filter((one) => one !== "");
  const limit = Math.max(1, Math.round(Number(ctx.settings.limit) || 1));
  ctx.feed({ source: "news", feeds, limit }, (feed) => {
    const value = feed.value;
    const now = ctx.now();
    clear(ctx.body);
    const root = h("div", { class: "wg-news", "data-size": ctx.size });
    const items = value.items.slice(0, limit);
    const [lead2, ...rest] = items;
    if (lead2) {
      const when = typeof lead2.at === "number" ? ago(lead2.at, now) : "";
      root.appendChild(headline(ctx, lead2.url, "wg-news-lead", [
        h(
          "span",
          { class: "wg-news-from" },
          mark2(lead2.url),
          h("span", { class: "wg-news-source", text: lead2.source || hostOf(lead2.url) }),
          when ? h("span", { class: "wg-news-when", text: when }) : null
        ),
        h("span", { class: "wg-news-title", text: lead2.title })
      ]));
    }
    const more = rest.slice(0, AFTER[ctx.size] ?? 2);
    if (more.length > 0) {
      const list = h("ul", { class: "wg-list wg-news-rest" });
      for (const one of more) {
        const when = typeof one.at === "number" ? briefly(one.at, now) : "";
        list.appendChild(h("li", null, headline(ctx, one.url, "wg-news-row wg-row", [
          mark2(one.url),
          h("span", { class: "wg-row-main", text: one.title }),
          when ? h("span", { class: "wg-row-side", text: when }) : null
        ])));
      }
      root.appendChild(list);
    }
    if (value.failed.length > 0) {
      const names = value.failed.map((one) => hostOf(one));
      const words = names.length <= 2 ? `${names.join(" and ")} did not answer` : `${names.length} feeds did not answer`;
      root.appendChild(h("p", { class: "wg-note wg-news-failed", title: names.join(", "), text: words }));
    }
    ctx.body.appendChild(root);
  }, {
    empty: (value) => value.items.length === 0 && value.failed.length === 0,
    emptyText: "Nothing new from your feeds yet",
    everyMs: ctx.definition.refreshMs
  });
}

// orbis-ui/newtab/widgets/renderers/live/money.ts
var CODE = /^[A-Za-z]{3}$/;
function pricePlaces(price) {
  const size = Math.abs(price);
  if (!Number.isFinite(size) || size >= 1) return 2;
  if (size >= 0.01) return 4;
  return size > 0 ? 6 : 2;
}
function formatPrice(price, currency, locale) {
  if (!Number.isFinite(price)) return "";
  const places = pricePlaces(price);
  const code = String(currency ?? "").trim().toUpperCase();
  if (CODE.test(code)) {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: places, maximumFractionDigits: places }).format(price);
    } catch {
    }
  }
  const plain = new Intl.NumberFormat(locale, { minimumFractionDigits: places, maximumFractionDigits: places }).format(price);
  return code === "" ? plain : `${plain} ${code}`;
}
function changeWords(change) {
  if (!Number.isFinite(change)) return null;
  const size = Math.abs(change).toFixed(2);
  if (Number(size) === 0) return { direction: "flat", text: `${size}%`, said: "No change today" };
  const up = change > 0;
  return { direction: up ? "up" : "down", text: `${up ? "+" : "\u2212"}${size}%`, said: `${up ? "Up" : "Down"} ${size} per cent today` };
}
var tickerText = (symbol) => String(symbol ?? "").trim().toUpperCase().slice(0, 12);

// orbis-ui/newtab/widgets/renderers/live/markets.ts
var BANDS = Object.freeze({
  small: { width: 156, height: 40, marks: false },
  medium: { width: 326, height: 42, marks: true },
  tall: { width: 156, height: 72, marks: true },
  large: { width: 326, height: 92, marks: true },
  wide: { width: 326, height: 42, marks: true }
});
function band(points, size, direction) {
  const shape = BANDS[size] ?? BANDS.small;
  const box = { width: shape.width, height: shape.height, pad: 7, padX: 0 };
  const plotted = curvePoints(points, box);
  if (plotted.length === 0) return null;
  const node = svg("svg", { class: `wg-markets-band wg-${direction}`, viewBox: `0 0 ${shape.width} ${shape.height}`, "aria-hidden": "true", focusable: "false" });
  const line = smoothPath(plotted, box);
  node.appendChild(svg("path", { class: "wg-markets-wash", d: areaPath(line, plotted, shape.height) }));
  node.appendChild(svg("path", { class: "wg-markets-line", d: line }));
  const last = plotted[plotted.length - 1];
  node.appendChild(svg("circle", { class: "wg-markets-head", cx: last.x, cy: last.y, r: 3 }));
  const ends = shape.marks ? highLow(plotted) : null;
  if (ends && ends.high.value !== ends.low.value) {
    node.appendChild(svg("circle", { class: "wg-markets-peak", cx: ends.high.x, cy: ends.high.y, r: 2 }));
    node.appendChild(svg("circle", { class: "wg-markets-peak", cx: ends.low.x, cy: ends.low.y, r: 2 }));
  }
  return node;
}
function changePill(change) {
  const words = changeWords(change);
  if (!words) return null;
  const arrow = svg(
    "svg",
    { class: "wg-markets-arrow", viewBox: "0 0 12 12", "aria-hidden": "true", focusable: "false" },
    svg("path", { class: "line", d: ARROWS[words.direction] })
  );
  return h("span", { class: `wg-markets-change wg-${words.direction}` }, said2(words.said), arrow, h("span", { "aria-hidden": "true", text: words.text }));
}
function markets(ctx) {
  const symbol = String(ctx.settings.symbol ?? "").trim();
  ctx.feed({ source: "markets", symbol }, (feed) => {
    const value = feed.value;
    const words = changeWords(value.change);
    const price = formatPrice(value.price, value.currency);
    const ticker = tickerText(value.symbol);
    clear(ctx.body);
    const root = h("div", { class: "wg-markets", "data-size": ctx.size });
    root.appendChild(h(
      "div",
      { class: "wg-markets-top" },
      h("span", { class: "wg-markets-ticker", text: ticker }),
      changePill(value.change)
    ));
    const face = h("div", { class: "wg-markets-face" });
    if (price) face.appendChild(h("p", { class: "wg-big wg-markets-price", text: price }));
    if (value.name) face.appendChild(h("p", { class: "wg-sub wg-markets-name", text: value.name }));
    root.appendChild(face);
    if (Number.isFinite(value.asOf) && value.asOf > 0) {
      root.appendChild(h(
        "p",
        { class: "wg-markets-asof" },
        said2("Price read at "),
        h("span", { text: clockTime(value.asOf, ctx.hour12) })
      ));
    }
    const drawn = band(value.points ?? [], ctx.size, words?.direction ?? "flat");
    root.setAttribute("data-line", drawn ? "on" : "off");
    if (drawn) root.appendChild(h("span", { class: "wg-markets-chart" }, drawn));
    const spoken2 = [value.name || ticker, price, words?.said].filter((one) => one).join(". ");
    const open2 = h("button", {
      class: "wg-markets-open",
      type: "button",
      "aria-label": `Open Markets. ${spoken2}`,
      onclick: () => void ctx.run({ do: "panel.open", view: "markets" })
    });
    if (ctx.preview) {
      open2.setAttribute("disabled", "");
      open2.setAttribute("tabindex", "-1");
    }
    root.appendChild(open2);
    ctx.body.appendChild(root);
  }, { everyMs: ctx.definition.refreshMs });
}

// orbis-ui/newtab/widgets/renderers/live/orion.ts
var STARTERS = Object.freeze(["What can you do?", "Plan my day", "Help me write something"]);
var made2 = 0;
function orb() {
  const id = `wg-orb-${made2 += 1}`;
  const node = svg("svg", { class: "wg-orion-orb", viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false" });
  node.appendChild(svg(
    "defs",
    null,
    svg(
      "radialGradient",
      { id },
      svg("stop", { class: "wg-orion-stop-in", offset: "0%" }),
      svg("stop", { class: "wg-orion-stop-mid", offset: "46%" }),
      svg("stop", { class: "wg-orion-stop-out", offset: "100%" })
    )
  ));
  node.appendChild(svg("circle", { class: "wg-orion-glow", cx: 50, cy: 50, r: 46, fill: `url(#${id})` }));
  for (const tilt of [-26, 34, 86]) {
    node.appendChild(svg("ellipse", { class: "wg-orion-ring", cx: 50, cy: 50, rx: 34, ry: 12.5, transform: `rotate(${tilt} 50 50)` }));
  }
  const sparks = svg("g", { class: "wg-orion-sparks" });
  for (let turn = 0; turn < 3; turn += 1) {
    const angle = turn * 2 * Math.PI / 3;
    sparks.appendChild(svg("circle", { class: "wg-orion-spark", cx: (50 + Math.cos(angle) * 31).toFixed(2), cy: (50 + Math.sin(angle) * 31).toFixed(2), r: 2.2 }));
  }
  node.appendChild(sparks);
  node.appendChild(svg("circle", { class: "wg-orion-core", cx: 50, cy: 50, r: 13 }));
  node.appendChild(svg("circle", { class: "wg-orion-shine", cx: 45, cy: 45, r: 4.4 }));
  return node;
}
function orion(ctx) {
  const prompt = String(ctx.settings.prompt ?? "");
  const roomy = ctx.size === "wide" || ctx.size === "large";
  clear(ctx.body);
  const root = h("form", { class: "wg-orion", "data-size": ctx.size, ...ctx.still ? { "data-still": "" } : {} });
  root.appendChild(orb());
  const box = inert(h("input", {
    class: "wg-orion-box",
    type: "text",
    autocomplete: "off",
    maxlength: 400,
    placeholder: prompt,
    "aria-label": "Ask Orion"
  }), ctx.preview);
  const send = inert(h("button", { class: "wg-btn primary wg-orion-send", type: "submit", text: "Ask" }), ctx.preview);
  const answer = h("p", { class: "wg-orion-answer", role: "status", "aria-live": "polite" });
  const ready = () => {
    if (ctx.preview) return;
    send.disabled = box.value.trim() === "";
  };
  box.addEventListener("input", ready);
  ready();
  const stack2 = h(
    "div",
    { class: "wg-orion-stack" },
    h("div", { class: "wg-orion-middle" }, h("span", { class: "wg-orion-field" }, box), send)
  );
  root.appendChild(stack2);
  if (roomy) {
    const row2 = h("div", { class: "wg-orion-starters" });
    for (const starter of STARTERS) {
      const chip = inert(h("button", { class: "wg-chip wg-orion-starter", type: "button", text: starter }), ctx.preview);
      chip.addEventListener("click", () => {
        box.value = starter;
        ready();
        box.focus();
      });
      row2.appendChild(chip);
    }
    stack2.appendChild(row2);
  }
  stack2.appendChild(answer);
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const text2 = box.value.trim();
    if (text2 === "" || ctx.preview) return;
    send.disabled = true;
    answer.textContent = "Asking Orion\u2026";
    void ctx.run({ do: "orion.ask", text: text2 }).then((result) => {
      answer.textContent = result.message ?? (result.ok ? "Asked Orion." : "Orion could not be asked.");
      if (result.ok) box.value = "";
      ready();
    });
  });
  ctx.body.appendChild(root);
}

// orbis-ui/newtab/widgets/renderers/live.ts
var LIVE_RENDERERS = Object.freeze({ weather, news, markets, orion });

// orbis-ui/newtab/widgets/renderers/index.ts
var RENDERERS = Object.freeze({ ...TIME_RENDERERS, ...PERSONAL_RENDERERS, ...LIVE_RENDERERS });

// orbis-ui/newtab/widgets/card.ts
var REAL_TIME = /* @__PURE__ */ new Set(["clock", "worldclock", "greeting", "timer"]);
var sameSettings = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function createCard(options) {
  let instance = options.instance;
  let size = options.size ?? instance.size;
  const definition = widgetById(instance.widget);
  const element = h("article", { class: "wg-card", role: "group" });
  const body = h("div", { class: "wg-body" });
  element.append(body);
  let failed = false;
  let cleanups = [];
  let savedTimer = 0;
  let pending = null;
  let gone = false;
  const dress = () => {
    element.dataset.widget = instance.widget;
    element.dataset.size = size;
    element.dataset.tone = instance.look.tone;
    element.dataset.density = instance.look.density;
    if (options.preview) element.dataset.preview = "true";
    if (instance.locked) element.dataset.locked = "true";
    else delete element.dataset.locked;
    element.setAttribute("aria-label", definition?.name ?? instance.widget);
  };
  const undoEverything = () => {
    for (const undo of cleanups.splice(0)) {
      try {
        undo();
      } catch {
      }
    }
  };
  const keep = (settings) => {
    if (options.preview) return;
    pending = { ...pending ?? {}, ...settings };
    clearTimeout(savedTimer);
    savedTimer = setTimeout(flush, 400);
  };
  const flush = () => {
    clearTimeout(savedTimer);
    savedTimer = 0;
    const settings = pending;
    pending = null;
    if (!settings) return;
    void options.link.act({ type: "configure", id: instance.id, settings });
  };
  const state = (kind, text2, action, iconName) => {
    clear(body);
    const block = h("div", { class: `wg-state wg-state-${kind}` });
    if (kind === "loading") {
      block.append(h("div", { class: "wg-skeleton wg-skeleton-wide" }), h("div", { class: "wg-skeleton" }));
      block.setAttribute("aria-label", `${definition?.name ?? "The widget"} is loading`);
    } else {
      if (iconName) block.append(h("div", { class: "wg-state-mark" }, icon(iconName, 20)));
      block.append(h("p", { class: "wg-state-words", text: text2 }));
      if (action) block.append(button(action.label, action.press, action.label, "wg-btn"));
    }
    body.append(block);
  };
  const note = (text2) => {
    const already = body.querySelector(".wg-note");
    if (already) already.remove();
    if (text2) body.append(h("p", { class: "wg-note", text: text2 }));
  };
  const draw = () => {
    undoEverything();
    clearTimeout(savedTimer);
    savedTimer = 0;
    failed = false;
    dress();
    clear(body);
    if (!definition) {
      state("failed", "Orbis no longer has this widget.", void 0, "settings");
      failed = true;
      return;
    }
    const render = RENDERERS[definition.id];
    if (!render) {
      state("failed", `${definition.name} cannot be shown on the start page.`, void 0, "settings");
      failed = true;
      return;
    }
    const still = options.preview ? true : prefersStill();
    const settings = Object.fromEntries(definition.settings.map((spec) => [spec.name, clampWidgetSetting(spec, instance.settings[spec.name])]));
    const ctx = {
      body,
      instance,
      definition,
      size,
      settings,
      look: instance.look,
      preview: options.preview,
      still,
      hour12: options.hour12,
      now: () => options.preview && !REAL_TIME.has(definition.id) ? SAMPLE_NOW : Date.now(),
      feed: (request, drawFeed, feedOptions) => watchFeed(request, drawFeed, feedOptions),
      run: async (command) => {
        if (options.preview) return { ok: false, message: "This is a preview." };
        return options.link.run(command);
      },
      save: keep,
      open: (url) => {
        if (options.preview) return;
        try {
          const address = new URL(url);
          if (address.protocol === "http:" || address.protocol === "https:") location.assign(address.href);
        } catch {
        }
      },
      every: (ms, tick) => {
        const wait = Math.max(200, Math.floor(ms));
        let timer2 = 0;
        const run = () => {
          if (document.hidden) return;
          safely(tick);
        };
        const start = () => {
          clearInterval(timer2);
          timer2 = setInterval(run, wait);
        };
        const wake = () => {
          if (document.hidden) return;
          run();
          start();
        };
        start();
        document.addEventListener("visibilitychange", wake);
        cleanups.push(() => {
          clearInterval(timer2);
          document.removeEventListener("visibilitychange", wake);
        });
      },
      onCleanup: (undo) => cleanups.push(undo),
      show: {
        empty: (text2, action) => state("empty", text2, action, definition.icon),
        needs: (text2, label = "Open settings") => state("needs", text2, options.onSettings ? { label, press: () => options.onSettings?.(instance) } : void 0, "settings"),
        note
      }
    };
    safely(() => render(ctx));
  };
  function safely(what) {
    if (gone) return;
    try {
      what();
    } catch (err) {
      failed = true;
      console.error(`[widgets] ${instance.widget} stopped working`, err);
      undoEverything();
      state("failed", "This widget stopped working.", { label: "Try again", press: draw }, "settings");
      options.onFailure?.(instance, err);
    }
  }
  function watchFeed(request, drawFeed, feedOptions) {
    let first = true;
    let last = 0;
    const read = async (fresh = false) => {
      if (gone) return;
      if (first) state("loading", "");
      const feed = options.preview ? sampleFeed(request.source) : await options.link.feed({ ...request, ...fresh ? { fresh: true } : {} });
      if (gone) return;
      first = false;
      last = Date.now();
      if (!feed.value) {
        if (feed.needs) return ctxNeeds(feed);
        return state("failed", feed.error ?? "That could not be read.", { label: "Try again", press: () => void read(true) }, definition?.icon);
      }
      if (feedOptions?.empty?.(feed.value)) {
        return state("empty", feedOptions.emptyText ?? "Nothing here yet.", feedOptions.emptyAction, definition?.icon);
      }
      clear(body);
      safely(() => drawFeed(feed));
      if (failed) return;
      if (feed.status === "cached") note(`Last read ${ago(feed.at, Date.now())}${navigator.onLine ? "" : " \u2014 no connection"}.`);
    };
    const ctxNeeds = (feed) => state("needs", `${feed.needs}.`, options.onSettings ? { label: feed.needs ?? "Open settings", press: () => options.onSettings?.(instance) } : void 0, "settings");
    void read();
    if (options.preview) return;
    const stop = options.link.onFeed((source) => {
      if (source === request.source) void read();
    });
    cleanups.push(stop);
    const everyMs = feedOptions?.everyMs ?? 0;
    if (everyMs > 0) {
      const timer2 = setInterval(() => {
        if (!document.hidden) void read(true);
      }, Math.max(3e4, everyMs));
      cleanups.push(() => clearInterval(timer2));
    }
    const wake = () => {
      if (!document.hidden && Date.now() - last > 6e4) void read();
    };
    document.addEventListener("visibilitychange", wake);
    cleanups.push(() => document.removeEventListener("visibilitychange", wake));
  }
  draw();
  return {
    element,
    update: (next, nextSize) => {
      const wanted = nextSize ?? next.size;
      const nothingChanged = next.widget === instance.widget && wanted === size && next.look.tone === instance.look.tone && next.look.density === instance.look.density && next.locked === instance.locked && sameSettings(next.settings, instance.settings);
      instance = next;
      size = wanted;
      if (nothingChanged) return void dress();
      draw();
    },
    failed: () => failed,
    destroy: () => {
      gone = true;
      flush();
      undoEverything();
      clear(body);
      element.remove();
    }
  };
}

// orbis-ui/newtab/widgets/menu.ts
var open = null;
var closeMenus = () => {
  open?.close();
  open = null;
};
function openMenu(at2, items, options = { label: "Menu" }) {
  closeMenus();
  const list = h("div", { class: "wg-menu", role: "menu", "aria-label": options.label, tabindex: "-1" });
  const buttons = [];
  let childMenu = null;
  const shut = () => {
    childMenu?.close();
    childMenu = null;
    document.removeEventListener("pointerdown", awayPointer, true);
    document.removeEventListener("keydown", keys, true);
    window.removeEventListener("resize", shut);
    list.remove();
    if (open === mine) open = null;
    options.returnTo?.focus();
  };
  const mine = { close: shut };
  for (const item of items) {
    if (item.separated) list.append(h("div", { class: "wg-menu-line", role: "separator" }));
    const node = h("button", {
      class: `wg-menu-item${item.on ? " on" : ""}`,
      type: "button",
      role: "menuitem",
      disabled: item.disabled === true,
      "aria-checked": item.on === true ? "true" : void 0,
      "aria-haspopup": item.items ? "true" : void 0
    });
    node.append(h("span", { class: "wg-menu-tick", "aria-hidden": "true", text: item.on ? "\u2713" : "" }), h("span", { class: "wg-menu-words", text: item.label }));
    if (item.items) node.append(h("span", { class: "wg-menu-more", "aria-hidden": "true", text: "\u203A" }));
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      if (item.disabled) return;
      if (item.items) {
        const where = node.getBoundingClientRect();
        const nested = openMenuNested({ x: where.right - 6, y: where.top }, item.items, node);
        childMenu = nested;
        return;
      }
      shut();
      item.press?.();
    });
    buttons.push(node);
    list.append(node);
  }
  list.style.left = "0px";
  list.style.top = "0px";
  document.body.append(list);
  const size = list.getBoundingClientRect();
  const x = Math.max(8, Math.min(at2.x, window.innerWidth - size.width - 8));
  const y = Math.max(8, Math.min(at2.y, window.innerHeight - size.height - 8));
  list.style.left = `${Math.round(x)}px`;
  list.style.top = `${Math.round(y)}px`;
  const awayPointer = (event) => {
    if (!list.contains(event.target)) shut();
  };
  const keys = (event) => {
    if (!document.body.contains(list)) return;
    const usable = buttons.filter((one) => !one.disabled);
    const at3 = usable.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      shut();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (at3 + 1) % usable.length : (at3 <= 0 ? usable.length : at3) - 1;
      usable[next]?.focus();
    }
  };
  document.addEventListener("pointerdown", awayPointer, true);
  document.addEventListener("keydown", keys, true);
  window.addEventListener("resize", shut);
  buttons.find((one) => !one.disabled)?.focus();
  open = mine;
  return mine;
}
function openMenuNested(at2, items, returnTo) {
  const keep = open;
  const nested = openMenu(at2, items, { label: "More", returnTo });
  open = keep;
  return nested;
}

// orbis-ui/newtab/widgets/boardMath.ts
function cellAt(box, x, y, rows) {
  const step = box.cell + box.gap;
  const column = Math.min(box.columns - 1, Math.max(0, Math.floor((x - box.left) / step)));
  const row2 = Math.min(Math.max(0, rows - 1), Math.max(0, Math.floor((y - box.top) / step)));
  return { column, row: row2 };
}
function orderFromCell(instances, draggedId, column, row2, columns) {
  const shown = visibleWidgets(instances);
  const { placed } = packBoard(shown, columns);
  const from = shown.findIndex((one) => one.id === draggedId);
  if (from < 0) return Math.max(0, shown.length - 1);
  const over = placed.findIndex((one) => column >= one.x && column < one.x + one.w && row2 >= one.y && row2 < one.y + one.h);
  if (over >= 0) return over;
  const after = placed.filter((one) => one.y <= row2);
  if (after.length === 0) return 0;
  const onRow = placed.filter((one) => row2 >= one.y && row2 < one.y + one.h);
  if (onRow.length > 0) {
    const last = onRow[onRow.length - 1];
    return column > last.x ? placed.indexOf(last) : placed.indexOf(onRow[0]);
  }
  return Math.max(0, shown.length - 1);
}
function layoutIfMoved(instances, id, to, columns) {
  const shown = visibleWidgets(instances);
  const one = shown.find((other) => other.id === id);
  if (!one) return packBoard(shown, columns);
  const others = shown.filter((other) => other.id !== id);
  const at2 = Math.min(others.length, Math.max(0, to));
  return packBoard([...others.slice(0, at2), one, ...others.slice(at2)].map((other, order) => ({ ...other, order })), columns);
}
function nearestSize(sizes, across, down, columns) {
  if (sizes.length === 0) return null;
  let best = null;
  for (const size of sizes) {
    const span2 = SIZE_SPAN[size];
    const w = Math.min(columns, span2.w);
    const off = Math.abs(w - across) + Math.abs(span2.h - down);
    const area = w * span2.h;
    if (!best || off < best.off || off === best.off && area > best.area) best = { size, off, area };
  }
  return best?.size ?? null;
}
function spanFromPixels(box, width, height) {
  const step = box.cell + box.gap;
  return {
    across: Math.min(box.columns, Math.max(1, Math.round((width + box.gap) / step))),
    down: Math.max(1, Math.round((height + box.gap) / step))
  };
}
function stepSize(sizes, current, by) {
  const at2 = sizes.indexOf(current);
  if (at2 < 0) return sizes[0] ?? null;
  const next = at2 + by;
  return next >= 0 && next < sizes.length ? sizes[next] : null;
}
function stepOrder(instances, id, by) {
  const shown = visibleWidgets(instances);
  const at2 = shown.findIndex((one) => one.id === id);
  if (at2 < 0) return null;
  const to = at2 + by;
  return to >= 0 && to < shown.length ? to : null;
}

// orbis-ui/newtab/widgets/board.ts
var PATIENCE = 4e3;
function mountBoard(host, deps) {
  const bar = h("div", { class: "wg-arrange-bar", hidden: true });
  const grid = h("div", { class: "wg-board", role: "list" });
  const tray = h("div", { class: "wg-tray", hidden: true });
  const spoken2 = h("p", { class: "wg-spoken", role: "status", "aria-live": "polite" });
  host.append(bar, grid, tray, spoken2);
  const cards = /* @__PURE__ */ new Map();
  let state = null;
  let connected = false;
  let arranging = false;
  let columns = 1;
  let waitedFrom = Date.now();
  const failures = /* @__PURE__ */ new Map();
  const say = (words) => {
    spoken2.textContent = words;
  };
  const boardNow = () => state?.board ?? null;
  const measure = () => {
    const where = grid.getBoundingClientRect();
    return { left: where.left, top: where.top, cell: GRID.cell, gap: GRID.gap, columns };
  };
  const place = (node, at2) => {
    node.style.gridColumn = `${at2.x + 1} / span ${at2.w}`;
    node.style.gridRow = `${at2.y + 1} / span ${at2.h}`;
  };
  const draw = () => {
    const board = boardNow();
    const shown = board && board.enabled ? visibleWidgets(board.instances) : [];
    grid.style.setProperty("--wg-columns", String(columns));
    if (!board) return Date.now() - waitedFrom > PATIENCE ? drawWaiting() : void 0;
    for (const [id, card] of [...cards]) {
      if (!shown.some((one) => one.id === id)) {
        card.destroy();
        cards.delete(id);
      }
    }
    const { placed, rows } = packBoard(shown, columns);
    const wraps = /* @__PURE__ */ new Map();
    for (const one of shown) {
      let card = cards.get(one.id);
      if (!card) {
        card = createCard({
          instance: one,
          preview: false,
          link: deps.link,
          hour12: deps.hour12(),
          onSettings: (which) => deps.go({ view: "instance", id: which.id }),
          onFailure: (which) => noteFailure(which)
        });
        cards.set(one.id, card);
      } else {
        card.update(one);
      }
      const wrap = card.element.parentElement?.classList.contains("wg-slot") ? card.element.parentElement : h("div", { class: "wg-slot", role: "listitem" });
      if (!wrap.contains(card.element)) wrap.append(card.element);
      wrap.dataset.id = one.id;
      wraps.set(one.id, wrap);
    }
    grid.replaceChildren(...placed.map((at2) => {
      const wrap = wraps.get(at2.id);
      place(wrap, at2);
      dressSlot(wrap, shown.find((one) => one.id === at2.id));
      return wrap;
    }));
    grid.append(outline);
    grid.style.setProperty("--wg-rows", String(Math.max(1, rows)));
    grid.hidden = shown.length === 0;
    drawEmpty(shown.length);
    drawBar();
    drawTray();
    report();
  };
  const drawWaiting = () => {
    grid.hidden = true;
    tray.hidden = true;
    bar.hidden = true;
    const already = host.querySelector(".wg-offline");
    if (already) return;
    host.append(h("p", { class: "wg-offline", text: "Widgets need Orbis to be running." }));
    report();
  };
  const drawEmpty = (count) => {
    host.querySelector(".wg-offline")?.remove();
    if (!connected && Date.now() - waitedFrom > PATIENCE) host.append(h("p", { class: "wg-offline", text: "Orbis is not answering, so what is shown may be out of date." }));
    host.querySelector(".wg-add-tile")?.remove();
    const board = boardNow();
    if (count > 0 || !board) return;
    const tile = h("button", { class: "wg-add-tile", type: "button" });
    tile.append(icon("settings", 20), h("span", { text: "Add widgets" }));
    tile.addEventListener("click", () => deps.go({ view: "home" }));
    host.insertBefore(tile, tray);
  };
  const dressSlot = (wrap, one) => {
    wrap.querySelector(".wg-handles")?.remove();
    wrap.classList.toggle("arranging", arranging);
    wrap.tabIndex = arranging ? 0 : -1;
    if (arranging) {
      const definition = widgetById(one.widget);
      wrap.setAttribute("aria-label", `${definition?.name ?? one.widget}. Arrow keys move it, plus and minus change its size, Enter opens its settings.`);
    } else wrap.removeAttribute("aria-label");
    if (!arranging) return;
    const name = widgetById(one.widget)?.name ?? one.widget;
    const handles = h("div", { class: "wg-handles" });
    handles.append(
      button(`Remove ${name}`, () => void change({ type: "remove", id: one.id }, `${name} removed`, { type: "undo" }), icon("close", 14), "wg-icon-btn wg-handle wg-handle-remove"),
      h(
        "div",
        { class: "wg-handle-group" },
        button(`${name} settings`, () => deps.go({ view: "instance", id: one.id }), icon("settings", 14), "wg-icon-btn wg-handle"),
        button(`Size of ${name}`, (event) => sizeMenu(event, one), icon("tabs", 14), "wg-icon-btn wg-handle"),
        button(one.locked ? `Unlock ${name}` : `Lock ${name}`, () => void change({ type: "lock", id: one.id, locked: !one.locked }), icon(one.locked ? "lock" : "unlock", 14), "wg-icon-btn wg-handle"),
        button(`Hide ${name}`, () => void change({ type: "hide", id: one.id, hidden: true }, `${name} hidden`, { type: "hide", id: one.id, hidden: false }), icon("history", 14), "wg-icon-btn wg-handle")
      )
    );
    if (!one.locked) handles.append(h("div", { class: "wg-grip", "aria-hidden": "true" }));
    wrap.append(handles);
  };
  const sizeMenu = (event, one) => {
    const definition = widgetById(one.widget);
    if (!definition) return;
    openMenu({ x: event.clientX, y: event.clientY }, definition.sizes.map((size) => ({
      label: SIZE_NAMES[size],
      on: size === one.size,
      press: () => void change({ type: "resize", id: one.id, size })
    })), { label: `Size of ${definition.name}`, returnTo: event.currentTarget });
  };
  const drawBar = () => {
    bar.hidden = !arranging;
    if (!arranging) return;
    clear(bar);
    const canUndo = state?.canUndo === true;
    const canRedo = state?.canRedo === true;
    bar.append(
      button("Add widgets", () => deps.go({ view: "home" }), [icon("extensions", 15), h("span", { text: "Add widgets" })], "wg-btn primary"),
      button("Take back the last change", () => void change({ type: "undo" }), [icon("history", 15), h("span", { text: "Undo" })], `wg-btn${canUndo ? "" : " off"}`),
      button("Put the change back", () => void change({ type: "redo" }), h("span", { text: "Redo" }), `wg-btn${canRedo ? "" : " off"}`),
      button("Layouts", (event) => layoutMenu(event), [icon("workspaces", 15), h("span", { text: "Layouts" })], "wg-btn"),
      h("span", { class: "wg-bar-space" }),
      button("Done arranging", () => arrange(false), h("span", { text: "Done" }), "wg-btn")
    );
    for (const [node, on] of [[bar.children[1], canUndo], [bar.children[2], canRedo]]) node.disabled = !on;
  };
  const layoutMenu = (event) => {
    const items = [{ label: "Save this layout\u2026", press: askLayoutName }];
    for (const layout of state?.layouts ?? []) {
      items.push({
        label: `${layout.name} (${layout.widgets} ${layout.widgets === 1 ? "widget" : "widgets"})`,
        separated: items.length === 1,
        items: [
          { label: "Put it on the start page", press: () => void change({ type: "layout.use", id: layout.id }) },
          { label: "Forget it", press: () => void change({ type: "layout.remove", id: layout.id }) }
        ]
      });
    }
    items.push({ label: "Ready-made layouts\u2026", separated: true, press: () => deps.go({ view: "home" }) });
    openMenu({ x: event.clientX, y: event.clientY }, items, { label: "Layouts", returnTo: event.currentTarget });
  };
  const askLayoutName = () => {
    clear(bar);
    const field = h("input", { class: "wg-name-field", type: "text", maxLength: "60", placeholder: "Name this layout", "aria-label": "Name this layout" });
    const save = async () => {
      const name = field.value.trim();
      if (!name) return void field.focus();
      await change({ type: "layout.save", name });
      drawBar();
    };
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void save();
      if (event.key === "Escape") drawBar();
    });
    bar.append(field, button("Save the layout", () => void save(), h("span", { text: "Save" }), "wg-btn primary"), button("Cancel", drawBar, h("span", { text: "Cancel" }), "wg-btn"));
    field.focus();
  };
  const drawTray = () => {
    const board = boardNow();
    const aside = board ? orderedWidgets(board.instances).filter((one) => one.hidden || one.disabled) : [];
    tray.hidden = !arranging || aside.length === 0;
    if (tray.hidden) return;
    clear(tray);
    tray.append(h("p", { class: "wg-label", text: "Not on the page" }));
    const row2 = h("div", { class: "wg-tray-row" });
    for (const one of aside) {
      const name = widgetById(one.widget)?.name ?? one.widget;
      const chip = h("div", { class: "wg-tray-chip" }, icon(widgetById(one.widget)?.icon ?? "extensions", 15), h("span", { text: name }));
      if (one.disabled) chip.append(h("span", { class: "wg-tray-why", text: "stopped working" }));
      chip.append(
        button(one.disabled ? `Start ${name} again` : `Show ${name} again`, () => void change(one.disabled ? { type: "revive", id: one.id } : { type: "hide", id: one.id, hidden: false }), h("span", { text: one.disabled ? "Start again" : "Show" }), "wg-btn"),
        button(`Remove ${name}`, () => void change({ type: "remove", id: one.id }, `${name} removed`, { type: "undo" }), icon("close", 13), "wg-icon-btn")
      );
      row2.append(chip);
    }
    tray.append(row2);
  };
  const change = async (request, said3, undo) => {
    const reply = await deps.link.act(request);
    if (!reply.ok) {
      deps.say(reply.message);
      say(reply.message);
      return false;
    }
    const words = said3 ?? reply.said;
    if (words) {
      say(words);
      deps.say(words, undo ? { label: "Undo", press: () => void change(undo) } : void 0);
    }
    return true;
  };
  const noteFailure = (one) => {
    const count = (failures.get(one.id) ?? 0) + 1;
    failures.set(one.id, count);
    if (count < 3 || one.disabled) return;
    const name = widgetById(one.widget)?.name ?? one.widget;
    say(`${name} kept failing and has been set aside.`);
    deps.say(`${name} kept failing and has been set aside. It is under "Not on the page" while arranging.`);
  };
  let dragging = null;
  let resizing = null;
  const outline = h("div", { class: "wg-drop", hidden: true, "aria-hidden": "true" });
  grid.append(outline);
  grid.addEventListener("pointerdown", (event) => {
    if (!arranging || event.button !== 0) return;
    const slot = event.target.closest(".wg-slot");
    if (!slot) return;
    const id = slot.dataset.id ?? "";
    const one = boardNow()?.instances.find((other) => other.id === id);
    if (!one) return;
    const onHandle = event.target.closest(".wg-handle, .wg-btn, .wg-icon-btn");
    if (onHandle) return;
    const grip = event.target.closest(".wg-grip");
    if (one.locked) {
      const name = widgetById(one.widget)?.name ?? one.widget;
      deps.say(`${name} is locked. Unlock it to move or resize it.`);
      return;
    }
    const where = slot.getBoundingClientRect();
    event.preventDefault();
    slot.setPointerCapture(event.pointerId);
    if (grip) {
      resizing = { id, pointer: event.pointerId, from: { x: event.clientX, y: event.clientY }, size: one.size, node: slot, box: measure(), start: { w: where.width, h: where.height } };
      slot.classList.add("resizing");
      return;
    }
    const { placed, rows } = packBoard(visibleWidgets(boardNow()?.instances ?? []), columns);
    dragging = { id, pointer: event.pointerId, from: { x: event.clientX, y: event.clientY }, to: placed.findIndex((other) => other.id === id), node: slot, box: measure(), rows };
    slot.classList.add("dragging");
  });
  grid.addEventListener("pointermove", (event) => {
    if (dragging && event.pointerId === dragging.pointer) {
      const dx = event.clientX - dragging.from.x;
      const dy = event.clientY - dragging.from.y;
      dragging.node.style.setProperty("--wg-drag-x", `${Math.round(dx)}px`);
      dragging.node.style.setProperty("--wg-drag-y", `${Math.round(dy)}px`);
      const cell = cellAt(dragging.box, event.clientX, event.clientY, dragging.rows);
      const to = orderFromCell(boardNow()?.instances ?? [], dragging.id, cell.column, cell.row, columns);
      dragging.to = to;
      showDrop(to);
      edgeScroll(event.clientY);
      return;
    }
    if (resizing && event.pointerId === resizing.pointer) {
      const definition = widgetById(boardNow()?.instances.find((one) => one.id === resizing.id)?.widget ?? "");
      if (!definition) return;
      const span2 = spanFromPixels(resizing.box, resizing.start.w + (event.clientX - resizing.from.x), resizing.start.h + (event.clientY - resizing.from.y));
      const size = nearestSize(definition.sizes, span2.across, span2.down, columns);
      if (size) {
        resizing.size = size;
        showResize(resizing.id, size);
      }
    }
  });
  const stop = (event) => {
    if (dragging && event.pointerId === dragging.pointer) {
      const { id, to, node } = dragging;
      dragging = null;
      node.classList.remove("dragging");
      node.style.removeProperty("--wg-drag-x");
      node.style.removeProperty("--wg-drag-y");
      outline.hidden = true;
      void change({ type: "move", id, to });
      return;
    }
    if (resizing && event.pointerId === resizing.pointer) {
      const { id, size, node } = resizing;
      resizing = null;
      node.classList.remove("resizing");
      outline.hidden = true;
      void change({ type: "resize", id, size });
    }
  };
  grid.addEventListener("pointerup", stop);
  grid.addEventListener("pointercancel", () => {
    if (dragging) {
      dragging.node.classList.remove("dragging");
      dragging.node.style.removeProperty("--wg-drag-x");
      dragging.node.style.removeProperty("--wg-drag-y");
    }
    resizing?.node.classList.remove("resizing");
    dragging = null;
    resizing = null;
    outline.hidden = true;
  });
  const showDrop = (to) => {
    const laid = layoutIfMoved(boardNow()?.instances ?? [], dragging?.id ?? "", to, columns);
    const at2 = laid.placed.find((one) => one.id === dragging?.id);
    if (!at2) return;
    place(outline, at2);
    outline.hidden = false;
  };
  const showResize = (id, size) => {
    const board = boardNow();
    if (!board) return;
    const laid = packBoard(visibleWidgets(board.instances).map((one) => one.id === id ? { ...one, size } : one), columns);
    const at2 = laid.placed.find((one) => one.id === id);
    if (!at2) return;
    place(outline, at2);
    outline.hidden = false;
  };
  let scrolling = 0;
  const edgeScroll = (y) => {
    clearTimeout(scrolling);
    const near = 90;
    const by = y < near ? -14 : y > window.innerHeight - near ? 14 : 0;
    if (by === 0) return;
    window.scrollBy({ top: by });
    scrolling = setTimeout(() => edgeScroll(y), 40);
  };
  grid.addEventListener("keydown", (event) => {
    const slot = event.target.closest(".wg-slot");
    if (!slot || !arranging) return;
    const id = slot.dataset.id ?? "";
    const one = boardNow()?.instances.find((other) => other.id === id);
    if (!one) return;
    const definition = widgetById(one.widget);
    const name = definition?.name ?? one.widget;
    const nudge = (by) => {
      const to = stepOrder(boardNow()?.instances ?? [], id, by);
      if (to === null) return void say(`${name} is already at the ${by === 1 ? "end" : "start"}.`);
      void change({ type: "move", id, to }).then((ok) => ok && focusAgain(id));
    };
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        return nudge(-1);
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        return nudge(1);
      case "+":
      case "=": {
        event.preventDefault();
        const size = definition ? stepSize(definition.sizes, one.size, 1) : null;
        return size ? void change({ type: "resize", id, size }).then((ok) => ok && focusAgain(id)) : void say(`${name} is already as large as it comes.`);
      }
      case "-":
      case "_": {
        event.preventDefault();
        const size = definition ? stepSize(definition.sizes, one.size, -1) : null;
        return size ? void change({ type: "resize", id, size }).then((ok) => ok && focusAgain(id)) : void say(`${name} is already as small as it comes.`);
      }
      case "Delete":
      case "Backspace":
        event.preventDefault();
        return void change({ type: "remove", id }, `${name} removed`, { type: "undo" });
      case "Enter":
        event.preventDefault();
        return deps.go({ view: "instance", id });
      case "l":
      case "L":
        event.preventDefault();
        return void change({ type: "lock", id, locked: !one.locked });
      case "h":
      case "H":
        event.preventDefault();
        return void change({ type: "hide", id, hidden: true }, `${name} hidden`, { type: "hide", id, hidden: false });
      case "F10":
        if (!event.shiftKey) return;
        event.preventDefault();
        return cardMenu(slot.getBoundingClientRect().left + 20, slot.getBoundingClientRect().top + 20, one, slot);
      case "ContextMenu":
        event.preventDefault();
        return cardMenu(slot.getBoundingClientRect().left + 20, slot.getBoundingClientRect().top + 20, one, slot);
      default:
        return;
    }
  });
  const focusAgain = (id) => {
    const slot = grid.querySelector(`.wg-slot[data-id="${CSS.escape(id)}"]`);
    slot?.focus();
  };
  grid.addEventListener("contextmenu", (event) => {
    const slot = event.target.closest(".wg-slot");
    if (!slot) return;
    const one = boardNow()?.instances.find((other) => other.id === slot.dataset.id);
    if (!one) return;
    event.preventDefault();
    cardMenu(event.clientX, event.clientY, one, slot);
  });
  const cardMenu = (x, y, one, returnTo) => {
    const definition = widgetById(one.widget);
    const name = definition?.name ?? one.widget;
    openMenu({ x, y }, [
      { label: "Settings", press: () => deps.go({ view: "instance", id: one.id }) },
      { label: "Size", items: (definition?.sizes ?? []).map((size) => ({ label: SIZE_NAMES[size], on: size === one.size, press: () => void change({ type: "resize", id: one.id, size }) })) },
      { label: "Look", items: Object.entries(TONE_NAMES).map(([tone, label]) => ({ label, on: one.look.tone === tone, press: () => void change({ type: "look", id: one.id, look: { tone } }) })) },
      { label: one.locked ? "Unlock" : "Lock", press: () => void change({ type: "lock", id: one.id, locked: !one.locked }) },
      { label: "Hide", press: () => void change({ type: "hide", id: one.id, hidden: true }, `${name} hidden`, { type: "hide", id: one.id, hidden: false }) },
      { label: "Remove from the start page", press: () => void change({ type: "remove", id: one.id }, `${name} removed`, { type: "undo" }) },
      { label: arranging ? "Done arranging" : "Arrange widgets", separated: true, press: () => arrange(!arranging) },
      { label: "Add widgets", press: () => deps.go({ view: "home" }) }
    ], { label: name, returnTo });
  };
  const arrange = (on) => {
    if (arranging === on) return;
    arranging = on;
    closeMenus();
    host.classList.toggle("arranging", on);
    draw();
    if (on) {
      say("Arranging. Arrow keys move a widget, plus and minus change its size, Escape finishes.");
      grid.querySelector(".wg-slot")?.setAttribute("tabindex", "0");
    } else say("Finished arranging.");
  };
  const keys = (event) => {
    if (!arranging) return;
    if (event.key === "Escape") {
      event.preventDefault();
      arrange(false);
      return;
    }
    const undo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
    const redo = (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "y" || event.shiftKey && event.key.toLowerCase() === "z");
    if (redo) {
      event.preventDefault();
      void change({ type: "redo" });
    } else if (undo) {
      event.preventDefault();
      void change({ type: "undo" });
    }
  };
  document.addEventListener("keydown", keys);
  const report = () => {
    deps.link.report({
      revision: state?.revision ?? 0,
      shown: [...cards.keys()].filter((id) => grid.querySelector(`.wg-slot[data-id="${CSS.escape(id)}"]`) !== null),
      failed: [...cards].filter(([, card]) => card.failed()).map(([id]) => id),
      columns,
      gallery: false,
      arranging
    });
  };
  const stopWatching = deps.link.subscribe((next, isConnected) => {
    state = next;
    connected = isConnected;
    if (!next) waitedFrom = Date.now();
    draw();
  });
  const fit = () => {
    const wide = host.clientWidth || host.getBoundingClientRect().width;
    const next = columnsFor(wide);
    if (next === columns) return;
    columns = next;
    draw();
  };
  const watcher = new ResizeObserver(fit);
  watcher.observe(host);
  fit();
  return {
    arrange,
    arranging: () => arranging,
    destroy: () => {
      stopWatching();
      watcher.disconnect();
      document.removeEventListener("keydown", keys);
      for (const card of cards.values()) card.destroy();
      cards.clear();
      bar.remove();
      grid.remove();
      tray.remove();
      spoken2.remove();
    }
  };
}

// orbis-ui/newtab/widgets/galleryLogic.ts
var GALLERY_FILTERS = Object.freeze([
  { id: "all", label: "All" },
  { id: "installed", label: "On your start page" },
  { id: "favourites", label: "Favourites" },
  { id: "offline", label: "Works offline" }
]);
var FILTER_IDS = new Set(GALLERY_FILTERS.map((one) => one.id));
var asFilter = (value) => value !== void 0 && FILTER_IDS.has(value) ? value : "all";
var CATEGORY_IDS = new Set(Object.keys(CATEGORY_NAMES));
var asCategory = (value) => value !== void 0 && CATEGORY_IDS.has(value) ? value : "all";
var queryOf = (route) => ({
  query: (route.query ?? "").trim(),
  category: asCategory(route.category),
  filter: asFilter(route.filter)
});
var isBrowsing = (route) => {
  const asked = queryOf(route);
  return (asked.query ?? "") !== "" || asked.category !== "all" || asked.filter !== "all";
};
var holds = (drawable, id) => drawable instanceof Set ? drawable.has(id) : drawable.includes(id);
function offerWidget(definition, drawable) {
  if (definition.unavailable) return { ok: false, reason: definition.unavailable };
  if (!isAvailable(definition)) return { ok: false, reason: `${definition.name} cannot go on the start page yet.` };
  if (!holds(drawable, definition.id)) return { ok: false, reason: `The start page cannot draw ${definition.name} yet.` };
  return { ok: true };
}
var offeredWidgets = (drawable) => WIDGETS.filter((one) => offerWidget(one, drawable).ok);
var countWidgets = (n) => n === 1 ? "1 widget" : `${n} widgets`;
function homeSections(input) {
  const { board, layouts, drawable } = input;
  const can = new Set(offeredWidgets(drawable).map((one) => one.id));
  const sections = [];
  const shown = visibleWidgets(board.instances);
  if (shown.length > 0) sections.push({ id: "board", key: "board", title: "Your start page", note: `${countWidgets(shown.length)}, as they sit now.`, widgets: [] });
  const featured = WIDGETS.filter((one) => one.featured && can.has(one.id)).map((one) => one.id);
  if (featured.length > 0) sections.push({ id: "featured", key: "featured", title: "Featured", note: "Chosen by Orbis.", widgets: featured, hero: true });
  const onBoard = [];
  for (const one of shown) if (can.has(one.widget) && !onBoard.includes(one.widget)) onBoard.push(one.widget);
  if (onBoard.length > 0) sections.push({ id: "installed", key: "installed", title: "On your start page", widgets: onBoard });
  const favourites = board.favourites.filter((id) => can.has(id));
  if (favourites.length > 0) sections.push({ id: "favourites", key: "favourites", title: "Favourites", widgets: favourites });
  const recent = board.recent.map((one) => one.widget).filter((id) => can.has(id) && !onBoard.includes(id));
  if (recent.length > 0) sections.push({ id: "recent", key: "recent", title: "Recently used", note: "Kept on this computer.", widgets: recent });
  const presets = WIDGET_PRESETS.filter((one) => presetOffered(one, can)).map((one) => one.id);
  if (presets.length > 0) sections.push({ id: "presets", key: "presets", title: "Ready-made layouts", note: "Each one sets out the whole start page.", widgets: [], presets });
  if (layouts.length > 0) sections.push({ id: "layouts", key: "layouts", title: "Saved layouts", note: "Layouts you kept by name.", widgets: [], layouts: layouts.map((one) => one.id) });
  for (const category of Object.keys(CATEGORY_NAMES)) {
    const widgets = WIDGETS.filter((one) => one.category === category && can.has(one.id)).map((one) => one.id);
    if (widgets.length > 0) sections.push({ id: "category", key: `category:${category}`, title: CATEGORY_NAMES[category], widgets });
  }
  const missing = WIDGETS.map((one) => ({ one, offer: offerWidget(one, drawable) })).filter((pair) => !pair.offer.ok).map((pair) => ({ widget: pair.one.id, reason: pair.offer.reason }));
  if (missing.length > 0) sections.push({ id: "missing", key: "missing", title: "Not available yet", note: "These are in Orbis but cannot go on the start page.", widgets: [], missing });
  return sections;
}
var foundWords = (count) => count === 0 ? "Nothing found" : countWidgets(count);
function tileBadges(definition, board) {
  const badges = [];
  const standing = galleryState(definition, board);
  if (standing.count > 0) badges.push({ text: standing.count === 1 ? "On your start page" : `On your start page \xB7 ${standing.count}`, tone: "on" });
  badges.push(definition.network ? { text: "Needs the internet", tone: "net" } : { text: "Works offline", tone: "off" });
  return badges;
}
function presetNote(preset, board) {
  const made3 = presetLayout(preset);
  const count = made3 ? made3.length : preset.widgets.length;
  const there = visibleWidgets(board.instances).length;
  if (there === 0) return `Puts ${countWidgets(count)} on the start page.`;
  return `Replaces the ${countWidgets(there)} on your start page with ${countWidgets(count)}.`;
}
function presetLayout(preset) {
  let at2 = 0;
  const made3 = presetInstances(preset, 0, () => `preset-${preset.id}-${at2++}`);
  return "error" in made3 ? null : made3.instances;
}
var presetOffered = (preset, drawable) => presetLayout(preset) !== null && preset.widgets.every((one) => holds(drawable, one.widget));
var TILE_SMALLEST = 0.28;
function tileFit(size, room, columns = 2) {
  const { width, height } = sizePixels(size, columns);
  const fits = (side, of) => Number.isFinite(side) && side > 0 ? side / of : 1;
  const raw = Math.min(1, fits(room.width, width), fits(room.height, height));
  const scale = Math.max(TILE_SMALLEST, Math.round(raw * 1e3) / 1e3);
  return { width, height, scale, boxWidth: Math.round(width * scale), boxHeight: Math.round(height * scale) };
}
var GAP_SHARE = 14 / 156;
function miniatureShape(instances, ask) {
  const columns = Math.max(1, Math.floor(ask.columns ?? 4));
  const mostRows = Math.max(1, Math.floor(ask.mostRows ?? 4));
  const width = Math.max(1, ask.width);
  const cell = width / (columns + (columns - 1) * GAP_SHARE);
  const gap = cell * GAP_SHARE;
  const packed = packBoard(instances, columns);
  const kept = packed.placed.filter((one) => one.y + one.h <= mostRows);
  const byId = new Map(instances.map((one) => [one.id, one.widget]));
  const at2 = (n) => n * (cell + gap);
  const blocks = kept.map((one) => ({
    id: one.id,
    widget: byId.get(one.id) ?? "",
    x: at2(one.x),
    y: at2(one.y),
    w: one.w * cell + (one.w - 1) * gap,
    h: one.h * cell + (one.h - 1) * gap
  }));
  const rows = Math.min(mostRows, packed.rows);
  return { width, height: Math.max(cell, rows * cell + Math.max(0, rows - 1) * gap), blocks, cell, gap, columns, rows, hidden: packed.placed.length - kept.length };
}
function nextTile(from, key, columns, count) {
  if (count <= 0) return -1;
  const cols = Math.max(1, Math.floor(columns));
  const at2 = Math.min(count - 1, Math.max(0, from));
  const to = key === "ArrowRight" ? at2 + 1 : key === "ArrowLeft" ? at2 - 1 : key === "ArrowDown" ? at2 + cols : key === "ArrowUp" ? at2 - cols : key === "Home" ? 0 : key === "End" ? count - 1 : at2;
  return Math.min(count - 1, Math.max(0, to));
}
var MARKS2 = Object.freeze({
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7.5V12l3.2 2",
  hourglass: "M7 3h10M7 21h10M7 3c0 4 5 5.5 5 9s-5 5-5 9M17 3c0 4-5 5.5-5 9s5 5 5 9",
  timer: "M12 21a8 8 0 1 0 0-16 8 8 0 1 0 0 16M12 9.5V13h3M9.5 2.5h5M18.6 6.2l1.4-1.4",
  check: "M6.5 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2M8.5 12l2.5 2.5 4.5-5",
  note: "M6 3.5h8l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 6 3.5M14 3.5V8h4.5M8 13h8M8 17h5",
  bookmark: "M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-3.8L5.5 21V4.5a1 1 0 0 1 1-1",
  download: "M12 3.5v11m0 0-3.8-3.8M12 14.5l3.8-3.8M4.5 17v2.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V17",
  tabs: "M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2M3.5 9.5h17M9 4.5v5",
  layers: "M12 3.2 3.5 7.6 12 12l8.5-4.4zM3.5 12.4 12 16.8l8.5-4.4M3.5 16.9 12 21.3l8.5-4.4",
  clipboard: "M9 3.5h6a1 1 0 0 1 1 1v1.6a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1M16 5.3h2.5A1.5 1.5 0 0 1 20 6.8v12.7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5V6.8a1.5 1.5 0 0 1 1.5-1.5H8",
  board: "M5 3.5h14A1.5 1.5 0 0 1 20.5 5v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5M12 16.5v4M8.5 20.5h7M7.5 12l3-3.5 2.5 2.5 2.5-3.5",
  quote: "M9.5 7.5h-4v5h4v2a2.5 2.5 0 0 1-2.5 2.5M19.5 7.5h-4v5h4v2a2.5 2.5 0 0 1-2.5 2.5",
  game: "M7.5 7h9a5 5 0 0 1 5 5 4 4 0 0 1-7 2.8l-.8-.8h-4.4l-.8.8A4 4 0 0 1 2.5 12a5 5 0 0 1 5-5M8 10.5v3M6.5 12h3M15.2 11h.01M17.6 13h.01",
  calculator: "M7 3h10a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 7 3M8.5 7h7M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h3",
  sun: "M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M3.2 10h17.6M3.2 14h17.6M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3",
  cloud: "M7.6 19.5h9.7a4.2 4.2 0 0 0 .5-8.4A6 6 0 0 0 6.4 9.9a4.8 4.8 0 0 0 1.2 9.6",
  news: "M5.5 4.5h10A1.5 1.5 0 0 1 17 6v13.5H6a2 2 0 0 1-2-2V6a1.5 1.5 0 0 1 1.5-1.5M17 8.5h2A1.5 1.5 0 0 1 20.5 10v7.5a2 2 0 0 1-2 2M7 8h7M7 11.5h7M7 15h4",
  history: "M3.5 12a8.5 8.5 0 1 0 2.9-6.4L3.5 8M3.5 3.5V8h4.5M12 7.5V12l3.2 2",
  sticky: "M6 4h12a1.5 1.5 0 0 1 1.5 1.5V14L14 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4M19.5 14H15.5a1.5 1.5 0 0 0-1.5 1.5V20",
  bell: "M6.5 9a5.5 5.5 0 1 1 11 0c0 6 2.5 8 2.5 8H4s2.5-2 2.5-8M10.2 21a2 2 0 0 0 3.6 0",
  chart: "M4 19.5h16M6.8 16.5V11M11 16.5V7M15.2 16.5v-6M19.4 16.5V5",
  spark: "M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9-1.9 4.9-1.9-4.9L5.2 10l4.9-1.9zM18.4 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  // The groups in the rail down the side of the gallery.
  "group-all": "M5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3A1.5 1.5 0 0 1 5.5 4M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3A1.5 1.5 0 0 1 18.5 10h-3A1.5 1.5 0 0 1 14 8.5v-3A1.5 1.5 0 0 1 15.5 4M5.5 14h3A1.5 1.5 0 0 1 10 15.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3A1.5 1.5 0 0 1 5.5 14M15.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5",
  "group-information": "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v5.5M12 7.6h.01",
  // The gallery's own furniture rather than a widget: the magnifying glass in the search box.
  "ui-search": "M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14M20.2 20.2 16.4 16.4",
  "group-utility": "M20.3 5.7a4.8 4.8 0 0 1-6.3 6.3l-7.4 7.4a2.3 2.3 0 0 1-3.2-3.2l7.4-7.4a4.8 4.8 0 0 1 6.3-6.3L14 5.6l1.2 3.2 3.2 1.2z",
  // Anything the catalogue names that is not drawn above: a plain card, which is still a block and not a circle.
  default: "M6.5 4h11A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4"
});
var markFor = (name) => MARKS2[name] ?? MARKS2.default;
function categoryMark(category) {
  const shared = { time: "clock", productivity: "check", browser: "tabs", orion: "spark" };
  return markFor(shared[category] ?? `group-${category}`);
}

// orbis-ui/newtab/widgets/miniature.ts
function drawMark(icon2, size) {
  return svg("svg", { class: "wg-mark", viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", focusable: "false" }, svg("path", { d: markFor(icon2) }));
}
var MARK = { least: 9, most: 26, share: 0.4 };
function drawMiniature(instances, options) {
  const shape = miniatureShape(instances, options);
  const picture = svg("svg", {
    class: "wg-mini",
    viewBox: `0 0 ${Math.round(shape.width)} ${Math.round(shape.height)}`,
    width: Math.round(shape.width),
    height: Math.round(shape.height),
    role: "img",
    "aria-label": options.label,
    focusable: "false"
  });
  const radius = Math.max(2, Math.min(8, shape.cell * 0.18));
  for (const block of shape.blocks) {
    const definition = widgetById(block.widget);
    picture.append(svg("rect", { class: "wg-mini-block", x: round3(block.x), y: round3(block.y), width: round3(block.w), height: round3(block.h), rx: round3(radius) }));
    const side = Math.max(MARK.least, Math.min(MARK.most, Math.min(block.w, block.h) * MARK.share));
    const scale = side / 24;
    picture.append(
      svg("g", {
        class: "wg-mini-mark",
        transform: `translate(${round3(block.x + block.w / 2 - side / 2)} ${round3(block.y + block.h / 2 - side / 2)}) scale(${round3(scale, 4)})`,
        "stroke-width": round3(1.75 / scale, 2)
      }, svg("path", { d: markFor(definition?.icon ?? "") }))
    );
  }
  return { element: picture, shape };
}
var round3 = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

// orbis-ui/newtab/widgets/settingsForm.ts
var forms = 0;
function createSettingsForm(options) {
  const { definition } = options;
  const wait = options.waitMs ?? 0;
  const mine = `wgset${forms++}`;
  let draft = clampDraft(definition, options.settings);
  let timer2 = null;
  const controls = /* @__PURE__ */ new Map();
  const send = () => {
    if (timer2 !== null) {
      clearTimeout(timer2);
      timer2 = null;
    }
    options.onChange(clampDraft(definition, draft));
  };
  const later = () => {
    if (timer2 !== null) clearTimeout(timer2);
    if (wait <= 0) return send();
    timer2 = setTimeout(() => {
      timer2 = null;
      options.onChange(clampDraft(definition, draft));
    }, wait);
  };
  const say = (text2) => options.announce?.(text2);
  const element = h("div", { class: "wg-form" });
  const fields = formFields(definition, draft);
  for (const field of fields) element.append(drawField(field));
  for (const spec of definition.settings) {
    if (spec.onCard) element.append(h("p", { class: "wg-note", text: `${spec.label} is typed on the widget itself.` }));
  }
  if (fields.length === 0) element.append(h("p", { class: "wg-form-none", text: `${definition.name} has nothing to set.` }));
  return {
    element,
    empty: fields.length === 0,
    flush: () => {
      if (timer2 !== null) send();
    },
    busy: () => timer2 !== null || document.activeElement instanceof HTMLElement && element.contains(document.activeElement) && isTyped(document.activeElement),
    set(settings) {
      draft = clampDraft(definition, settings);
      for (const [name, show] of controls) show(draft[name]);
    },
    destroy: () => {
      if (timer2 !== null) clearTimeout(timer2);
      timer2 = null;
    }
  };
  function drawField(field) {
    const id = `${mine}-${field.name}`;
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const hint = h("p", { class: "wg-form-hint", id: hintId });
    const error = h("p", { class: "wg-form-error", id: errorId, role: "alert" });
    const described = () => [hint.textContent ? hintId : "", error.textContent ? errorId : ""].filter(Boolean).join(" ");
    if (field.kind === "switch") {
      const input = h("input", { class: "wg-form-switch", type: "checkbox", id, role: "switch", checked: field.value });
      input.addEventListener("change", () => {
        draft[field.name] = input.checked;
        send();
        say(`${field.label} is ${input.checked ? "on" : "off"}.`);
      });
      controls.set(field.name, (value) => {
        input.checked = value === true;
      });
      return h("div", { class: "wg-form-row wg-form-row-switch" }, input, h("label", { class: "wg-form-label", for: id, text: field.label }));
    }
    if (field.kind === "number") {
      const spec = definition.settings.find((one) => one.name === field.name);
      const input = h("input", { class: "wg-form-input wg-form-number", type: "number", id, value: String(field.value), inputmode: "numeric", ...field.min === null ? {} : { min: field.min }, ...field.max === null ? {} : { max: field.max } });
      hint.textContent = field.range;
      input.setAttribute("aria-describedby", described());
      const read = () => {
        const reading = readNumber(spec, input.value);
        if (!reading.ok) {
          error.textContent = reading.error;
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", described());
          return;
        }
        error.textContent = "";
        input.removeAttribute("aria-invalid");
        hint.textContent = reading.note === "" ? field.range : `${field.range} ${reading.note}`.trim();
        input.setAttribute("aria-describedby", described());
        draft[field.name] = reading.value;
        later();
      };
      input.addEventListener("input", read);
      input.addEventListener("blur", () => {
        const reading = readNumber(spec, input.value);
        if (reading.ok && String(reading.value) !== input.value.trim()) input.value = String(reading.value);
        if (timer2 !== null) send();
      });
      const step = (by) => {
        const next = stepNumber(spec, Number(input.value), by);
        input.value = String(next);
        read();
        say(`${field.label} is ${next}.`);
      };
      controls.set(field.name, (value) => {
        input.value = String(value);
        error.textContent = "";
        input.removeAttribute("aria-invalid");
      });
      return h(
        "div",
        { class: "wg-form-row" },
        h("label", { class: "wg-form-label", for: id, text: field.label }),
        h(
          "div",
          { class: "wg-form-stepper" },
          button(`Fewer ${field.label.toLowerCase()}`, () => step(-1), "\xE2\u02C6\u2019", "wg-icon-btn wg-form-step"),
          input,
          button(`More ${field.label.toLowerCase()}`, () => step(1), "+", "wg-icon-btn wg-form-step")
        ),
        hint,
        error
      );
    }
    if (field.kind === "text") {
      const input = h("input", { class: "wg-form-input", type: "text", id, value: field.value, maxlength: field.maxLength, ...field.placeholder ? { placeholder: field.placeholder } : {} });
      hint.textContent = roomLeft(field.value.length, field.maxLength);
      input.setAttribute("aria-describedby", described());
      input.addEventListener("input", () => {
        draft[field.name] = input.value;
        hint.textContent = roomLeft(input.value.length, field.maxLength);
        input.setAttribute("aria-describedby", described());
        later();
      });
      input.addEventListener("blur", () => {
        if (timer2 !== null) send();
      });
      controls.set(field.name, (value) => {
        input.value = String(value);
        hint.textContent = roomLeft(input.value.length, field.maxLength);
      });
      return h("div", { class: "wg-form-row" }, h("label", { class: "wg-form-label", for: id, text: field.label }), input, hint, error);
    }
    if (field.kind === "select") {
      const picker = h("select", { class: "wg-form-select", id });
      for (const choice of field.choices) picker.append(h("option", { value: choice.value, text: choice.label }));
      picker.value = field.value;
      picker.addEventListener("change", () => {
        draft[field.name] = picker.value;
        send();
        say(`${field.label} is ${picker.options[picker.selectedIndex]?.text.toLowerCase() ?? picker.value}.`);
      });
      controls.set(field.name, (value) => {
        picker.value = String(value);
      });
      return h("div", { class: "wg-form-row" }, h("label", { class: "wg-form-label", for: id, text: field.label }), picker);
    }
    {
      const name = `${id}-pick`;
      const row2 = h("div", { class: "wg-form-seg", role: "radiogroup", "aria-label": field.label });
      const inputs = /* @__PURE__ */ new Map();
      for (const choice of field.choices) {
        const oneId = `${name}-${choice.value}`;
        const input = h("input", { class: "wg-form-seg-input", type: "radio", name, id: oneId, value: choice.value, checked: choice.value === field.value });
        input.addEventListener("change", () => {
          if (!input.checked) return;
          draft[field.name] = choice.value;
          send();
          say(`${field.label} is ${choice.label.toLowerCase()}.`);
        });
        inputs.set(choice.value, input);
        row2.append(input, h("label", { class: "wg-form-seg-one", for: oneId, text: choice.label }));
      }
      controls.set(field.name, (value) => {
        const input = inputs.get(String(value));
        if (input) input.checked = true;
      });
      return h("div", { class: "wg-form-row" }, h("span", { class: "wg-form-label", id: `${id}-name`, text: field.label }), row2);
    }
  }
}
var isTyped = (node) => node instanceof HTMLInputElement && (node.type === "text" || node.type === "number");

// orbis-ui/newtab/widgets/sizePicker.ts
function createSizePicker(options) {
  const chosen = /* @__PURE__ */ new Map();
  const group = h("div", { class: "wg-sizes", role: "radiogroup" });
  for (const size of options.sizes) {
    const id = `${options.name}-${size}`;
    const input = h("input", { class: "wg-sizes-input", type: "radio", name: options.name, id, value: size, checked: size === options.value, "aria-label": sizeSpoken(size) });
    input.addEventListener("change", () => {
      if (input.checked) options.onPick(size);
    });
    chosen.set(size, input);
    group.append(
      input,
      h(
        "label",
        { class: "wg-sizes-one", for: id },
        drawSizeGlyph(size),
        h("span", { class: "wg-sizes-name", text: SIZE_NAMES[size] }),
        h("span", { class: "wg-sizes-cells", text: sizeMeasure(size) })
      )
    );
  }
  const element = h("fieldset", { class: "wg-sizes-set" }, h("legend", { class: "wg-label", text: options.legend }), group);
  return {
    element,
    set(size) {
      const input = chosen.get(size);
      if (input) input.checked = true;
    }
  };
}
function drawSizeGlyph(size, cell = 9, gap = 2.5) {
  const { columns, rows, w, h: tall } = sizeGlyph(size);
  const width = columns * cell + (columns - 1) * gap;
  const height = rows * cell + (rows - 1) * gap;
  const picture = svg("svg", { class: "wg-sizes-glyph", viewBox: `0 0 ${width} ${height}`, width, height, "aria-hidden": "true", focusable: "false" });
  for (let row2 = 0; row2 < rows; row2++) {
    for (let column = 0; column < columns; column++) {
      picture.append(svg("rect", {
        class: row2 < tall && column < w ? "wg-sizes-on" : "wg-sizes-off",
        x: column * (cell + gap),
        y: row2 * (cell + gap),
        width: cell,
        height: cell,
        rx: 2
      }));
    }
  }
  return picture;
}

// orbis-ui/newtab/widgets/detail.ts
function showWidgetDetail(host, widget, deps) {
  const definition = widgetById(widget);
  const back = () => deps.go({ view: "home" });
  if (!definition) {
    host.replaceChildren(h(
      "div",
      { class: "wg-detail wg-detail-lost" },
      h(
        "div",
        { class: "wg-state" },
        h("p", { class: "wg-big", text: "No such widget" }),
        h("p", { text: `Orbis has nothing called "${widget.slice(0, 40)}".` }),
        button("Back to all widgets", back, "Back to all widgets", "wg-btn primary")
      )
    ));
    return () => host.replaceChildren();
  }
  const offer = offerWidget(definition, Object.keys(RENDERERS));
  let size = definition.defaultSize;
  let draft = defaultSettings(definition);
  let card = null;
  let stop = null;
  const name = h("h2", { class: "wg-detail-name", tabindex: "-1", text: definition.name });
  const floor = h("div", { class: "wg-stage-floor" });
  const scaleNote = h("p", { class: "wg-stage-note" });
  const stage = h("section", { class: "wg-stage", "aria-label": `${definition.name}, drawn as it would look` }, floor, scaleNote);
  const mine = h("div", { class: "wg-detail-mine" });
  const doing = h("div", { class: "wg-detail-do" });
  const side = h("div", { class: "wg-detail-side" });
  const element = h(
    "div",
    { class: "wg-detail" },
    h("div", { class: "wg-detail-bar" }, button("Back to all widgets", back, ["\u2190 ", "All widgets"], "wg-btn wg-detail-back")),
    h(
      "header",
      { class: "wg-detail-head" },
      h("div", { class: "wg-detail-title" }, drawMark(definition.icon, 26), name),
      h("p", { class: "wg-detail-group" }, h("span", { class: "wg-chip", text: CATEGORY_NAMES[definition.category] })),
      h("p", { class: "wg-detail-say", text: definition.description })
    ),
    h("div", { class: "wg-detail-body" }, stage, side)
  );
  host.replaceChildren(element);
  function drawPreview() {
    if (!offer.ok) {
      floor.replaceChildren(h("div", { class: "wg-state" }, h("p", { text: offer.reason })));
      scaleNote.textContent = "";
      return;
    }
    const instance = previewInstance(definition, size, draft);
    if (!card) {
      card = createCard({ instance, preview: true, link: deps.link, hour12: deps.hour12() });
      floor.replaceChildren(h("div", { class: "wg-stage-shrink" }, h("div", { class: "wg-stage-real" }, card.element)));
    } else {
      card.update(instance, size);
    }
    layout();
  }
  function layout() {
    const shrink = floor.querySelector(".wg-stage-shrink");
    const real = floor.querySelector(".wg-stage-real");
    if (!(shrink instanceof HTMLElement) || !(real instanceof HTMLElement)) return;
    const room = floor.getBoundingClientRect();
    const fit = stageFit(size, room.width || 640, room.height || 380);
    real.style.width = `${fit.width}px`;
    real.style.height = `${fit.height}px`;
    real.style.transform = `scale(${fit.scale})`;
    shrink.style.width = `${Math.round(fit.width * fit.scale)}px`;
    shrink.style.height = `${Math.round(fit.height * fit.scale)}px`;
    scaleNote.textContent = `${SIZE_NAMES[size]} \xB7 ${scaleWords(fit.scale).toLowerCase()}`;
  }
  const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout()) : null;
  watcher?.observe(floor);
  const picker = createSizePicker({
    sizes: definition.sizes,
    value: size,
    name: `wg-detail-size-${definition.id}`,
    legend: "Size",
    onPick: (picked) => {
      size = picked;
      drawPreview();
    }
  });
  if (definition.sizes.length > 1) side.append(picker.element);
  const said3 = h("p", { class: "wg-detail-said", role: "status", "aria-live": "polite" });
  const form = createSettingsForm({
    definition,
    settings: draft,
    waitMs: 150,
    announce: (text2) => {
      said3.textContent = text2;
    },
    onChange: (settings) => {
      draft = settings;
      drawPreview();
    }
  });
  if (!form.empty) {
    side.append(h(
      "section",
      { class: "wg-detail-try" },
      h("p", { class: "wg-label", text: "Try the settings" }),
      h("p", { class: "wg-note", text: "Changed here, nothing is saved. Adding it keeps what you tried." }),
      form.element,
      said3
    ));
  }
  const add2 = h("button", { class: "wg-btn primary wg-detail-add", type: "button", text: "Add to start page" });
  add2.addEventListener("click", () => {
    add2.disabled = true;
    void deps.link.act({ type: "add", widget: definition.id, size, settings: draft }).then((reply) => {
      add2.disabled = false;
      if (!reply.ok) return deps.say(reply.message);
      deps.say(`${definition.name} added`, { label: "Undo", press: () => void deps.link.act({ type: "undo" }) });
    });
  });
  const star = h("button", { class: "wg-btn wg-detail-star", type: "button", "aria-pressed": "false" });
  star.addEventListener("click", () => {
    const board = deps.link.state()?.board;
    const on = board ? !board.favourites.includes(definition.id) : true;
    star.disabled = true;
    void deps.link.act({ type: "favourite", widget: definition.id, on }).then((reply) => {
      star.disabled = false;
      deps.say(reply.ok ? reply.said : reply.message);
    });
  });
  doing.append(offer.ok ? add2 : h("p", { class: "wg-detail-no", text: offer.reason }), star);
  side.append(doing, mine);
  const facts = h("dl", { class: "wg-facts" });
  const fact = (label, lines) => {
    if (lines.length === 0) return;
    facts.append(h("dt", { class: "wg-label", text: label }), h("dd", {}, ...lines.map((line) => h("p", { text: line }))));
  };
  fact("What it shows", definition.sources);
  fact("What it can read", permissionsOf(definition));
  fact("Connection", [networkWords(definition)]);
  fact("How often it looks again", [`It looks again ${refreshWords(definition.refreshMs)}.`]);
  fact("Made by", [definition.author]);
  side.append(facts);
  if (definition.tags.length > 0) {
    const tags = h("div", { class: "wg-detail-tags" }, h("p", { class: "wg-label", text: "Also found by" }));
    for (const tag of definition.tags) {
      tags.append(button(`Search the gallery for ${tag}`, () => deps.go({ view: "home", query: tag }), tag, "wg-chip wg-detail-tag"));
    }
    side.append(tags);
  }
  function showBoard(board, connected) {
    const marked = board ? board.favourites.includes(definition.id) : false;
    star.textContent = marked ? "\u2605 Favourite" : "\u2606 Make a favourite";
    star.setAttribute("aria-pressed", marked ? "true" : "false");
    star.disabled = !connected || board === null;
    add2.disabled = !connected || board === null;
    if (!connected) add2.title = "Orbis is not answering yet.";
    else add2.removeAttribute("title");
    mine.replaceChildren();
    if (!board) return;
    const here = orderedWidgets(board.instances).filter((one) => one.widget === definition.id);
    if (here.length === 0) {
      add2.textContent = "Add to start page";
      return;
    }
    add2.textContent = "Add another";
    mine.append(h("p", { class: "wg-label", text: here.length === 1 ? "1 on the start page" : `${here.length} on the start page` }));
    const list = h("ul", { class: "wg-list wg-detail-list" });
    for (const [at2, one] of here.entries()) {
      const row2 = h("li", { class: "wg-row" });
      row2.append(
        button(`Set up ${definition.name}, ${placeWords(one, at2)}`, () => deps.go({ view: "instance", id: one.id }), [placeWords(one, at2), one.hidden ? " \xB7 hidden" : ""], "wg-btn wg-row-main"),
        button(`Take this ${definition.name} off the start page`, () => {
          void deps.link.act({ type: "remove", id: one.id }).then((reply) => {
            deps.say(reply.ok ? reply.said : reply.message, reply.ok ? { label: "Undo", press: () => void deps.link.act({ type: "undo" }) } : void 0);
          });
        }, h("span", { "aria-hidden": "true", text: "\u2715" }), "wg-icon-btn")
      );
      list.append(row2);
    }
    mine.append(list);
  }
  stop = deps.link.subscribe((state, connected) => showBoard(state?.board ?? null, connected));
  drawPreview();
  name.focus();
  return () => {
    stop?.();
    stop = null;
    watcher?.disconnect();
    form.destroy();
    card?.destroy();
    card = null;
    host.replaceChildren();
  };
}

// orbis-ui/newtab/widgets/studio.ts
var DENSITY = Object.freeze([
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" }
]);
function showStudio(host, instanceId, deps) {
  let teardown = null;
  let waiting = null;
  let settled = false;
  const found = () => deps.link.state()?.board.instances.find((one) => one.id === instanceId) ?? null;
  const start = (one) => {
    teardown = build(host, one, instanceId, deps);
  };
  const first = found();
  if (first) {
    settled = true;
    start(first);
  } else {
    host.replaceChildren(h("div", { class: "wg-studio wg-studio-lost" }, h("div", { class: "wg-state" }, h("p", { class: "wg-skeleton" }), h("p", { class: "wg-note", text: "Asking Orbis about this widget\u2026" }))));
    const listener = (state) => {
      if (settled || !state) return;
      settled = true;
      const one = state.board.instances.find((other) => other.id === instanceId) ?? null;
      if (one) start(one);
      else lost(host, deps);
      waiting?.();
      waiting = null;
    };
    waiting = deps.link.subscribe(listener);
    if (settled) {
      waiting();
      waiting = null;
    }
  }
  return () => {
    settled = true;
    waiting?.();
    waiting = null;
    teardown?.();
    teardown = null;
    host.replaceChildren();
  };
}
function lost(host, deps) {
  host.replaceChildren(h(
    "div",
    { class: "wg-studio wg-studio-lost" },
    h(
      "div",
      { class: "wg-state" },
      h("p", { class: "wg-big", text: "It is not there" }),
      h("p", { text: "That widget is no longer on the start page." }),
      button("Back to all widgets", () => deps.go({ view: "home" }), "Back to all widgets", "wg-btn primary")
    )
  ));
}
function build(host, first, instanceId, deps) {
  const definition = widgetById(first.widget);
  if (!definition) {
    lost(host, deps);
    return () => host.replaceChildren();
  }
  let current = first;
  let card = null;
  let form = null;
  let watcher = null;
  let stop = null;
  let removed = false;
  const back = () => deps.go({ view: "home" });
  const ask = async (request, undoable = true) => {
    const reply = await deps.link.act(request);
    if (!reply.ok) deps.say(reply.message);
    else if (reply.said !== "") deps.say(reply.said, undoable && !reply.already ? { label: "Undo", press: () => void deps.link.act({ type: "undo" }) } : void 0);
    return reply;
  };
  const name = h("h2", { class: "wg-studio-name", tabindex: "-1", text: definition.name });
  const where = h("p", { class: "wg-studio-where" });
  const floor = h("div", { class: "wg-stage-floor" });
  const scaleNote = h("p", { class: "wg-stage-note" });
  const controls = h("div", { class: "wg-studio-controls" });
  const element = h(
    "div",
    { class: "wg-studio" },
    h("div", { class: "wg-studio-bar" }, button("Back to all widgets", back, ["\u2190 ", "All widgets"], "wg-btn wg-studio-back")),
    h(
      "header",
      { class: "wg-studio-head" },
      h("div", { class: "wg-studio-title" }, drawMark(definition.icon, 24), name),
      where
    ),
    h(
      "div",
      { class: "wg-studio-body" },
      h(
        "section",
        { class: "wg-stage wg-studio-live", "aria-label": `${definition.name} as it is on your start page` },
        floor,
        scaleNote,
        h("p", { class: "wg-note", text: "This is the one on your start page, with your own things in it. Every change below happens there at once." })
      ),
      controls
    )
  );
  host.replaceChildren(element);
  card = createCard({
    instance: first,
    preview: false,
    link: deps.link,
    hour12: deps.hour12(),
    onSettings: () => {
      const firstControl = form?.element.querySelector("input, select, textarea");
      if (firstControl instanceof HTMLElement) firstControl.focus();
    }
  });
  floor.replaceChildren(h("div", { class: "wg-stage-shrink" }, h("div", { class: "wg-stage-real" }, card.element)));
  function layout(size) {
    const shrink = floor.querySelector(".wg-stage-shrink");
    const real = floor.querySelector(".wg-stage-real");
    if (!(shrink instanceof HTMLElement) || !(real instanceof HTMLElement)) return;
    const room = floor.getBoundingClientRect();
    const fit = stageFit(size, room.width || 520, room.height || 340);
    real.style.width = `${fit.width}px`;
    real.style.height = `${fit.height}px`;
    real.style.transform = `scale(${fit.scale})`;
    shrink.style.width = `${Math.round(fit.width * fit.scale)}px`;
    shrink.style.height = `${Math.round(fit.height * fit.scale)}px`;
    scaleNote.textContent = `${SIZE_NAMES[size]} \xB7 ${scaleWords(fit.scale).toLowerCase()}`;
  }
  layout(first.size);
  watcher = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout(current.size)) : null;
  watcher?.observe(floor);
  form = createSettingsForm({
    definition,
    settings: first.settings,
    waitMs: 300,
    onChange: (settings) => {
      const changed = diffDraft(definition, current.settings, settings);
      if (Object.keys(changed).length === 0) return;
      void ask({ type: "configure", id: instanceId, settings: changed });
    }
  });
  controls.append(section("Settings", form.element));
  const picker = createSizePicker({
    sizes: definition.sizes,
    value: first.size,
    name: `wg-studio-size-${instanceId}`,
    legend: "Size",
    onPick: (size) => void ask({ type: "resize", id: instanceId, size })
  });
  if (definition.sizes.length > 1) controls.append(section("Size", picker.element, "How much of the page it takes."));
  const toneInputs = /* @__PURE__ */ new Map();
  const tones = h("div", { class: "wg-tones", role: "radiogroup", "aria-label": "Card" });
  for (const tone of LOOK_TONES) {
    const id = `wg-tone-${instanceId}-${tone}`;
    const input = h("input", { class: "wg-tones-input", type: "radio", name: `wg-tone-${instanceId}`, id, value: tone, checked: tone === first.look.tone, "aria-label": TONE_NAMES[tone] });
    input.addEventListener("change", () => {
      if (input.checked) void ask({ type: "look", id: instanceId, look: { tone } });
    });
    toneInputs.set(tone, input);
    tones.append(input, h("label", { class: "wg-tones-one", for: id, "data-tone": tone }, drawToneSwatch(), h("span", { class: "wg-tones-name", text: TONE_NAMES[tone] })));
  }
  const densityInputs = /* @__PURE__ */ new Map();
  const densities = h("div", { class: "wg-form-seg", role: "radiogroup", "aria-label": "Spacing" });
  for (const one of DENSITY) {
    const id = `wg-density-${instanceId}-${one.value}`;
    const input = h("input", { class: "wg-form-seg-input", type: "radio", name: `wg-density-${instanceId}`, id, value: one.value, checked: one.value === first.look.density });
    input.addEventListener("change", () => {
      if (input.checked) void ask({ type: "look", id: instanceId, look: { density: one.value } });
    });
    densityInputs.set(one.value, input);
    densities.append(input, h("label", { class: "wg-form-seg-one", for: id, text: one.label }));
  }
  controls.append(section("Look", h("div", { class: "wg-studio-look" }, tones, h("div", { class: "wg-form-row" }, h("span", { class: "wg-form-label", text: "Spacing" }), densities))));
  const lock = switchRow(`wg-lock-${instanceId}`, "Keep it where it is", "While this is on it cannot be moved or taken off.", (on) => void ask({ type: "lock", id: instanceId, locked: on }));
  const hide = switchRow(`wg-hide-${instanceId}`, "Hide it for now", "It is kept with its settings, but is not drawn on the start page.", (on) => void ask({ type: "hide", id: instanceId, hidden: on }));
  lock.input.checked = first.locked;
  hide.input.checked = first.hidden;
  controls.append(section("Keeping it", h("div", { class: "wg-studio-switches" }, lock.element, hide.element)));
  const reset = h("button", { class: "wg-btn", type: "button", text: "Back to how it comes" });
  reset.addEventListener("click", () => {
    form?.flush();
    void ask({ type: "reset", id: instanceId });
  });
  const removeRow = h("div", { class: "wg-studio-remove" });
  function drawRemove() {
    const open2 = h("button", { class: "wg-btn wg-studio-danger", type: "button", text: "Remove from start page" });
    open2.addEventListener("click", () => {
      const yes = h("button", { class: "wg-btn wg-studio-danger", type: "button", text: "Yes, take it off" });
      const no = h("button", { class: "wg-btn", type: "button", text: "Keep it" });
      yes.addEventListener("click", () => {
        yes.disabled = true;
        no.disabled = true;
        void deps.link.act({ type: "remove", id: instanceId }).then((reply) => {
          if (!reply.ok) {
            yes.disabled = false;
            no.disabled = false;
            return deps.say(reply.message);
          }
          removed = true;
          deps.say(reply.said, { label: "Undo", press: () => void deps.link.act({ type: "undo" }) });
          back();
        });
      });
      no.addEventListener("click", () => {
        drawRemove();
        const again = removeRow.querySelector("button");
        if (again instanceof HTMLElement) again.focus();
      });
      removeRow.replaceChildren(
        h("p", { class: "wg-note", text: `Take ${definition.name} off the start page? Its settings go with it, and Undo brings it back.` }),
        h("div", { class: "wg-row" }, yes, no)
      );
      yes.focus();
    });
    removeRow.replaceChildren(open2);
  }
  drawRemove();
  controls.append(section("Starting over", h("div", { class: "wg-studio-end" }, reset, removeRow)));
  function showInstance(one) {
    if (!one) {
      if (!removed) lost(host, deps);
      return;
    }
    current = one;
    const at2 = orderedWidgets(deps.link.state()?.board.instances ?? []).findIndex((other) => other.id === one.id);
    where.textContent = `On your start page \xB7 ${placeWords(one, Math.max(0, at2))}${isAsItComes(definition, one.settings) ? "" : " \xB7 changed"}`;
    card?.update(one);
    layout(one.size);
    picker.set(one.size);
    const tone = toneInputs.get(one.look.tone);
    if (tone) tone.checked = true;
    const density = densityInputs.get(one.look.density);
    if (density) density.checked = true;
    if (document.activeElement !== lock.input) lock.input.checked = one.locked;
    if (document.activeElement !== hide.input) hide.input.checked = one.hidden;
    if (form && !form.busy()) form.set(one.settings);
  }
  stop = deps.link.subscribe(() => showInstance(deps.link.state()?.board.instances.find((one) => one.id === instanceId) ?? null));
  showInstance(first);
  name.focus();
  const onKey = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
    if (event.target instanceof HTMLInputElement && (event.target.type === "text" || event.target.type === "number")) return;
    event.preventDefault();
    form?.flush();
    void ask({ type: "undo" }, false);
  };
  element.addEventListener("keydown", onKey);
  return () => {
    form?.flush();
    element.removeEventListener("keydown", onKey);
    stop?.();
    stop = null;
    watcher?.disconnect();
    watcher = null;
    form?.destroy();
    form = null;
    card?.destroy();
    card = null;
    host.replaceChildren();
  };
}
function section(title, body, note) {
  return h(
    "section",
    { class: "wg-studio-part" },
    h("h3", { class: "wg-label wg-studio-part-title", text: title }),
    note ? h("p", { class: "wg-note", text: note }) : null,
    body
  );
}
function switchRow(id, label, note, onChange) {
  const hintId = `${id}-hint`;
  const input = h("input", { class: "wg-form-switch", type: "checkbox", id, role: "switch", "aria-describedby": hintId });
  input.addEventListener("change", () => onChange(input.checked));
  return {
    input,
    element: h(
      "div",
      { class: "wg-form-row wg-form-row-switch wg-studio-switch" },
      input,
      h("label", { class: "wg-form-label", for: id, text: label }),
      h("p", { class: "wg-form-hint", id: hintId, text: note })
    )
  };
}
function drawToneSwatch() {
  return svg(
    "svg",
    { class: "wg-tones-swatch", viewBox: "0 0 44 30", width: 44, height: 30, "aria-hidden": "true", focusable: "false" },
    svg("rect", { class: "wg-tones-card", x: 1, y: 1, width: 42, height: 28, rx: 7 }),
    svg("rect", { class: "wg-tones-line", x: 8, y: 10, width: 20, height: 3, rx: 1.5 }),
    svg("rect", { class: "wg-tones-line wg-tones-line-2", x: 8, y: 17, width: 13, height: 3, rx: 1.5 })
  );
}

// orbis-ui/newtab/widgets/tile.ts
var STAGE = { plain: { width: 182, height: 150 }, hero: { width: 300, height: 190 } };
function createTile(options) {
  const { definition, deps } = options;
  const stage = h("div", { class: "wg-tile-stage", "aria-hidden": "true" }, h("div", { class: "wg-skeleton wg-tile-wait" }));
  let card = null;
  let busy = false;
  const open2 = h("button", { class: "wg-tile-open", type: "button" }, h("span", { class: "wg-tile-name", text: definition.name }));
  open2.addEventListener("click", () => deps.go({ view: "widget", widget: definition.id }));
  const star = h(
    "button",
    { class: "wg-icon-btn wg-tile-star", type: "button", "aria-pressed": "false", "aria-label": `Make ${definition.name} a favourite` },
    h("span", { class: "wg-tile-star-mark", "aria-hidden": "true", text: "\u2605" })
  );
  star.addEventListener("click", favourite);
  const plus = h(
    "button",
    { class: "wg-icon-btn wg-tile-add", type: "button", "aria-label": `Add ${definition.name} to the start page` },
    h("span", { "aria-hidden": "true", text: "+" })
  );
  plus.addEventListener("click", add2);
  const badges = h("div", { class: "wg-tile-badges" });
  const element = h(
    "article",
    { class: "wg-tile", "data-widget": definition.id, "data-size": definition.defaultSize, ...options.hero ? { "data-hero": "true" } : {} },
    stage,
    h(
      "div",
      { class: "wg-tile-meta" },
      h("h3", { class: "wg-tile-head" }, open2),
      h("p", { class: "wg-tile-say", text: definition.description }),
      badges
    ),
    h("div", { class: "wg-tile-acts" }, star, plus)
  );
  refresh();
  function refresh() {
    const board = options.board();
    const connected = deps.link.connected();
    const marked = board ? board.favourites.includes(definition.id) : false;
    star.setAttribute("aria-pressed", marked ? "true" : "false");
    star.setAttribute("aria-label", marked ? `${definition.name} is a favourite` : `Make ${definition.name} a favourite`);
    star.toggleAttribute("data-on", marked);
    const stuck = !connected || board === null;
    star.disabled = stuck || busy;
    plus.disabled = stuck || busy;
    plus.title = stuck ? "Orbis is not answering yet." : `Add ${definition.name} to the start page`;
    badges.replaceChildren();
    if (!board) return;
    for (const badge of tileBadges(definition, board)) badges.append(h("span", { class: "wg-chip wg-tile-badge", "data-tone": badge.tone, text: badge.text }));
  }
  function add2() {
    if (plus.disabled) return;
    busy = true;
    refresh();
    void deps.link.act({ type: "add", widget: definition.id }).then((reply) => {
      busy = false;
      refresh();
      if (!reply.ok) return deps.say(reply.message);
      if (reply.already) return deps.say(reply.said);
      deps.say(`${definition.name} added`, { label: "Undo", press: () => void deps.link.act({ type: "undo" }) });
    });
  }
  function favourite() {
    if (star.disabled) return;
    const board = options.board();
    const on = board ? !board.favourites.includes(definition.id) : true;
    busy = true;
    refresh();
    void deps.link.act({ type: "favourite", widget: definition.id, on }).then((reply) => {
      busy = false;
      refresh();
      deps.say(reply.ok ? reply.said : reply.message);
    });
  }
  return {
    element,
    widget: definition.id,
    handle: open2,
    add: add2,
    favourite,
    refresh,
    build() {
      if (card) return;
      const room = stage.getBoundingClientRect();
      const box = { width: room.width || (options.hero ? STAGE.hero.width : STAGE.plain.width), height: room.height || (options.hero ? STAGE.hero.height : STAGE.plain.height) };
      const fit = tileFit(definition.defaultSize, box);
      card = createCard({
        instance: previewInstance(definition, definition.defaultSize, defaultSettings(definition)),
        preview: true,
        link: deps.link,
        hour12: deps.hour12()
      });
      const real = h("div", { class: "wg-tile-real", style: { width: `${fit.width}px`, height: `${fit.height}px`, transform: `scale(${fit.scale})` } }, card.element);
      stage.replaceChildren(h("div", { class: "wg-tile-shrink", style: { width: `${fit.boxWidth}px`, height: `${fit.boxHeight}px` } }, real));
    },
    idle() {
      if (!card) return;
      card.destroy();
      card = null;
      stage.replaceChildren(h("div", { class: "wg-skeleton wg-tile-wait" }));
    },
    destroy() {
      card?.destroy();
      card = null;
      element.remove();
    }
  };
}

// orbis-ui/newtab/widgets/gallery.ts
var WAIT_TO_SEARCH = 220;
var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function mountGallery(host, deps) {
  const drawable = Object.keys(RENDERERS);
  let route = { view: "closed" };
  let lastHome = { view: "home" };
  let state = null;
  let connected = false;
  let shell = null;
  let page = null;
  let cameFrom = null;
  let typing2 = null;
  let shape = "";
  const tiles = /* @__PURE__ */ new Map();
  const byElement = /* @__PURE__ */ new Map();
  let seeing = null;
  const board = () => state?.board ?? emptyBoard();
  const stop = deps.link.subscribe((next, up) => {
    state = next;
    connected = up;
    if (!shell || route.view === "closed") return;
    const now = signature(state, connected);
    if (now === shape) {
      for (const tile of tiles.values()) tile.refresh();
      return;
    }
    shape = now;
    draw();
  });
  function ensure() {
    if (shell) return shell;
    host.classList.add("wg-gallery");
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    host.setAttribute("aria-label", "Widgets");
    const search = h("input", { class: "wg-gal-search-input", type: "search", "aria-label": "Search widgets", placeholder: "Search widgets", autocomplete: "off", spellcheck: false });
    const clear2 = h("button", { class: "wg-icon-btn wg-gal-search-clear", type: "button", "aria-label": "Clear the search" }, h("span", { "aria-hidden": "true", text: "\u2715" }));
    search.addEventListener("input", () => {
      if (typing2 !== null) clearTimeout(typing2);
      typing2 = setTimeout(() => {
        typing2 = null;
        goHome({ query: search.value.trim() });
      }, WAIT_TO_SEARCH);
    });
    clear2.addEventListener("click", () => {
      search.value = "";
      goHome({ query: "" });
      search.focus();
    });
    const banners = h("div", { class: "wg-gal-banners" });
    const rail = h("nav", { class: "wg-gal-rail", "aria-label": "Groups of widgets" });
    const chips = h("div", { class: "wg-gal-chips", role: "group", "aria-label": "Which widgets to show" });
    const body = h("div", { class: "wg-gal-body" });
    const count = h("p", { class: "wg-gal-count", role: "status", "aria-live": "polite" });
    const home = h(
      "div",
      { class: "wg-gal-home" },
      h(
        "header",
        { class: "wg-gal-head" },
        h(
          "div",
          { class: "wg-gal-head-top" },
          h("h1", { class: "wg-gal-title", tabindex: "-1", text: "Widgets" }),
          button("Done, close the widgets", () => deps.go({ view: "closed" }), "Done", "wg-btn primary wg-gal-done")
        ),
        h(
          "div",
          { class: "wg-gal-find" },
          h("div", { class: "wg-gal-search" }, drawMark("ui-search", 18), search, clear2),
          chips
        ),
        rail
      ),
      banners,
      count,
      body,
      h("p", { class: "wg-gal-hint", text: "Arrow keys move between widgets. Enter opens one, A adds it, F makes it a favourite. Escape goes back." })
    );
    const pageHost = h("div", { class: "wg-gal-page" });
    host.replaceChildren(home, pageHost);
    for (const group of [{ id: "all", name: "All", count: 0 }, ...galleryCategories()]) {
      const one = h(
        "button",
        { class: "wg-gal-rail-one", type: "button", "data-group": group.id, "aria-pressed": "false" },
        svg("svg", { class: "wg-mark", viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", focusable: "false" }, svg("path", { d: categoryMark(group.id) })),
        h("span", { class: "wg-gal-rail-name", text: group.name }),
        group.count > 0 ? h("span", { class: "wg-gal-rail-count", text: String(group.count) }) : null
      );
      one.addEventListener("click", () => goHome({ category: group.id === "all" ? "" : group.id }));
      rail.append(one);
    }
    for (const filter of GALLERY_FILTERS) {
      const chip = h("button", { class: "wg-chip wg-gal-chip", type: "button", "data-filter": filter.id, "aria-pressed": "false", text: filter.label });
      chip.addEventListener("click", () => goHome({ filter: filter.id === "all" ? "" : filter.id }));
      chips.append(chip);
    }
    host.addEventListener("keydown", onKey);
    seeing = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const tile = byElement.get(entry.target);
        if (!tile) continue;
        if (entry.isIntersecting) tile.build();
        else tile.idle();
      }
    }, { root: null, rootMargin: "400px 0px" }) : null;
    shell = { home, body, banners, rail, chips, search, clear: clear2, pageHost, count };
    return shell;
  }
  function goHome(change) {
    const was = route.view === "home" ? route : lastHome;
    const query = change.query ?? was.query ?? "";
    const category = change.category ?? was.category ?? "";
    const filter = change.filter ?? was.filter ?? "";
    deps.go({ view: "home", ...query ? { query } : {}, ...category ? { category } : {}, ...filter ? { filter } : {} });
  }
  function show(next) {
    const was = route;
    route = next;
    if (next.view === "closed") {
      close();
      return;
    }
    const parts = ensure();
    if (was.view === "closed") {
      cameFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      host.removeAttribute("hidden");
      host.classList.add("wg-gallery-open");
      shape = signature(state, connected);
    }
    if (next.view === "home") {
      lastHome = next;
      page?.();
      page = null;
      parts.pageHost.replaceChildren();
      parts.pageHost.hidden = true;
      parts.home.hidden = false;
      draw();
      if (was.view === "closed") parts.search.focus();
      return;
    }
    parts.home.hidden = true;
    parts.pageHost.hidden = false;
    if (nameOf(was) === nameOf(next)) return;
    page?.();
    page = next.view === "widget" ? showWidgetDetail(parts.pageHost, next.widget, deps) : showStudio(parts.pageHost, next.id, deps);
  }
  function close() {
    page?.();
    page = null;
    if (typing2 !== null) clearTimeout(typing2);
    typing2 = null;
    for (const tile of tiles.values()) tile.destroy();
    tiles.clear();
    byElement.clear();
    if (shell) {
      shell.body.replaceChildren();
      shell.pageHost.replaceChildren();
    }
    host.setAttribute("hidden", "");
    host.classList.remove("wg-gallery-open");
    cameFrom?.focus();
    cameFrom = null;
  }
  function draw() {
    const parts = ensure();
    if (route.view !== "home") return;
    const asked = queryOf(route);
    const here = board();
    if (!parts.search.matches(":focus") && parts.search.value !== (asked.query ?? "")) parts.search.value = asked.query ?? "";
    parts.clear.hidden = parts.search.value === "";
    for (const one of parts.rail.children) {
      if (one instanceof HTMLElement) one.setAttribute("aria-pressed", one.dataset.group === (asked.category === "all" ? "all" : asked.category) ? "true" : "false");
    }
    for (const one of parts.chips.children) {
      if (one instanceof HTMLElement) one.setAttribute("aria-pressed", one.dataset.filter === asked.filter ? "true" : "false");
    }
    drawBanners(parts.banners, here);
    const wanted = /* @__PURE__ */ new Set();
    const body = h("div", { class: "wg-gal-sections" });
    if (isBrowsing(route)) {
      const found = findWidgets(asked, here);
      const ready = found.filter((one) => offerWidget(one, drawable).ok);
      const notYet = found.filter((one) => !offerWidget(one, drawable).ok);
      parts.count.textContent = `${foundWords(ready.length)}${notYet.length > 0 ? `, and ${notYet.length} that cannot be added yet` : ""}`;
      if (found.length === 0) body.append(drawNothing(asked.query ?? ""));
      else {
        if (ready.length > 0) body.append(drawGrid("results", ready.map((one) => one.id), false, wanted));
        if (notYet.length > 0) body.append(drawSection({ id: "missing", key: "results-missing", title: "Not available yet", widgets: [], missing: notYet.map((one) => ({ widget: one.id, reason: reasonFor(one) })) }, here, wanted));
      }
    } else {
      parts.count.textContent = "";
      for (const section2 of homeSections({ board: here, layouts: state?.layouts ?? [], drawable })) body.append(drawSection(section2, here, wanted));
    }
    for (const [key, tile] of [...tiles]) {
      if (wanted.has(key)) continue;
      byElement.delete(tile.element);
      seeing?.unobserve(tile.element);
      tile.destroy();
      tiles.delete(key);
    }
    parts.body.replaceChildren(body);
  }
  function drawBanners(into, here) {
    into.replaceChildren();
    if (!connected) {
      into.append(h(
        "div",
        { class: "wg-gal-banner", role: "status" },
        h("p", { class: "wg-gal-banner-say", text: "Orbis is not answering, so nothing can be added yet. What is shown below is still what each widget looks like." })
      ));
    }
    if (state && !here.enabled) {
      const show2 = h("button", { class: "wg-btn primary", type: "button", text: "Show widgets on the start page" });
      show2.addEventListener("click", () => {
        show2.disabled = true;
        void deps.link.act({ type: "enable", on: true }).then((reply) => {
          show2.disabled = false;
          deps.say(reply.ok ? reply.said : reply.message);
        });
      });
      into.append(h(
        "div",
        { class: "wg-gal-banner", "data-tone": "warn" },
        h("p", { class: "wg-gal-banner-say", text: "Widgets are switched off on the start page. They are all still here." }),
        show2
      ));
    }
  }
  function drawNothing(query) {
    const block = h(
      "div",
      { class: "wg-state wg-gal-nothing" },
      h("p", { class: "wg-big", text: "Nothing found" }),
      h("p", { text: query === "" ? "No widget matches what you chose." : `No widget matches "${query}".` })
    );
    const tries = h("div", { class: "wg-row wg-gal-tries" });
    for (const word of searchSuggestions(5)) {
      tries.append(button(`Search for ${word}`, () => goHome({ query: word, category: "", filter: "" }), word, "wg-chip"));
    }
    block.append(button("Start again", () => goHome({ query: "", category: "", filter: "" }), "Start again", "wg-btn primary"), tries);
    return block;
  }
  function drawSection(section2, here, wanted) {
    const block = h(
      "section",
      { class: "wg-band", "data-band": section2.id },
      h(
        "div",
        { class: "wg-band-head" },
        h("h2", { class: "wg-band-title", text: section2.title }),
        section2.note ? h("p", { class: "wg-band-note", text: section2.note }) : null
      )
    );
    if (section2.id === "board") block.append(drawBoardPicture(here));
    else if (section2.presets) block.append(drawPresets(section2.presets, here));
    else if (section2.layouts) block.append(drawLayouts(section2.layouts));
    else if (section2.missing) block.append(drawMissing(section2.missing));
    else block.append(drawGrid(section2.key, section2.widgets, section2.hero === true, wanted));
    return block;
  }
  function drawGrid(key, widgets, hero, wanted) {
    const grid = h("div", { class: "wg-grid", role: "list", ...hero ? { "data-hero": "true" } : {} });
    for (const id of widgets) {
      const definition = widgetById(id);
      if (!definition) continue;
      const mine = `${key}:${id}`;
      wanted.add(mine);
      let tile = tiles.get(mine);
      if (!tile) {
        tile = createTile({ definition, deps, board: () => state?.board ?? null, hero });
        tiles.set(mine, tile);
        byElement.set(tile.element, tile);
        seeing?.observe(tile.element);
      } else {
        tile.refresh();
      }
      tile.element.setAttribute("role", "listitem");
      grid.append(tile.element);
    }
    grid.addEventListener("keydown", (event) => onGridKey(event, grid));
    return grid;
  }
  function onGridKey(event, grid) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("wg-tile-open")) return;
    const handles = [...grid.querySelectorAll(".wg-tile-open")];
    const at2 = handles.indexOf(target);
    if (at2 < 0) return;
    const key = event.key;
    if (key === "a" || key === "A" || key === "f" || key === "F") {
      const tile = byElement.get(target.closest(".wg-tile") ?? target);
      if (!tile) return;
      event.preventDefault();
      if (key === "a" || key === "A") tile.add();
      else tile.favourite();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return;
    const top = handles[0].getBoundingClientRect().top;
    const columns = Math.max(1, handles.filter((one) => Math.abs(one.getBoundingClientRect().top - top) < 4).length);
    const to = nextTile(at2, key, columns, handles.length);
    if (to === at2 || to < 0) return;
    event.preventDefault();
    handles[to].focus();
  }
  function drawBoardPicture(here) {
    const shown = visibleWidgets(here.instances);
    const picture = drawMiniature(shown, { width: 320, columns: 4, mostRows: 4, label: `Your start page, ${shown.length === 1 ? "1 widget" : `${shown.length} widgets`}` });
    const arrange = h("button", { class: "wg-btn primary", type: "button", text: "Arrange" });
    arrange.addEventListener("click", () => deps.arrange(true));
    return h(
      "div",
      { class: "wg-board-picture" },
      h("div", { class: "wg-board-picture-art" }, picture.element),
      h(
        "div",
        { class: "wg-board-picture-say" },
        picture.shape.hidden > 0 ? h("p", { class: "wg-note", text: `${picture.shape.hidden} more below what is drawn here.` }) : null,
        h("p", { class: "wg-sub", text: "Move them about, change their size, or take one off." }),
        arrange
      )
    );
  }
  function drawPresets(ids, here) {
    const row2 = h("div", { class: "wg-presets", role: "list" });
    for (const id of ids) {
      const preset = WIDGET_PRESETS.find((one) => one.id === id);
      const made3 = preset ? presetLayout(preset) : null;
      if (!preset || !made3) continue;
      const use = h("button", { class: "wg-btn primary", type: "button", text: "Use this layout" });
      use.disabled = !connected || state === null;
      use.addEventListener("click", () => {
        use.disabled = true;
        void deps.link.act({ type: "preset", preset: preset.id }).then((reply) => {
          use.disabled = false;
          if (!reply.ok) return deps.say(reply.message);
          deps.say(reply.said, { label: "Undo", press: () => void deps.link.act({ type: "undo" }) });
        });
      });
      row2.append(h(
        "article",
        { class: "wg-preset", role: "listitem" },
        h("div", { class: "wg-preset-art" }, drawMiniature(made3, { width: 236, columns: 4, mostRows: 3, label: `What the ${preset.name} layout looks like` }).element),
        h("h3", { class: "wg-preset-name", text: preset.name }),
        h("p", { class: "wg-preset-say", text: preset.describe }),
        h("p", { class: "wg-note", text: presetNote(preset, here) }),
        use
      ));
    }
    return row2;
  }
  function drawLayouts(ids) {
    const list = h("ul", { class: "wg-saved", role: "list" });
    for (const id of ids) {
      const saved = state?.layouts.find((one) => one.id === id);
      if (!saved) continue;
      const row2 = h("li", { class: "wg-saved-one" });
      const acts = h("div", { class: "wg-row wg-saved-acts" });
      const use = h("button", { class: "wg-btn primary", type: "button", text: "Use it" });
      use.addEventListener("click", () => {
        use.disabled = true;
        void deps.link.act({ type: "layout.use", id }).then((reply) => {
          use.disabled = false;
          if (!reply.ok) return deps.say(reply.message);
          deps.say(reply.said, { label: "Undo", press: () => void deps.link.act({ type: "undo" }) });
        });
      });
      const forget = h("button", { class: "wg-btn", type: "button", text: "Forget it" });
      forget.addEventListener("click", () => {
        const yes = h("button", { class: "wg-btn wg-studio-danger", type: "button", text: `Forget "${saved.name}"` });
        const no = h("button", { class: "wg-btn", type: "button", text: "Keep it" });
        yes.addEventListener("click", () => {
          yes.disabled = true;
          void deps.link.act({ type: "layout.remove", id }).then((reply) => deps.say(reply.ok ? reply.said : reply.message));
        });
        no.addEventListener("click", () => {
          acts.replaceChildren(use, forget);
          forget.focus();
        });
        acts.replaceChildren(yes, no);
        yes.focus();
      });
      acts.append(use, forget);
      row2.append(
        h(
          "div",
          { class: "wg-saved-say" },
          h("h3", { class: "wg-saved-name", text: saved.name }),
          h("p", { class: "wg-sub", text: saved.widgets === 1 ? "1 widget" : `${saved.widgets} widgets` })
        ),
        acts
      );
      list.append(row2);
    }
    return list;
  }
  function drawMissing(missing) {
    const list = h("ul", { class: "wg-missing", role: "list" });
    for (const one of missing) {
      const definition = widgetById(one.widget);
      if (!definition) continue;
      list.append(h(
        "li",
        { class: "wg-missing-one" },
        drawMark(definition.icon, 22),
        h(
          "div",
          { class: "wg-missing-say" },
          h("h3", { class: "wg-missing-name", text: definition.name }),
          h("p", { class: "wg-sub", text: one.reason })
        )
      ));
    }
    return list;
  }
  const reasonFor = (definition) => {
    const offer = offerWidget(definition, drawable);
    return offer.ok ? "" : offer.reason;
  };
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (route.view === "widget" || route.view === "instance") deps.go(lastHome);
      else deps.go({ view: "closed" });
      return;
    }
    if (event.key === "/" && !inABox(event.target)) {
      event.preventDefault();
      shell?.search.focus();
      shell?.search.select();
      return;
    }
    if (event.key !== "Tab") return;
    const inside = [...host.querySelectorAll(FOCUSABLE)].filter((one) => one.getClientRects().length > 0);
    if (inside.length === 0) return;
    const first = inside[0];
    const last = inside[inside.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  host.setAttribute("hidden", "");
  return {
    show,
    route: () => route,
    destroy() {
      stop();
      close();
      seeing?.disconnect();
      seeing = null;
      host.removeEventListener("keydown", onKey);
      host.replaceChildren();
      shell = null;
    }
  };
}
var nameOf = (route) => route.view === "widget" ? `widget:${route.widget}` : route.view === "instance" ? `instance:${route.id}` : route.view;
var inABox = (target) => target instanceof HTMLElement && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable);
function signature(state, connected) {
  if (!state) return `none:${connected}`;
  const board = state.board;
  return [
    connected,
    board.enabled,
    visibleWidgets(board.instances).map((one) => one.widget).join(","),
    board.instances.length,
    board.favourites.join(","),
    board.recent.map((one) => one.widget).join(","),
    state.layouts.map((one) => `${one.id}/${one.name}/${one.widgets}`).join(",")
  ].join("|");
}

// orbis-ui/newtab/widgets/toast.ts
var STAY = 5e3;
function createToast(host) {
  const strip = h("div", { class: "wg-toast-strip", role: "status", "aria-live": "polite" });
  host.append(strip);
  let timer2 = 0;
  const clear2 = () => {
    clearTimeout(timer2);
    timer2 = 0;
    strip.replaceChildren();
  };
  return {
    say: (text2, action) => {
      clear2();
      if (!text2) return;
      const toast = h("div", { class: "wg-toast" }, h("span", { class: "wg-toast-words", text: text2 }));
      if (action) {
        toast.append(
          button(action.label, () => {
            clear2();
            action.press();
          }, action.label, "wg-btn")
        );
      }
      const close = button("Dismiss", clear2, "\xD7", "wg-icon-btn wg-toast-close");
      toast.append(close);
      strip.append(toast);
      timer2 = setTimeout(clear2, action ? STAY * 2 : STAY);
    },
    destroy: () => {
      clear2();
      strip.remove();
    }
  };
}

// orbis-ui/newtab/widgets/route.ts
var WORD = /^[a-z0-9-]{1,40}$/i;
var ID = /^[A-Za-z0-9_-]{1,80}$/;
function readRoute(hash) {
  const text2 = hash.replace(/^#/, "");
  if (text2 !== "widgets" && !text2.startsWith("widgets/") && !text2.startsWith("widgets?")) return { view: "closed" };
  const [path, search = ""] = text2.split("?", 2);
  const parts = path.split("/").slice(1);
  if (parts[0] === "on" && parts[1] && ID.test(parts[1])) return { view: "instance", id: parts[1] };
  if (parts[0] && parts[0] !== "on" && WORD.test(parts[0])) return { view: "widget", widget: parts[0].toLowerCase() };
  const params = new URLSearchParams(search);
  const query = (params.get("q") ?? "").slice(0, 80);
  const category = params.get("in") ?? "";
  const filter = params.get("show") ?? "";
  return {
    view: "home",
    ...query ? { query } : {},
    ...WORD.test(category) ? { category } : {},
    ...WORD.test(filter) ? { filter } : {}
  };
}
function writeRoute(route) {
  if (route.view === "closed") return "";
  if (route.view === "widget") return `#widgets/${route.widget}`;
  if (route.view === "instance") return `#widgets/on/${route.id}`;
  const params = new URLSearchParams();
  if (route.query) params.set("q", route.query);
  if (route.category) params.set("in", route.category);
  if (route.filter) params.set("show", route.filter);
  const search = params.toString();
  return search ? `#widgets?${search}` : "#widgets";
}

// orbis-ui/newtab/widgets/main.ts
function mountWidgets(options) {
  const link = createLink();
  const layer = h("div", { class: "wg-layer", hidden: true });
  document.body.append(layer);
  const toast = createToast(document.body);
  let gallery = null;
  let route = readRoute(location.hash);
  const go = (next) => {
    const hash = writeRoute(next);
    if (hash === writeRoute(route)) return show(next);
    if (hash) location.hash = hash;
    else if (location.hash) history.pushState(null, "", location.pathname);
    else return show(next);
  };
  const deps = {
    link,
    hour12: options.hour12,
    go,
    arrange: (on) => {
      if (on) go({ view: "closed" });
      board.arrange(on);
    },
    say: (text2, action) => toast.say(text2, action)
  };
  const board = mountBoard(options.host, deps);
  const show = (next) => {
    route = next;
    closeMenus();
    const open2 = next.view !== "closed";
    layer.hidden = !open2;
    document.body.classList.toggle("wg-gallery-open", open2);
    if (open2 && !gallery) gallery = mountGallery(layer, deps);
    gallery?.show(next);
  };
  const fromAddress = () => show(readRoute(location.hash));
  window.addEventListener("hashchange", fromAddress);
  window.addEventListener("popstate", fromAddress);
  show(route);
  let offered = false;
  const stopOffering = link.subscribe((state) => {
    if (offered || !state) return;
    offered = true;
    stopOffering();
    if (Array.isArray(options.legacy) && options.legacy.length > 0) void link.act({ type: "adopt", legacy: options.legacy });
  });
  return {
    openGallery: () => go({ view: "home" }),
    arrange: (on) => deps.arrange(on),
    destroy: () => {
      window.removeEventListener("hashchange", fromAddress);
      window.removeEventListener("popstate", fromAddress);
      stopOffering();
      gallery?.destroy();
      board.destroy();
      toast.destroy();
      layer.remove();
    }
  };
}
export {
  mountWidgets
};
