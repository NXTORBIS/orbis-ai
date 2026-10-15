/**
 * Voice control: speech recognition → text → Groq → tool router → action.
 *
 *   VOICE → SPEECH RECOGNITION → TEXT → GROQ → TOOL ROUTER
 *         → ORBISEYE TOOLS → ACTION → TEXT RESPONSE
 *
 * Recognition is deliberately decoupled from the AI provider. The browser's own
 * engine transcribes locally and only TEXT is ever sent to Groq, so either half
 * can be swapped without touching the other; Whisper via /api/groq/stt remains
 * as a fallback for browsers lacking that engine.
 *
 * The OpenAI path (gevRealtime.js) instead holds one streaming Realtime session
 * with server-side turn detection. Groq has no equivalent, hence push-to-talk
 * turns here. Everything above the transport is shared between the two: the
 * same panel from createVoiceControl and the same runner from
 * createGevActionRunner, so both providers drive one action layer.
 *
 * All 28 tools remain available — selectTools() only decides which subset is
 * worth sending for a given sentence, never which capabilities exist.
 *
 * @module voice/gevGroqVoice
 */

import { createGevActionRunner } from './gevActions.js';
import { createVoiceControl } from './gevRealtime.js';

/** Below this, the clip is a stray keypress rather than speech. */
const MIN_TURN_MS = 350;
/** Whisper invents text for near-empty audio ("Thank you." for pure silence). */
const MIN_TURN_BYTES = 2000;
/** A conversation window long enough for pronouns, short enough to stay cheap. */
const MAX_HISTORY_MESSAGES = 6;
/** Guards against a tool-call loop burning the daily request budget. */
const MAX_TOOL_ROUNDS = 3;
/** Ceiling on tools per request — see selectTools() for why this matters. */
const MAX_TOOLS_PER_TURN = 8;

/**
 * Always available, because almost any request can follow one of these.
 * Deliberately tiny: every tool sent costs tokens on every turn.
 */
const CORE_TOOLS = ['fly_to_location', 'set_layer_visibility', 'zoom_to_globe'];

/**
 * Keyword → candidate tools.
 *
 * Groq's tool-capable models allow 8K tokens per minute, and the full 28-tool
 * schema is ~7K tokens — so sending everything means one request per minute and
 * a 429 on the next. Routing to a handful of relevant tools cuts a turn to
 * ~1.5K tokens, which is the difference between a usable voice loop and one
 * that rate-limits itself after a single sentence.
 *
 * Matched against the transcript; misses simply mean the model lacks that tool
 * for the turn and says so, which is a better failure than a wrong action.
 */
const TOOL_ROUTES = [
  [/\b(fly|go|take me|show me|visit|navigate|travel|head)\b/, ['fly_to_location']],
  [/\b(zoom|closer|nearer|farther|further|out|in|globe|earth|altitude)\b/, ['adjust_camera_zoom', 'zoom_to_globe']],
  [/\b(orbit|pan|tilt|rotate|circle|camera|drone|overhead|frame)\b/, ['move_camera', 'frame_overhead']],
  [/\b(layer|flights?|aircraft|planes?|satellites?|ships?|vessels?|earthquakes?|fires?|traffic|bikeshare|cables?|dams?|datacent|installations?)\b/, ['set_layer_visibility', 'show_data_layers_menu']],
  [/\b(style|thermal|flir|nvg|night ?vision|crt|noir|snow|filter|vision|look|sensor)\b/, ['set_visual_style', 'set_post_processing']],
  [/\b(hud|heads ?up|tactical|detection|boxes|overlay)\b/, ['set_hud', 'set_detection']],
  [/\b(cockpit|ride|onboard|inside)\b/, ['control_cockpit']],
  [/\b(track|follow|chase|callsign|tail|stop following|untrack)\b/, ['track_entity', 'stop_tracking', 'select_nearest_aircraft']],
  [/\b(cctv|street ?view|surveillance|watch)\b/, ['control_cctv']],
  [/\b(radio|station|music|listen|tune)\b/, ['control_radio']],
  [/\b(scene|tour|cinematic|route|dolly|playback)\b/, ['control_scene', 'fly_route']],
  [/\b(draw|annotate|mark|outline|highlight|label|erase|clear)\b/, ['annotate_map', 'clear_annotations']],
  [/\b(context|contacts|space missions?|panel|menu|open|close)\b/, ['set_context_mode', 'set_panel_open']],
  [/\b(basemap|imagery|map stack|osm|street map|terrain)\b/, ['set_map_stack']],
  [/\b(how many|count|which|what|list|tell me|nearby|around|status)\b/, ['analyst_query', 'get_current_view_state', 'get_entity_context']],
  [/\b(iss|space station|pass over|overhead pass)\b/, ['next_iss_pass']],
];

/**
 * Choose the tools worth sending for one transcript.
 *
 * @param {string} transcript
 * @param {Array<object>} allTools Full schema from /api/voice/tools.
 * @returns {Array<object>} A capped, relevant subset.
 */
export function selectTools(transcript, allTools) {
  const said = String(transcript || '').toLowerCase();
  const wanted = new Set(CORE_TOOLS);
  for (const [pattern, names] of TOOL_ROUTES) {
    if (pattern.test(said)) names.forEach((n) => wanted.add(n));
  }
  const picked = allTools.filter((t) => wanted.has(t.function?.name));
  // Keep the core first so a truncated list never loses navigation.
  picked.sort((a, b) => {
    const ai = CORE_TOOLS.indexOf(a.function.name);
    const bi = CORE_TOOLS.indexOf(b.function.name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return picked.slice(0, MAX_TOOLS_PER_TURN);
}

const SYSTEM_PROMPT = [
  'You control OrbisEye, a live 3D globe.',
  'Carry out the user\'s request by calling the provided tools — do not just describe what you would do.',
  'Chain tools when a request needs several steps.',
  'After acting, reply in one short sentence confirming what changed.',
  'If a request cannot be met with the available tools, say so plainly in one sentence.',
].join(' ');

/**
 * Browser-native speech recognition, when the engine exists.
 *
 * Deliberately independent of the AI provider: recognition happens in the
 * browser and only TEXT reaches Groq. That keeps the two layers swappable,
 * costs nothing against the Whisper quota, and avoids uploading audio at all.
 * Chrome and Edge implement it; Firefox largely does not, which is why the
 * Whisper path below stays as a fallback rather than being deleted.
 *
 * @returns {(new () => any)|null}
 */
function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Pick a container the browser can actually record. */
function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

/**
 * Wire Groq voice control into the existing panel.
 *
 * @returns {{stop: (opts?: {removeUi?: boolean}) => void, isActive: () => boolean}}
 */
export function initGevGroqVoice({
  viewer, styleManager, dataManager, sceneDirector = null, annotations = null,
}) {
  if (window.__gevVoiceCommands?.stop) {
    window.__gevVoiceCommands.stop({ removeUi: true });
  }

  const runner = createGevActionRunner({ viewer, styleManager, dataManager, sceneDirector, annotations });
  const ui = createVoiceControl({ reset: true });

  let tools = null;
  let speechEnabled = false;
  let recorder = null;
  let recognizer = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let busy = false;
  let spaceHeld = false;
  let disposed = false;
  let audioEl = null;
  const history = [];

  const setState = (status, detail) => {
    if (disposed) return;
    if (ui.root) ui.root.dataset.status = status;
    if (ui.status) ui.status.textContent = status.toUpperCase();
    if (detail && ui.detail) ui.detail.textContent = detail;
  };

  const showError = (message) => {
    setState('error', message);
    if (ui.errorDetail) ui.errorDetail.textContent = message;
  };

  /**
   * Trim the conversation window WITHOUT leaving it starting mid-turn.
   *
   * A `tool` message is only valid immediately after the assistant message
   * carrying its tool_call_id, so trimming by raw count can orphan one and the
   * whole request is then rejected with a 400 — which surfaced as "Assistant
   * failed" on the third command, once two tool-using turns had grown the
   * history past the cap. Dropping to the next clean user turn keeps every
   * window the API sees self-consistent.
   */
  function trimHistory() {
    while (history.length > MAX_HISTORY_MESSAGES) history.shift();
    while (history.length && history[0].role !== 'user') history.shift();
  }

  // ---- server calls -------------------------------------------------------

  async function loadTools() {
    if (tools) return tools;
    const res = await fetch('/api/voice/tools');
    if (!res.ok) throw new Error('tool schema unavailable');
    tools = (await res.json()).tools || [];
    return tools;
  }

  async function transcribe(blob) {
    const res = await fetch('/api/groq/stt', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'audio/webm' },
      body: blob,
    });
    if (!res.ok) throw new Error(res.status === 429 ? 'Speech quota reached' : 'Transcription failed');
    return ((await res.json()).text || '').trim();
  }

  async function chat(messages, turnTools) {
    const res = await fetch('/api/groq/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnTools?.length ? { messages, tools: turnTools } : { messages }),
    });
    if (!res.ok) {
      // 429 is by far the likeliest failure on the free tier, and it clears on
      // its own — say so instead of showing a generic error the user can't act on.
      throw new Error(res.status === 429 ? 'Rate limited — wait a moment' : 'Assistant failed');
    }
    return (await res.json()).message || null;
  }

  async function speak(text) {
    // Never fail a turn over speech: the daily TTS cap is small, and the reply
    // is already on screen by the time this runs.
    if (!speechEnabled || !text) return;
    try {
      const res = await fetch('/api/groq/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text }),
      });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      if (!audioEl) audioEl = new Audio();
      audioEl.src = url;
      audioEl.play().catch(() => {});
      audioEl.onended = () => URL.revokeObjectURL(url);
    } catch { /* speech is best-effort */ }
  }

  // ---- one turn -----------------------------------------------------------

  /** Whisper backend: audio in, then hand the text to the shared turn. */
  async function runTurn(blob) {
    busy = true;
    let said = '';
    try {
      setState('listening', 'TRANSCRIBING…');
      said = await transcribe(blob);
    } catch (err) {
      showError(String(err?.message || err).toUpperCase().slice(0, 60));
      busy = false;
      return;
    }
    busy = false;
    if (!said) {
      setState('idle', 'NOTHING HEARD');
      return;
    }
    runTurnFromText(said);
  }

  /**
   * Everything after recognition: route tools, call Groq, run the actions,
   * show the reply. Shared by both recognition backends — this is the half the
   * architecture cares about, and it only ever sees text.
   */
  async function runTurnFromText(said) {
    if (busy || disposed) return;
    busy = true;
    try {
      setState('thinking', said.toUpperCase().slice(0, 80));
      history.push({ role: 'user', content: said });

      // Route once per turn, then reuse for the follow-up rounds so a chained
      // call keeps the same tools in scope without re-paying for a bigger list.
      const turnTools = selectTools(said, await loadTools());
      let message = await chat([{ role: 'system', content: SYSTEM_PROMPT }, ...history], turnTools);

      // Tool rounds: run what the model asked for, hand back the results, and
      // let it either chain another call or produce its spoken confirmation.
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const calls = message?.tool_calls;
        if (!calls?.length) break;

        history.push({ role: 'assistant', content: message.content || '', tool_calls: calls });
        setState('acting', (calls[0]?.function?.name || 'ACTING').replace(/_/g, ' ').toUpperCase());

        for (const call of calls) {
          let result;
          try {
            const args = JSON.parse(call.function?.arguments || '{}');
            result = await runner(call.function.name, args);
          } catch (err) {
            result = { ok: false, error: String(err?.message || err) };
          }
          history.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result ?? { ok: true }),
          });
        }

        message = await chat([{ role: 'system', content: SYSTEM_PROMPT }, ...history], turnTools);
      }

      const reply = (message?.content || '').trim();
      if (reply) history.push({ role: 'assistant', content: reply });
      trimHistory();

      setState('idle', reply ? reply.toUpperCase().slice(0, 90) : 'DONE');
      speak(reply);
    } catch (err) {
      showError(String(err?.message || err).toUpperCase().slice(0, 60));
    } finally {
      busy = false;
    }
  }

  // ---- listening ----------------------------------------------------------
  // Two recognition backends behind one interface. The browser engine is
  // preferred because it keeps recognition independent of the AI provider and
  // costs nothing; Whisper covers browsers without it. Either way only TEXT
  // reaches Groq.

  function startSpeechApi() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || busy || recognizer || disposed) return;
    let finalText = '';
    recognizer = new Ctor();
    recognizer.lang = navigator.language || 'en-US';
    recognizer.interimResults = true;
    recognizer.continuous = false;
    recognizer.maxAlternatives = 1;

    recognizer.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      const preview = (finalText + interim).trim();
      if (preview) setState('recording', preview.toUpperCase().slice(0, 70));
    };
    recognizer.onerror = (event) => {
      recognizer = null;
      if (event.error === 'not-allowed') showError('MIC PERMISSION DENIED');
      else if (event.error === 'no-speech') setState('idle', 'NOTHING HEARD');
      else setState('idle', 'VOICE STANDBY');
    };
    recognizer.onend = () => {
      recognizer = null;
      const said = finalText.trim();
      if (said) runTurnFromText(said);
      else setState('idle', 'NOTHING HEARD');
    };

    try {
      recognizer.start();
      setState('recording', 'LISTENING… RELEASE TO SEND');
    } catch {
      recognizer = null;
      showError('RECOGNITION UNAVAILABLE');
    }
  }

  function startListening() {
    if (getSpeechRecognitionCtor()) startSpeechApi();
    else startListening();
  }

  function stopListening() {
    if (recognizer) {
      // stop() still delivers whatever was finalised, unlike abort().
      try { recognizer.stop(); } catch { /* already ending */ }
      return;
    }
    stopListening();
  }

  async function startRecording() {
    if (busy || recorder || disposed) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showError('MIC PERMISSION DENIED');
      return;
    }
    const mimeType = pickMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    startedAt = performance.now();

    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const elapsed = performance.now() - startedAt;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      recorder = null;
      // Reject clips too short or too small to be speech, so a stray Space tap
      // never reaches Whisper — which answers silence with invented words.
      if (elapsed < MIN_TURN_MS || blob.size < MIN_TURN_BYTES) {
        setState('idle', 'TOO SHORT — HOLD TO SPEAK');
        return;
      }
      runTurn(blob);
    };

    recorder.start();
    setState('recording', 'LISTENING… RELEASE TO SEND');
  }

  function stopRecording() {
    if (recorder?.state === 'recording') recorder.stop();
  }

  // ---- input --------------------------------------------------------------

  const onKeyDown = (e) => {
    if (e.code !== 'Space' || e.repeat || spaceHeld) return;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    spaceHeld = true;
    e.preventDefault();
    startListening();
  };
  const onKeyUp = (e) => {
    if (e.code !== 'Space' || !spaceHeld) return;
    spaceHeld = false;
    e.preventDefault();
    stopListening();
  };
  const onButtonClick = () => {
    if (recorder || recognizer) stopListening();
    else startListening();
  };
  // The tier control has no meaning without OpenAI's model tiers; reuse it as
  // the spoken-reply toggle, which is the switch that matters on this path.
  const onTierClick = () => {
    speechEnabled = !speechEnabled;
    if (ui.tierButton) {
      ui.tierButton.textContent = speechEnabled ? 'TTS' : 'TXT';
      ui.tierButton.setAttribute('aria-pressed', String(speechEnabled));
      ui.tierButton.title = speechEnabled
        ? 'Spoken replies on (limited daily quota)'
        : 'Spoken replies off — replies appear as text';
    }
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  ui.button?.addEventListener('click', onButtonClick);
  ui.tierButton?.addEventListener('click', onTierClick);

  if (ui.tierButton) {
    ui.tierButton.textContent = 'TXT';
    ui.tierButton.setAttribute('aria-pressed', 'false');
    ui.tierButton.title = 'Spoken replies off — replies appear as text';
  }
  if (ui.costValue) ui.costValue.textContent = 'GROQ';
  if (ui.helpDetail) ui.helpDetail.textContent = getSpeechRecognitionCtor() ? 'Hold Space and speak · click mic to talk' : 'Hold Space to speak · click mic to record';
  setState('idle', 'VOICE STANDBY');
  loadTools().catch(() => showError('TOOL SCHEMA UNAVAILABLE'));

  const api = {
    isActive: () => Boolean(recorder) || busy,
    stop({ removeUi = false } = {}) {
      disposed = true;
      stopListening();
      stream?.getTracks().forEach((t) => t.stop());
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      ui.button?.removeEventListener('click', onButtonClick);
      ui.tierButton?.removeEventListener('click', onTierClick);
      if (removeUi) ui.root?.remove();
    },
  };
  window.__gevVoiceCommands = api;
  return api;
}
