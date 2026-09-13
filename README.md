# Orbis

A black sci-fi HUD desktop AI assistant for Windows, powered by NVIDIA's free NIM API. The default model is Kimi K3.

## Features

- HUD interface: animated particle grid, a system bar with live CPU load and clock, an icon rail, a glowing composer, a typewriter greeting, and a holographic "thinking" orb
- Streaming replies in glass cards with Markdown, tables, syntax-highlighted code, LaTeX math, and a collapsible reasoning panel
- Modes: Auto (Kimi K3), Fast (DeepSeek V4 Flash), Advanced (DeepSeek V4 Pro), Reasoning (Kimi K3 at max effort), or Customize to pick any model
- Assistants: General AI, Code Engineer, Research Analyst, Creative Writer
- Attach text and code files; **Improve prompt** rewrites your draft with the Fast model
- Chat history drawer with search, rename, and delete; share a chat as Markdown
- Stop, regenerate, edit-and-resend, thumbs up/down, and read aloud
- Rate-limit handling: if a model is busy, the next model answers; if all are busy, the app waits for the per-minute window. The activity panel logs every switch and error.
- The API key is encrypted with Windows DPAPI (Electron `safeStorage`) and never reaches the UI process
- Profile names (assistant name, your name, how to address you), dark or light theme, a visual-effects toggle, and custom instructions
- **ORION (local)** in the model list (Customize, and Settings → Default model): chats go to your own ORION server on this computer instead of NVIDIA. It needs no API key and never falls back to a cloud model.

Voice input, image upload, and web search aren't available yet. Their buttons show a "coming soon" notice.

## Requirements

- Node.js 22.12 or newer (24 LTS recommended). With nvm-windows, run `nvm use 24.21.0` from an **administrator** terminal.
- A free NVIDIA API key from [build.nvidia.com](https://build.nvidia.com) (not needed for ORION (local))

## Getting started

```bash
npm install
npm run dev
```

Click your avatar (top right) or press **Ctrl+,**, paste your `nvapi-…` key, and click **Save**. The app tests the key right away.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Build main, preload, and renderer into `out/` |
| `npm run preview` | Run the production build |
| `npm run typecheck` | Type-check the main process and the UI |
| `npm test` | Unit tests for the streaming client (SSE parsing, fallback, retries, attachments, abort) |
| `npm run dist` | Type-check, build, and create a Windows installer in `dist/` |

## Project layout

```
src/
  main/       Electron main process
    index.ts    window, IPC, CPU sampling, file attachments, link and context-menu handling
    nim.ts      NVIDIA API client: streaming, model fallback, rate-limit waits
    prompt.ts   system prompt from profile, assistant persona, and custom instructions
    sse.ts      server-sent-events parser and <think> tag splitter
    store.ts    settings (encrypted key) and conversation files
  preload/    the narrow `window.api` bridge exposed to the UI
  renderer/   React HUD (App state, system bar, rail, header, chat, composer, overlays)
  shared/     types, models, modes, and assistant personas shared by all processes
```

## Data and configuration

- Settings and chats are stored in `%APPDATA%\Orbis` (`settings.json` and `conversations/*.json`). If `%APPDATA%\Nxtorbis AI` exists from before the rename, the app keeps using that folder.
- Logo artwork lives in `src/renderer/src/assets/` and the app icon in `build/icon.png`.
- Set `NXTORBIS_API_BASE_URL` to point the app at another OpenAI-compatible endpoint, such as a local mock server for testing.
- ORION (local) talks to `http://127.0.0.1:8765/v1` (override with `ORBIS_ORION_BASE_URL`). Start the server from `Downloads\AI\orion` with `.venv\Scripts\python.exe -m orion.api.server configs/system/laptop.yaml`. Replies arrive in one piece rather than streamed, and ORION keeps its own memory per chat.
- Model IDs live in `src/shared/models.ts` and modes in `src/shared/modes.ts`. NVIDIA changes its catalog over time; check `https://integrate.api.nvidia.com/v1/models` before adding models.
- The assistant is named Orbis by default. Change it, your name, and how it addresses you in Settings → Profile.

## Limits and terms

- NVIDIA's free tier allows about 40 requests per minute. Exact limits are unpublished and vary by model.
- NVIDIA's API Trial terms allow **testing and evaluation only**, not serving real end users. Before you distribute the app, switch to a paid provider.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Enter / Shift+Enter | Send / new line |
| Esc | Stop generating |
| Ctrl+Shift+O | New chat |
| Ctrl+B | Toggle chat history |
| Ctrl+, | Settings |
