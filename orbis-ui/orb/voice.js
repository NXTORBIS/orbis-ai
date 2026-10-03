// orbis-ui/orb/voice.ts
import { call } from "./helper.js";

// src/shared/pulsarModels.ts
var HF_MIRROR = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
var PULSAR_MODEL_INFO = {
  tiny: { id: "tiny", label: "Pulsar Tiny", file: "ggml-tiny.bin", url: `${HF_MIRROR}/ggml-tiny.bin`, sizeBytes: 77691713, ramMb: 273, description: "The fastest, and the least accurate. Good enough for short commands; it will misread unusual words. Pick this on an older or low-memory machine." },
  base: { id: "base", label: "Pulsar Base", file: "ggml-base.bin", url: `${HF_MIRROR}/ggml-base.bin`, sizeBytes: 147951465, ramMb: 388, description: "Quick, and noticeably better than Tiny at ordinary speech. A sensible floor if you dictate more than a few words." },
  small: { id: "small", label: "Pulsar Small", file: "ggml-small.bin", url: `${HF_MIRROR}/ggml-small.bin`, sizeBytes: 487601967, ramMb: 852, description: "The balance most laptops want: accurate on normal speech and still fast enough not to wait for." },
  medium: { id: "medium", label: "Pulsar Medium", file: "ggml-medium.bin", url: `${HF_MIRROR}/ggml-medium.bin`, sizeBytes: 1533763059, ramMb: 2100, description: "Clearly more accurate on names, jargon and accents. Wants a capable machine and takes longer." },
  "large-v3": { id: "large-v3", label: "Pulsar Large", file: "ggml-large-v3.bin", url: `${HF_MIRROR}/ggml-large-v3.bin`, sizeBytes: 3095033483, ramMb: 3900, description: "The most accurate there is, and the slowest by some way. Worth it only if accuracy matters more than waiting." },
  "large-v3-turbo": { id: "large-v3-turbo", label: "Pulsar Turbo", file: "ggml-large-v3-turbo.bin", url: `${HF_MIRROR}/ggml-large-v3-turbo.bin`, sizeBytes: 1624555275, ramMb: 2e3, description: "Large accuracy at a fraction of the time. The one to pick if your machine can hold it." }
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
      return "Pulsar could not be run just now.";
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
var PULSAR_SAMPLE_RATE = 16e3;
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
async function toPulsarWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await context().decodeAudioData(arrayBuffer);
  const mono = toMono(decoded);
  const resampled = resample(mono, decoded.sampleRate, PULSAR_SAMPLE_RATE);
  return encodeWav(resampled, PULSAR_SAMPLE_RATE);
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
        wav = await toPulsarWav(blob);
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

// orbis-ui/orb/voice.ts
var session = null;
var promptSession = null;
var deliver = (text) => {
  const words = text.trim();
  if (!words) return;
  chrome.send("orbis.omnibox.setText", [words]);
};
var show = (state, message = "") => {
  document.documentElement.dataset.orbisVoice = state;
  if (message) document.documentElement.dataset.orbisVoiceError = message;
  else delete document.documentElement.dataset.orbisVoiceError;
};
var onUpdate = (update) => {
  show(update.state, update.error?.message ?? "");
  if (update.state === "done" && update.text) deliver(update.text);
};
var ensure = () => {
  if (!session) {
    session = createVoiceSession({
      target: "url-bar",
      call: (channel, args) => call(channel, args),
      onUpdate
    });
  }
  return session;
};
var toggle = async () => {
  const voice = ensure();
  if (!voice.available()) {
    show("error", "This window cannot use the microphone.");
    return;
  }
  try {
    if (voice.state() === "listening") await voice.stop();
    else await voice.start();
  } catch (err) {
    show("error", err instanceof Error ? err.message : "Voice input could not start.");
  }
};
var promptVoice = (onUpdate2) => {
  if (!promptSession) {
    promptSession = createVoiceSession({
      target: "browser-orion",
      call: (channel, args) => call(channel, args),
      onUpdate: (update) => promptListener?.(update)
    });
  }
  promptListener = onUpdate2;
  return promptSession;
};
var promptListener = null;
window.orbisToggleVoice = () => void toggle();
window.orbisCancelVoice = () => {
  session?.cancel();
  show("idle");
};
window.orbisPromptVoice = {
  available: () => promptVoice(() => void 0).available(),
  state: () => promptSession?.state() ?? "idle",
  toggle: async (onUpdate2) => {
    const voice = promptVoice(onUpdate2);
    if (!voice.available()) {
      onUpdate2({ state: "error", target: "browser-orion", error: { code: "no-microphone", message: "This window cannot use the microphone." } });
      return;
    }
    if (voice.state() === "listening") await voice.stop();
    else await voice.start();
  },
  cancel: () => promptSession?.cancel()
};
