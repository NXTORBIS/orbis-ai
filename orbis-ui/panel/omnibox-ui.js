// src/shared/omniboxNative.ts
function actionFor(match) {
  const type = match.type;
  if (type === "open-tab" || type === "tab-search") return "SWITCH_TAB";
  if (type === "bookmark-title") return "OPEN_BOOKMARK";
  if (type.startsWith("history-") || type === "history-cluster") return "OPEN_HISTORY";
  if (type === "search-other-engine" || type === "featured-enterprise-search" || type === "starter-pack") return "SITE_SEARCH";
  if (type === "url-what-you-typed" || type === "navsuggest" || type === "navsuggest-personalized" || type === "navsuggest-tiles" || type === "most-visited-site-tile") return "NAVIGATE_URL";
  if (type === "url-from-clipboard" || type === "document") return "NAVIGATE_URL";
  if (match.isSearch) return "SEARCH";
  return "NAVIGATE_URL";
}
function groupFor(action) {
  switch (action) {
    case "SEARCH":
      return "Search";
    case "SWITCH_TAB":
      return "Open Tabs";
    case "OPEN_BOOKMARK":
      return "Bookmarks";
    case "OPEN_HISTORY":
      return "History";
    case "OPEN_WORKSPACE":
      return "Workspaces";
    case "EXECUTE_ORBIS_ACTION":
      return "Actions";
    case "SITE_SEARCH":
      return "Site Search";
    default:
      return "URLs";
  }
}
var NATIVE_RELEVANCE_REFERENCE = 1500;
var normalizeNative = (relevance) => Math.max(0, Math.min(1, (Number.isFinite(relevance) ? relevance : 0) / NATIVE_RELEVANCE_REFERENCE));
var normalizeOrbis = (score, reference = 1) => Math.max(0, Math.min(1, (Number.isFinite(score) ? score : 0) / (reference > 0 ? reference : 1)));
var accept = (batch, current) => batch.generation === current;
function stillFits(text, candidateText) {
  const typed = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!typed) return false;
  return candidateText.replace(/\s+/g, " ").trim().toLowerCase().startsWith(typed);
}
function provisionalFrom(text, suggestions, generation) {
  return suggestions.filter((suggestion) => stillFits(text, suggestion)).map((suggestion, i) => ({
    id: `q:${suggestion.replace(/\s+/g, " ").trim().toLowerCase()}`,
    source: "CACHE_PROVISIONAL",
    action: "SEARCH",
    group: "Search",
    text: suggestion,
    query: suggestion,
    // Below anything real by construction: a stand-in must never outrank the thing it is standing in for.
    rank: Math.max(0, 0.3 - i * 0.01),
    provisional: true,
    generation
  }));
}
function identityOf(candidate) {
  if (candidate.action === "SEARCH" || candidate.action === "SITE_SEARCH") {
    return `${candidate.action === "SITE_SEARCH" ? "site" : "q"}:${(candidate.query ?? candidate.text).replace(/\s+/g, " ").trim().toLowerCase()}`;
  }
  if (candidate.action === "OPEN_WORKSPACE" || candidate.action === "EXECUTE_ORBIS_ACTION") {
    return `${candidate.action}:${candidate.text.toLowerCase()}`;
  }
  return `u:${normalizeUrl(candidate.url ?? "")}`;
}
function normalizeUrl(url) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const host = u.host.replace(/^www\./i, "");
    const path = u.pathname.replace(/\/$/, "");
    return `${host}${path}${u.search}`.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "").toLowerCase();
  }
}
function preferred(a, b) {
  if (a.action === "SWITCH_TAB" && b.action !== "SWITCH_TAB") return a;
  if (b.action === "SWITCH_TAB" && a.action !== "SWITCH_TAB") return b;
  if (a.provisional !== b.provisional) return a.provisional ? b : a;
  return b.rank > a.rank ? b : a;
}
var LOOKS_LIKE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|:)/i;
var NAMES_ORBIS_THING = /\b(workspace|workflow|profile|tab|window|bookmark|download|history|settings)\b/i;
var ASKS_FOR_ACTION = /^(close|open|new|switch|mute|pin|unpin|split|reload|duplicate|clear|run|start|stop)\b/i;
function leaning(text) {
  const typed = text.trim();
  if (!typed) return "search";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) || LOOKS_LIKE_HOST.test(typed)) return "navigate";
  if (ASKS_FOR_ACTION.test(typed)) return "orbis";
  if (NAMES_ORBIS_THING.test(typed)) return "open";
  return "search";
}
var NUDGE = 0.12;
function nudgeFor(lean, action) {
  if (lean === "navigate") return action === "NAVIGATE_URL" || action === "OPEN_HISTORY" || action === "OPEN_BOOKMARK" ? NUDGE : action === "SEARCH" ? -NUDGE : 0;
  if (lean === "search") return action === "SEARCH" ? NUDGE : action === "EXECUTE_ORBIS_ACTION" ? -NUDGE : 0;
  if (lean === "orbis") return action === "EXECUTE_ORBIS_ACTION" ? NUDGE : action === "SEARCH" ? -NUDGE : 0;
  return action === "OPEN_WORKSPACE" || action === "SWITCH_TAB" || action === "EXECUTE_ORBIS_ACTION" ? NUDGE : 0;
}
function fromNative(batch) {
  return batch.matches.filter((match) => match.destinationUrl || match.isSearch).map((match) => {
    const action = actionFor(match);
    const isSearchish = action === "SEARCH" || action === "SITE_SEARCH";
    return {
      id: identityOf({ action, url: match.destinationUrl, query: isSearchish ? match.contents : void 0, text: match.contents }),
      source: "CHROMIUM_NATIVE",
      action,
      group: groupFor(action),
      text: match.contents,
      ...match.description ? { description: match.description } : {},
      ...match.destinationUrl ? { url: match.destinationUrl } : {},
      ...isSearchish ? { query: match.contents } : {},
      provider: match.provider,
      nativeRelevance: match.relevance,
      rank: normalizeNative(match.relevance),
      provisional: false,
      generation: batch.generation,
      ...match.fillIntoEdit ? { fillIntoEdit: match.fillIntoEdit } : {},
      ...match.inlineAutocompletion ? { inlineAutocompletion: match.inlineAutocompletion } : {},
      ...batch.defaultIndex === match.index ? { isDefault: true } : {},
      transition: match.transition,
      nativeIndex: match.index,
      ...match.associatedKeyword || match.keyword ? { keyword: match.associatedKeyword || match.keyword } : {}
    };
  });
}
var GROUP_ORDER = ["Search", "Open Tabs", "History", "Bookmarks", "Site Search", "URLs", "Workspaces", "Actions"];
function merge(input) {
  const lean = leaning(input.text);
  const native2 = input.native && accept(input.native, input.generation) ? fromNative(input.native) : [];
  const hasNative = native2.length > 0;
  const orbis = (input.orbis ?? []).map((candidate) => ({
    ...candidate,
    generation: input.generation,
    rank: normalizeOrbis(candidate.orbisScore ?? candidate.rank, input.orbisReference ?? 1)
  }));
  const provisional = hasNative ? [] : provisionalFrom(input.text, input.provisional ?? [], input.generation);
  const byIdentity = /* @__PURE__ */ new Map();
  for (const candidate of [...native2, ...orbis, ...provisional]) {
    const key = identityOf(candidate);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, { ...candidate, id: key });
      continue;
    }
    const winner = preferred(existing, candidate);
    const loser = winner === existing ? candidate : existing;
    byIdentity.set(key, {
      ...winner,
      id: key,
      // Keep whatever the loser knew that the winner did not, so merging never costs information: an Orbis row that
      // won still needs the native index to be opened through the native pipeline.
      nativeIndex: winner.nativeIndex ?? loser.nativeIndex,
      isDefault: winner.isDefault || loser.isDefault,
      fillIntoEdit: winner.fillIntoEdit ?? loser.fillIntoEdit,
      transition: winner.transition ?? loser.transition
    });
  }
  const ordered = [...byIdentity.values()].map((candidate) => ({ candidate, score: candidate.rank + nudgeFor(lean, candidate.action) })).sort((a, b) => {
    if (Boolean(a.candidate.isDefault) !== Boolean(b.candidate.isDefault)) return a.candidate.isDefault ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.candidate.id.localeCompare(b.candidate.id);
  }).map(({ candidate }) => candidate).slice(0, input.limit ?? 10);
  const present = new Set(ordered.map((c) => c.group));
  return {
    candidates: ordered,
    groups: GROUP_ORDER.filter((group) => present.has(group)),
    settled: Boolean(input.native && accept(input.native, input.generation) && input.native.done),
    provisional: ordered.some((c) => c.provisional),
    generation: input.generation
  };
}
function preserveSelection(previousId, candidates) {
  if (!previousId) return -1;
  const at = candidates.findIndex((candidate) => candidate.id === previousId);
  if (at >= 0) return at;
  return candidates.length ? 0 : -1;
}
function defaultOf(merged) {
  return merged.candidates.find((candidate) => candidate.isDefault) ?? merged.candidates[0] ?? null;
}
function diagnose(input, merged) {
  const native2 = input.native && accept(input.native, input.generation) ? input.native.matches : [];
  return {
    input: input.text,
    generation: input.generation,
    providers: [...new Set(native2.map((m) => m.provider).filter(Boolean))].sort(),
    nativeMatches: native2.length,
    orbisMatches: (input.orbis ?? []).length,
    provisional: merged.candidates.filter((c) => c.provisional).length,
    final: merged.candidates.length,
    settled: merged.settled,
    leaning: leaning(input.text)
  };
}
var ORBIS_ONLY = {
  // Things Chromium has no idea about.
  workspace: "OPEN_WORKSPACE",
  tab: "SWITCH_TAB",
  site: "SITE_SEARCH",
  vertical: "EXECUTE_ORBIS_ACTION",
  research: "EXECUTE_ORBIS_ACTION",
  orion: "EXECUTE_ORBIS_ACTION"
};
var COVERED_BY_CHROMIUM = /* @__PURE__ */ new Set(["navigate", "query", "history", "bookmark", "web", "search"]);
function fromOrbis(suggestions, options) {
  const reference = options.reference ?? Math.max(1, ...suggestions.map((s) => s.score));
  return suggestions.filter((suggestion) => !options.nativeAvailable || !COVERED_BY_CHROMIUM.has(suggestion.kind)).map((suggestion) => {
    const action = ORBIS_ONLY[suggestion.kind] ?? (suggestion.url ? "NAVIGATE_URL" : "SEARCH");
    return {
      id: identityOf({ action, url: suggestion.url, query: suggestion.query, text: suggestion.text }),
      source: "ORBIS_NATIVE",
      action,
      group: groupFor(action),
      text: suggestion.text,
      ...suggestion.detail ? { description: suggestion.detail } : {},
      ...suggestion.url ? { url: suggestion.url } : {},
      ...suggestion.query ? { query: suggestion.query } : {},
      provider: `orbis:${suggestion.kind}`,
      orbisScore: suggestion.score,
      rank: normalizeOrbis(suggestion.score, reference),
      provisional: false,
      generation: options.generation
    };
  });
}

// orbis-ui/panel/omnibox-ui.ts
import * as native from "./omnibox-native.js";

// orbis-ui/panel/omnibox-focus.ts
var NEXT_FRAME = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
function whenVisible() {
  if (document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", on);
      resolve();
    };
    document.addEventListener("visibilitychange", on);
  });
}
function createOmniboxFocus(getInput) {
  let state = "idle";
  const listeners = /* @__PURE__ */ new Set();
  let generation = 0;
  let lastExplicit = 0;
  const set = (next) => {
    if (state === next) return;
    state = next;
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
      }
    }
  };
  const input = () => getInput();
  const onFocus = () => set("committed");
  const onBlur = () => set("blurred");
  let watched = null;
  const watch = () => {
    const el2 = input();
    if (el2 === watched) return;
    watched?.removeEventListener("focus", onFocus);
    watched?.removeEventListener("blur", onBlur);
    watched = el2;
    watched?.addEventListener("focus", onFocus);
    watched?.addEventListener("blur", onBlur);
  };
  function place(el2, request) {
    try {
      if (request.selectAll) {
        el2.select();
        return;
      }
      const caret = request.caret ?? "end";
      if (caret === "keep") return;
      const at = caret === "start" ? 0 : el2.value.length;
      el2.setSelectionRange(at, at);
    } catch {
    }
  }
  return {
    getFocusState: () => state,
    hasFocus: () => {
      const el2 = input();
      return Boolean(el2) && document.activeElement === el2;
    },
    async requestFocus(request = {}) {
      const reason = request.reason ?? "implicit";
      const mine = ++generation;
      if (reason === "explicit") lastExplicit = mine;
      set("requested");
      watch();
      await whenVisible();
      let el2 = input();
      if (!el2) {
        await NEXT_FRAME();
        el2 = input();
      }
      if (!el2 || !el2.isConnected) {
        set("unavailable");
        return false;
      }
      if (reason === "implicit" && lastExplicit > mine) return false;
      if (mine !== generation && reason === "implicit") return false;
      watch();
      el2.focus({ preventScroll: true });
      place(el2, request);
      const got = document.activeElement === el2;
      set(got ? "committed" : "unavailable");
      return got;
    },
    focus() {
      return this.requestFocus({ reason: "explicit" });
    },
    blur() {
      const el2 = input();
      if (el2 && document.activeElement === el2) el2.blur();
      set("blurred");
    },
    selectAll() {
      const el2 = input();
      try {
        el2?.select();
      } catch {
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      watched?.removeEventListener("focus", onFocus);
      watched?.removeEventListener("blur", onBlur);
      watched = null;
      listeners.clear();
    }
  };
}
function bindFocusShortcuts(focus) {
  const onKey = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== "l" && key !== "e") return;
    e.preventDefault();
    e.stopPropagation();
    void focus.requestFocus({ reason: "explicit", selectAll: true, from: `ctrl+${key}` });
  };
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}

// src/shared/whisperModels.ts
var HF_MIRROR = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
var WHISPER_MODEL_INFO = {
  tiny: { id: "tiny", label: "Whisper Tiny", file: "ggml-tiny.bin", url: `${HF_MIRROR}/ggml-tiny.bin`, sizeBytes: 77691713, ramMb: 273, description: "Fastest, least accurate. For low-memory machines." },
  base: { id: "base", label: "Whisper Base", file: "ggml-base.bin", url: `${HF_MIRROR}/ggml-base.bin`, sizeBytes: 147951465, ramMb: 388, description: "Quick, and noticeably better than Tiny." },
  small: { id: "small", label: "Whisper Small", file: "ggml-small.bin", url: `${HF_MIRROR}/ggml-small.bin`, sizeBytes: 487601967, ramMb: 852, description: "A good balance for an ordinary laptop." },
  medium: { id: "medium", label: "Whisper Medium", file: "ggml-medium.bin", url: `${HF_MIRROR}/ggml-medium.bin`, sizeBytes: 1533763059, ramMb: 2100, description: "Clearly more accurate; wants a capable machine." },
  "large-v3": { id: "large-v3", label: "Whisper Large v3", file: "ggml-large-v3.bin", url: `${HF_MIRROR}/ggml-large-v3.bin`, sizeBytes: 3095033483, ramMb: 3900, description: "The most accurate model, and the slowest." },
  "large-v3-turbo": { id: "large-v3-turbo", label: "Whisper Large v3 Turbo", file: "ggml-large-v3-turbo.bin", url: `${HF_MIRROR}/ggml-large-v3-turbo.bin`, sizeBytes: 1624555275, ramMb: 2e3, description: "Large-v3 accuracy at a fraction of the time. The default on a capable machine." }
};

// src/shared/voiceInput.ts
function nextState(state, event) {
  if (event.type === "failed") return state === "idle" ? "idle" : "error";
  if (event.type === "reset") return "idle";
  switch (state) {
    case "idle":
      return event.type === "start" ? "requesting-permission" : state;
    case "requesting-permission":
      return event.type === "permitted" ? "initializing" : state;
    case "initializing":
      return event.type === "capturing" ? "listening" : state;
    case "listening":
      return event.type === "stop" ? "processing" : state;
    case "processing":
      return event.type === "transcribed" ? "completed" : state;
    case "completed":
    case "error":
      return event.type === "start" ? "requesting-permission" : state;
  }
}
var isBusy = (state) => state !== "idle" && state !== "completed" && state !== "error";
function describeError(code) {
  switch (code) {
    case "permission-denied":
      return "Orbis is not allowed to use your microphone. Allow it in Windows privacy settings, then try again.";
    case "no-microphone":
      return "No microphone was found. Plug one in, or pick one in Windows sound settings.";
    case "microphone-lost":
      return "The microphone stopped part way through. Check it is still connected.";
    case "recording-error":
      return "Your microphone couldn't be recorded from. Check that nothing else has taken it.";
    case "no-speech":
      return "Nothing was recorded. Check your microphone is not muted, and speak a little longer.";
    case "too-long":
      return "That recording is too long to transcribe. Try it in shorter pieces.";
    case "bad-audio":
      return "The recording couldn't be read. Try again.";
    case "model-missing":
      return "The speech model is not installed yet. Download it in Settings \u2192 Voice input.";
    case "model-corrupted":
      return "The speech model on disk is damaged. Delete and re-download it in Settings \u2192 Voice input.";
    case "unsupported-hardware":
      return "This machine can't run local speech recognition.";
    case "insufficient-memory":
      return "Not enough free memory to run the speech model. Choose a smaller one in Settings \u2192 Voice input.";
    case "runtime-error":
      return "Whisper could not be run just now.";
    case "timeout":
      return "Transcribing took too long and was stopped.";
    case "cancelled":
      return "Voice input was cancelled.";
  }
}
var MAX_AUDIO_BYTES = 200 * 1024 * 1024;
var MIN_AUDIO_BYTES = 1200;
var MAX_DURATION_MS = 5 * 6e4;
function checkAudio(bytes) {
  if (bytes < MIN_AUDIO_BYTES) return "no-speech";
  if (bytes > MAX_AUDIO_BYTES) return "too-long";
  return null;
}
var AUDIO_FORMATS = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/mpeg"];
function pickFormat(supported) {
  return AUDIO_FORMATS.find((type) => supported(type)) ?? null;
}

// src/renderer/src/lib/audioToWav.ts
var WHISPER_SAMPLE_RATE = 16e3;
var sharedContext = null;
function context() {
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContext();
  return sharedContext;
}
function toMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mixed[i] += data[i] / buffer.numberOfChannels;
  }
  return mixed;
}
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.round(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, samples.length - 1);
    const frac = pos - a;
    out[i] = samples[a] * (1 - frac) + samples[b] * frac;
  }
  return out;
}
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset2, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset2 + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
  }
  return new Uint8Array(buffer);
}
async function toWhisperWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await context().decodeAudioData(arrayBuffer);
  const mono = toMono(decoded);
  const resampled = resample(mono, decoded.sampleRate, WHISPER_SAMPLE_RATE);
  return encodeWav(resampled, WHISPER_SAMPLE_RATE);
}

// orbis-ui/panel/voice-session.ts
var DEFAULT_MAX_MS = 6e4;
function toBase64(bytes) {
  let binary = "";
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
function createVoiceSession(options) {
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  let state = "idle";
  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let timer = null;
  let ticker = null;
  const move = (event, extra = {}) => {
    state = nextState(state, event);
    options.onUpdate({ state, target: options.target, ...extra });
  };
  const isBusyNow = () => isBusy(state);
  const fail = (code, message) => {
    release();
    state = nextState(state, { type: "failed", code });
    options.onUpdate({ state, target: options.target, error: { code, message: message ?? describeError(code) } });
  };
  function release() {
    if (timer) clearTimeout(timer);
    if (ticker) clearInterval(ticker);
    timer = null;
    ticker = null;
    try {
      recorder?.stream?.getTracks().forEach((t) => t.stop());
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
    }
    recorder = null;
    stream = null;
  }
  return {
    state: () => state,
    available: () => Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder === "function",
    async start() {
      if (isBusyNow()) this.cancel();
      chunks = [];
      const format = pickFormat((type) => MediaRecorder.isTypeSupported(type));
      if (!format) return fail("recording-error", "This page cannot record audio in a format Orbis can transcribe.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        const name = error?.name ?? "";
        return fail(name === "NotAllowedError" || name === "SecurityError" ? "permission-denied" : "no-microphone");
      }
      try {
        recorder = new MediaRecorder(stream, { mimeType: format });
      } catch {
        return fail("recording-error", "The microphone could not be started.");
      }
      recorder.addEventListener("dataavailable", (e) => {
        if (e.data?.size) chunks.push(e.data);
      });
      move({ type: "start" });
      move({ type: "permitted" });
      recorder.start();
      startedAt = Date.now();
      move({ type: "capturing" }, { ms: 0 });
      ticker = setInterval(() => options.onUpdate({ state, target: options.target, ms: Date.now() - startedAt }), 250);
      timer = setTimeout(() => void this.stop(), maxMs);
    },
    async stop() {
      if (state !== "listening" || !recorder) return;
      const done = new Promise((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
      try {
        recorder.stop();
        await done;
      } catch {
        return fail("recording-error");
      }
      release();
      move({ type: "stop" });
      const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
      chunks = [];
      if (!blob.size) return fail("no-speech", "Nothing was recorded.");
      let wav;
      try {
        wav = await toWhisperWav(blob);
      } catch {
        return fail("bad-audio");
      }
      const problem = checkAudio(wav.length);
      if (problem) return fail(problem);
      try {
        const result = await options.call("voice:transcribe", [toBase64(wav), {}]);
        if (!result || result.ok !== true) {
          return fail(result?.code ?? "runtime-error", result?.message);
        }
        const text = String(result.text ?? "").trim();
        if (!text) return fail("no-speech");
        state = nextState(state, { type: "transcribed" });
        options.onUpdate({ state, target: options.target, text });
      } catch (error) {
        fail("runtime-error", error?.message);
      }
    },
    cancel() {
      const wasRunning = isBusyNow();
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
      }
      release();
      chunks = [];
      if (wasRunning) void options.call("voice:cancel", []).catch(() => void 0);
      state = nextState(state, { type: "reset" });
      options.onUpdate({ state, target: options.target });
    }
  };
}

// orbis-ui/panel/omnibox-ui.ts
var MAX_ROWS = 8;
var DEBOUNCE_MS = 90;
var el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== void 0) node.textContent = text;
  return node;
};
var GLYPH = {
  Search: "M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z",
  History: "M12 3a9 9 0 1 0 8.5 12H18.3A7 7 0 1 1 12 5v3l4-4-4-4z M11 8v5l4 2 .8-1.6-3.3-1.7V8z",
  Bookmarks: "M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z",
  "Open Tabs": "M3 5h18v14H3z M3 9h18 M8 5v4",
  Workspaces: "M3 3h8v8H3z M13 3h8v5h-8z M13 10h8v11h-8z M3 13h8v8H3z",
  Actions: "M4 6h10 M18 6h2 M4 12h2 M10 12h10 M4 18h12",
  "Site Search": "M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4z M8 11h6",
  URLs: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"
};
function glyph(group) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", GLYPH[group] ?? GLYPH.Search);
  svg.append(path);
  return svg;
}
function mark(candidate) {
  const box = el("span", "omni-mark");
  box.append(glyph(candidate.group));
  if (candidate.url && /^https?:/i.test(candidate.url) && location.protocol === "chrome:") {
    const img = el("img");
    img.alt = "";
    img.width = 16;
    img.height = 16;
    img.src = `chrome://favicon2/?size=16&pageUrl=${encodeURIComponent(candidate.url)}`;
    img.addEventListener("load", () => box.replaceChildren(img));
  }
  return box;
}
var hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
function secondLine(candidate) {
  if (candidate.description) return candidate.description;
  if (candidate.action === "SWITCH_TAB") return `Switch to tab \u2014 ${candidate.url ? hostOf(candidate.url) : ""}`.trim();
  if (candidate.action === "OPEN_WORKSPACE") return "Open workspace";
  if (candidate.action === "EXECUTE_ORBIS_ACTION") return "Orbis";
  if (candidate.url) return hostOf(candidate.url);
  return candidate.action === "SITE_SEARCH" ? "Search this site" : "Search";
}
function mountOmnibox(host) {
  const input = host.input;
  const list = host.list ?? (() => {
    const made = el("div", "omni-list");
    input.insertAdjacentElement("afterend", made);
    return made;
  })();
  list.id = list.id || "omni-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Predictions");
  list.hidden = true;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-autocomplete", "both");
  const live = el("span", "omni-live");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");
  list.insertAdjacentElement("afterend", live);
  let merged = null;
  let lastInput = null;
  let selectedId = null;
  let selected = -1;
  let generation = 0;
  let latestBatch = null;
  let composing = false;
  let previousText = "";
  let timer = null;
  let orbisRows = [];
  const rowId = (i) => `${list.id}-row-${i}`;
  const focus = createOmniboxFocus(() => input);
  const unbindShortcuts = bindFocusShortcuts(focus);
  input.addEventListener("pointerdown", () => void focus.requestFocus({ reason: "explicit", caret: "keep", from: "pointer" }));
  const mic = el("button", "omni-mic");
  mic.type = "button";
  mic.hidden = true;
  mic.setAttribute("aria-label", "Dictate into the address bar");
  mic.title = "Dictate into the address bar";
  const micGlyph = () => {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("aria-hidden", "true");
    const body = document.createElementNS(NS, "path");
    body.setAttribute("d", "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z");
    const arc = document.createElementNS(NS, "path");
    arc.setAttribute("d", "M5 11a7 7 0 0 0 14 0M12 18v3");
    svg.append(body, arc);
    return svg;
  };
  mic.append(micGlyph());
  input.insertAdjacentElement("afterend", mic);
  const say = (message) => {
    live.textContent = message;
  };
  const voice = host.call ? createVoiceSession({
    target: "url-bar",
    call: host.call,
    onUpdate: (update) => {
      mic.dataset.state = update.state;
      mic.classList.toggle("on", update.state === "listening");
      mic.classList.toggle("busy", update.state === "requesting-permission" || update.state === "initializing" || update.state === "processing");
      mic.setAttribute("aria-pressed", String(update.state === "listening"));
      if (update.error) {
        say(update.error.message);
        mic.setAttribute("aria-label", "Dictate into the address bar");
        return;
      }
      if (update.state === "listening") {
        mic.setAttribute("aria-label", "Stop dictating");
        say("Listening.");
        return;
      }
      if (update.state === "processing") {
        say("Working out what you said\u2026");
        return;
      }
      mic.setAttribute("aria-label", "Dictate into the address bar");
      if (!update.text) return;
      input.value = update.text;
      previousText = input.value;
      void focus.requestFocus({ reason: "explicit", caret: "end", from: "voice" });
      ask();
      say(`Heard: ${update.text}`);
    }
  }) : null;
  if (voice?.available()) mic.hidden = false;
  const toggleVoice = () => {
    if (!voice) return;
    if (voice.state() === "listening") void voice.stop();
    else void voice.start();
  };
  mic.addEventListener("click", (e) => {
    e.preventDefault();
    toggleVoice();
  });
  function draw() {
    list.replaceChildren();
    const candidates = merged?.candidates ?? [];
    if (!candidates.length) {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      return;
    }
    let group = null;
    candidates.forEach((candidate, i) => {
      if (candidate.group !== group) {
        group = candidate.group;
        const heading = el("div", "omni-group", group);
        heading.setAttribute("role", "presentation");
        list.append(heading);
      }
      const row = el("div", `omni-row${i === selected ? " on" : ""}`);
      row.id = rowId(i);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === selected));
      row.append(mark(candidate));
      const words = el("span", "omni-words");
      words.append(el("span", "omni-title", candidate.text), el("span", "omni-detail", secondLine(candidate)));
      row.append(words);
      if (candidate.keyword) {
        row.append(el("span", "omni-tab-hint", "Tab"));
      }
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        take(candidate);
      });
      row.addEventListener("pointerenter", () => {
        selected = i;
        selectedId = candidate.id;
        mark_selection();
      });
      list.append(row);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    mark_selection();
    if (merged?.settled) live.textContent = `${candidates.length} prediction${candidates.length === 1 ? "" : "s"}`;
  }
  function mark_selection() {
    for (const [i, row] of [...list.querySelectorAll(".omni-row")].entries()) {
      row.classList.toggle("on", i === selected);
      row.setAttribute("aria-selected", String(i === selected));
    }
    if (selected >= 0) input.setAttribute("aria-activedescendant", rowId(selected));
    else input.removeAttribute("aria-activedescendant");
  }
  function recompute() {
    const text = input.value;
    lastInput = {
      text,
      generation,
      native: latestBatch,
      orbis: orbisRows,
      provisional: host.provisional?.(text) ?? [],
      limit: MAX_ROWS
    };
    merged = merge(lastInput);
    selected = preserveSelection(selectedId, merged.candidates);
    selectedId = selected >= 0 ? merged.candidates[selected].id : null;
    draw();
  }
  const stopNative = native.onResults((batch) => {
    if (batch.generation !== generation) return;
    latestBatch = batch;
    recompute();
  });
  function ask() {
    const text = input.value;
    if (!text.trim()) {
      latestBatch = null;
      orbisRows = [];
      merged = null;
      selected = -1;
      selectedId = null;
      native.stop({ keep: false });
      draw();
      return;
    }
    const preventInline = text.length < previousText.length;
    previousText = text;
    generation = native.start(text, { cursor: input.selectionStart ?? text.length, preventInline });
    latestBatch = null;
    recompute();
    void host.orbisSuggestions?.(text).then((suggestions) => {
      if (!suggestions || generation !== (lastInput?.generation ?? generation)) return;
      orbisRows = fromOrbis(suggestions, { generation, nativeAvailable: native.available() });
      recompute();
    }).catch(() => {
    });
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      ask();
    }, DEBOUNCE_MS);
  }
  function take(candidate) {
    dismiss();
    switch (candidate.action) {
      case "SEARCH":
        host.onSearch(candidate.query ?? candidate.text);
        return;
      case "SITE_SEARCH":
      case "NAVIGATE_URL":
      case "OPEN_HISTORY":
      case "OPEN_BOOKMARK":
      case "SWITCH_TAB":
        if (candidate.nativeIndex !== void 0 && native.available()) {
          void native.open(candidate.nativeIndex).catch(() => {
            host.onSearch(input.value);
          });
          return;
        }
        if (candidate.url) host.onOpenExternally(candidate.url);
        else host.onSearch(candidate.query ?? candidate.text);
        return;
      default:
        host.onOrbisAction?.(candidate);
    }
  }
  function move(by) {
    const candidates = merged?.candidates ?? [];
    if (!candidates.length) return;
    selected = selected < 0 ? by > 0 ? 0 : candidates.length - 1 : (selected + by + candidates.length) % candidates.length;
    selectedId = candidates[selected].id;
    native.stop({ keep: true });
    mark_selection();
    const row = list.querySelector(`#${CSS.escape(rowId(selected))}`);
    row?.scrollIntoView({ block: "nearest" });
  }
  function dismiss() {
    if (timer) clearTimeout(timer);
    timer = null;
    merged = null;
    selected = -1;
    selectedId = null;
    latestBatch = null;
    native.stop({ keep: false });
    draw();
  }
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    schedule();
  });
  input.addEventListener("input", () => {
    if (composing) return;
    schedule();
  });
  input.addEventListener("keydown", (e) => {
    if (composing || e.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
      return;
    }
    if (e.key === "Escape") {
      if (voice && voice.state() === "listening") {
        e.preventDefault();
        e.stopPropagation();
        voice.cancel();
        say("Dictation cancelled.");
        return;
      }
      if (!list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
      return;
    }
    if (e.key === "Tab") {
      const row = selected >= 0 ? merged?.candidates[selected] : defaultOf(merged ?? { candidates: [], groups: [], settled: false, provisional: false, generation });
      if (row?.keyword) {
        e.preventDefault();
        input.value = `${row.keyword} `;
        previousText = input.value;
        generation = native.start(input.value, { cursor: input.value.length, keywordMode: true });
        latestBatch = null;
        recompute();
      }
      return;
    }
    if (e.key !== "Enter") return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const words = input.value.trim();
      dismiss();
      if (words) host.onAskOrion(words);
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      const row = selected >= 0 ? merged?.candidates[selected] : null;
      const target = row?.url ?? input.value.trim();
      dismiss();
      if (target) host.onOpenExternally(target);
      return;
    }
    const chosen = selected >= 0 ? merged?.candidates[selected] : merged ? defaultOf(merged) : null;
    if (chosen) {
      e.preventDefault();
      e.stopPropagation();
      take(chosen);
    }
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!list.contains(document.activeElement)) dismiss();
    }, 120);
  });
  return {
    dismiss,
    focus,
    voiceAvailable: () => Boolean(voice?.available()),
    toggleVoice,
    state: () => merged,
    diagnostics: () => lastInput && merged ? diagnose(lastInput, merged) : null,
    destroy() {
      stopNative();
      unbindShortcuts();
      voice?.cancel();
      focus.destroy();
      if (timer) clearTimeout(timer);
      native.stop({ keep: false });
      mic.remove();
      list.remove();
      live.remove();
    }
  };
}
export {
  mountOmnibox
};
