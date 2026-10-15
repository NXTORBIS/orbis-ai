# NEUROVA engineering report

What was built, what was run, and what was not. Nothing here is claimed without a check that was actually run.

## Verified by running

| Item | Evidence |
|---|---|
| ACE-Step 1.5 on CPU | Worker run directly: 10 s stereo 48 kHz WAV, peak 0.89, no clipping, `inspectWav` ok. The last 4 s measured below -60 dB; not listened to. |
| HeartMuLa 3B on CPU | Worker run directly: 4.08 s stereo 48 kHz float WAV, peak 0.41, no clipping, no warnings, `inspectWav` ok. 50 generation frames took 1:40, decode about 10 minutes. Not listened to. |
| FLAC encoder | Bit-exact round trips (sine 16/24-bit, noise, silence, stereo, 3 samples) through an independent decoder that also checks both CRCs and the MD5. |
| Worker protocol, jobs, queue, leases, session reuse | 302 NEUROVA and guard tests, using scripted stand-in workers. |
| Build | `tsc` web and node clean; `npm run build` succeeds; `electron-builder --win --dir --config.npmRebuild=false` produces `dist/win-unpacked` containing `resources/neurova/ace_worker.py` and `heart_worker.py`. |
| Full suite | 9 failures, all in tests that need a real Chromium. None touch NEUROVA; they predate this work. |

## Built, not verified end to end

- The animated UI (motion system, generation progress, waveform player, composer) compiles and its pure logic is tested. It has not been opened or photographed in the running app, and the player has not played real audio in Electron.
- Model reuse (`--serve` mode) has only run against scripted fake workers, never the real ACE-Step model. The 8 GB and 14 GB memory estimates for leases are guesses.
- Engine "ready" is only recorded when a generation goes through the app's Generate button. Direct worker runs do not count, so both engines still show unverified in the app.

## Not built, and why

- MP3 export: every available encoder is LGPL or GPL, which the project rules out. FLAC (own implementation) is provided.
- Vocal and instrument detection: no verified method. Measured band energy is shown instead, labelled as not detection.
- A full installer (`electron-builder --win` without `--dir`): `node-pty` rebuild fails on this machine (no native build tools); the unpacked app builds with rebuild disabled.

## Engine notes

- ACE-Step: CPU documented as significantly slower. Weights licence not stated in the pages read.
- HeartMuLa: no instrumental mode, no seed, duration is an upper bound, CPU not documented upstream. On CPU the worker sets `TORCHDYNAMO_DISABLE=1` (torch.compile needs a C++ compiler) and saves with `soundfile` (torchaudio needs torchcodec). Installed on Python 3.12 because uv's 3.10 build failed here.
