# Orbis

A black sci-fi HUD desktop AI assistant for Windows, powered by [Groq](https://groq.com). The default model is Llama 3.3 70B.

## Features

- HUD interface: animated particle grid, a system bar with live CPU load and clock, an icon rail, a glowing composer, a typewriter greeting, and a holographic "thinking" orb
- Streaming replies in glass cards with Markdown, tables, syntax-highlighted code, LaTeX math, and a collapsible reasoning panel
- Models: Llama 3.3 70B (default), Llama 3.1 8B Instant, GPT-OSS 120B, and GPT-OSS 20B. Pick one under Customize or in Settings → Default model.
- Web search: turn on the globe button and replies use live DuckDuckGo results
- Built-in browser from the globe icon in the left rail
- Assistants: General AI, Code Engineer, Research Analyst, Creative Writer
- Attach text and code files
- Chat history drawer with search, rename, and delete; share a chat as Markdown
- Stop, regenerate, edit-and-resend, thumbs up/down, and read aloud
- Rate-limit handling: if a model is busy, the next model answers; if all are busy, the app waits for the per-minute window. The activity panel logs every switch and error.
- Profile names (assistant name, your name, how to address you), dark or light theme, a visual-effects toggle, and custom instructions

Voice input and image upload aren't available yet. Their buttons show a "coming soon" notice.

## Requirements

- Node.js 22.12 or newer (24 LTS recommended). With nvm-windows, run `nvm use 24.21.0` from an **administrator** terminal.
- A Groq API key from [console.groq.com/keys](https://console.groq.com/keys)

## Getting started

1. Copy `.env.example` to `.env.local` and put your key after `GROQ_API_KEY=`. To add more keys from your own GroqCloud account, separate them with commas: `GROQ_API_KEY=first-key,second-key`. Orbis moves to the next key only when Groq rejects one, such as a revoked key.
2. Run:

```bash
npm install
npm run dev
```

The key is built into the app when it runs or builds. Change `.env.local` and restart `npm run dev` (or rebuild) to use a different key.

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
    index.ts      window, IPC, CPU sampling, file attachments, web search, link and context-menu handling
    nim.ts        Groq API client: streaming, model fallback, rate-limit waits
    websearch.ts  DuckDuckGo search used when web search is on
    prompt.ts     system prompt from profile, assistant persona, and custom instructions
    sse.ts        server-sent-events parser and <think> tag splitter
    store.ts      settings and conversation files
  preload/    the narrow `window.api` bridge exposed to the UI
  renderer/   React HUD (App state, system bar, rail, header, chat, composer, browser, overlays)
  shared/     types, models, modes, and assistant personas shared by all processes
```

## Data and configuration

- Settings and chats are stored in `%APPDATA%\Orbis` (`settings.json` and `conversations/*.json`). If `%APPDATA%\Nxtorbis AI` exists from before the rename, the app keeps using that folder.
- Logo artwork lives in `src/renderer/src/assets/` and the app icon in `build/icon.png`.
- Set `ORBIS_GROQ_BASE_URL` to point the app at another OpenAI-compatible endpoint, such as a local mock server for testing.
- Model IDs live in `src/shared/models.ts` and modes in `src/shared/modes.ts`. Groq changes its catalog over time; check [console.groq.com/docs/models](https://console.groq.com/docs/models) before adding models.
- The assistant is named Orbis by default. Change it, your name, and how it addresses you in Settings → Profile.

## Limits and security

- `.env.local` is git-ignored, so the key never reaches GitHub. Keep it that way: never commit a key.
- The key is embedded in the built app. Anyone with a copy of the installer can extract it and use your Groq quota. Only share builds with people you trust, or put a small server in front of Groq that holds the key.
- Groq's rate limits apply to your whole account, not per key. See [console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Enter / Shift+Enter | Send / new line |
| Esc | Stop generating |
| Ctrl+Shift+O | New chat |
| Ctrl+B | Toggle chat history |
| Ctrl+K | Search chats |
| Ctrl+, | Settings |

### Browser

These work while the browser, its URL bar, or a web page has focus. Orbis's own shortcuts above always win: Ctrl+N, Ctrl+Shift+N, Ctrl+Shift+O, Ctrl+B, Ctrl+, and Ctrl+K are never taken by the browser.

| Keys | Action |
|---|---|
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Shift+T | Reopen closed tab |
| Ctrl+Tab / Ctrl+Shift+Tab (or Ctrl+PageDown / PageUp) | Next / previous tab |
| Ctrl+1…8 / Ctrl+9 | Go to tab / last tab |
| Ctrl+Shift+PageUp / PageDown | Move tab left / right |
| Alt+Left / Alt+Right | Back / forward |
| Ctrl+R or F5 / Ctrl+Shift+R or Ctrl+F5 | Reload / reload without cache |
| Esc | Stop loading |
| Ctrl+L, Alt+D or F6 | Go to the URL bar |
| Ctrl+F, F3 / Shift+F3 | Find in page, next / previous match |
| Ctrl++ / Ctrl+- / Ctrl+0 | Zoom in / out / reset (remembered per site) |
| F11 | Fullscreen |
| Ctrl+H / Ctrl+J | History / downloads |
| Ctrl+D / Ctrl+Shift+D / Ctrl+Shift+B | Bookmark page / bookmark all tabs / bookmarks |
| Ctrl+P / Ctrl+S / Ctrl+U / F12 | Print / save page / view source / developer tools |
| Ctrl+click or middle-click / Shift+click | Open link in a background tab / a new window |
