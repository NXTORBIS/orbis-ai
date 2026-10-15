# NEUROVA

Song projects and song generation inside Orbis. This file says what exists, where it lives, and what has and has
not been verified. It is kept to what the code actually does.

## Where it is registered

- Screen: `src/renderer/src/components/NeurovaView.tsx`, opened from the launcher (capability `neurova` in
  `src/shared/commandCenter.ts`, feature id `neurova` in `App.tsx`).
- Window to main: 32 `neurova:*` channels, written down in `docs/ipc-mapping.md`.
- Per-profile data: `personal/neurova-projects.json` (metadata) and `<profile>/neurova/<project>/audio/*.wav`
  (audio). Registered as the `neurova` category in `src/shared/portable/registry.ts`.

## Parts

| Concern | File | Notes |
|---|---|---|
| Projects, versions, artifacts | `src/shared/neurova/project.ts` | Versions only add. Restore adds a copy. Paths are project-relative only. |
| Storage, import, export, packages | `src/main/neurova/store.ts` | Hash-verified copies. Package import re-verifies every file. |
| WAV inspection | `audio.ts` | Peak, level, clipping, quiet stretches, truncation, from decoded samples. |
| WAV decode/encode, operations | `wav.ts`, `process.ts` | Gain, fades, trim; tempo estimate; waveform envelope. New version each time. |
| Intent, lyrics, plan, compile | `intent.ts`, `lyrics.ts`, `plan.ts`, `compile.ts` | Original text kept. Nothing truncated. Unsupported items listed. |
| Candidates | `candidates.ts` | Unknown is never a pass. Locked qualities are never varied. |
| Job state | `job.ts` | Illegal and stale events ignored. No completion without validated output. |
| Queue | `scheduler.ts` | Bounded, no duplicates, slot always freed, bounded retries. |
| Worker protocol | `protocol.ts`, `src/main/neurova/runner.ts` | Job, order, range and path checked on every message. |
| ACE-Step worker | `resources/neurova/ace_worker.py` | Drives upstream `generate_music`. |
| Engine owner | `src/main/neurova/engine.ts` | Install, readiness, one job at a time, cancel, validation before success. |
| Engine facts | `engines.ts` | What upstream documents; `ready` only after a real generation succeeded here. |

## Engines (read from the upstream pages on the date of work)

- ACE-Step 1.5 (MIT code; weights licence not stated in the pages read). Python 3.11-3.12. CPU documented as
  "significantly slower". Installed by cloning the repository and running `uv sync` in its own folder under the
  app data directory; model files are fetched with its own `acestep-download`.
- HeartMuLa / heartlib (Apache-2.0). Request builder only; no runner is wired because upstream documents no
  instrumental, seed or duration control and no GPU/CPU requirement.

## What is verified and what is not

See the bottom of the engineering report in the conversation, and `src/shared/neurova/*.test.ts`,
`src/main/neurova/*.test.ts`. Tests that use a scripted stand-in worker prove protocol handling, not a model.

## Running the tests

```
node --test src/shared/neurova/*.test.ts src/main/neurova/*.test.ts
```
