# NEUROVA engineering report

What was built, what was run, and what was not. Nothing here is claimed without a check that was actually run.

## Verified by running

| Item | Evidence |
|---|---|
| ACE-Step 1.5 generation on CPU | Worker run directly: 10 s stereo 48 kHz WAV, peak 0.89, no clipping, `inspectWav` ok. The last 4 s measured below -60 dB; not listened to. |
| Worker protocol, job state, queue, validation | `src/shared/neurova/*.test.ts`, `src/main/neurova/*.test.ts` (112 tests) |
| Types and guards | `tsc` for web and node clean; IPC mapping, portability, portable registry, test registration guards pass |
| Full suite | 9 failures, all in tests that need a real Chromium (address bar, devtools, recording, tab groups, service). None touch NEUROVA and they predate this work. |

## Built, not verified end to end

- HeartMuLa: installer, worker (`resources/neurova/heart_worker.py`), engine selection and tags field. Runtime installed on Python 3.12 (uv's 3.10 build failed here) and 15 GB of checkpoints downloaded. The worker loads and generates on CPU in eager mode; see the result of the first full run below if recorded.
- Engine "ready" is only recorded when a generation goes through the app's Generate button. Direct worker runs do not count.

## Not built

- FLAC and MP3 export: no encoder in the project; adding one is a licence decision.
- Vocal and instrument detection: no verified method exists, so none is displayed.
- Resource leases and model reuse: each job loads its model fresh.
- Motion and animation polish, packaged installer build.

## Known limits of the engines

- ACE-Step: CPU is documented as significantly slower. Weights licence not stated in the pages read.
- HeartMuLa: no instrumental mode, no seed, duration is an upper bound, CPU not documented upstream. torch.compile needs a C++ compiler, so CPU runs use eager mode (`TORCHDYNAMO_DISABLE=1`).
