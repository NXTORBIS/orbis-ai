# Answer-quality evals

Run the same 40 questions through the real chat path before and after a prompt or routing change, then compare.

## Run a baseline, change something, run again, compare

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/evalChat.mjs --label baseline
# ...edit src/main/prompt.ts, routing, etc...
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/evalChat.mjs --label after
node scripts/evalCompare.mjs evals/runs/baseline.json evals/runs/after.json
```

Options for `evalChat.mjs`: `--model <id>` (default: the app's default), `--label <name>`, `--limit N`, `--concurrency 2`,
`--out evals/runs/<label>.json`, `--effort low|medium|high|max` (default `high`, as in the app), `--only id,id`,
`--prompt-variant <name>` (passed as the third argument of `buildSystemPrompt`, for comparing prompt versions in one build).

- It uses `streamChat` from `src/main/nim.ts` and `buildSystemPrompt` from `src/main/prompt.ts` directly, with no Electron,
  and a user message only (no name, no personal settings, no history).
- Keys come from `.env` / `.env.local` (`GROQ_` and `MISTRAL_` prefixes, same as `electron.vite.config.ts`). They are never
  printed or saved; errors and answers are scrubbed before they are written.
- Each question is saved as soon as it finishes. Re-running the same command skips questions already answered and retries
  the ones that failed. A 429 gets one retry after 20 seconds, then the error is recorded.
- Automatic model fallback is off. If the chosen model fails and the app's own chain answers from another model
  (it always has Mistral models behind it), that question is recorded as an error rather than a misleading answer.
- Keep the model and `--effort` the same between the two runs, or the differences are not about your change.
  The run file stores the exact system prompt; `evalCompare` says so when both runs used the same one.
- Token usage is saved when the service returns it. Reasoning models spend tokens you cannot see in the answer.

`evalCompare.mjs` prints per-metric totals, flags regressions per question (now has filler, now over the word limit,
numeric answer now missing, bullet count wrong, no longer hedges, new error, and so on), and shows the first 300
characters of both answers for each regression. `--all` shows every pair; `--chars N` changes the excerpt length.

## What the metrics do and do not prove

They are counts and yes/no checks from `src/shared/answerMetrics.ts`. There is deliberately no overall score.

They can show: how long answers are, whether they open with filler ("Great question", "Certainly") or close with it
("I hope this helps"), whether a word limit or exact bullet count was obeyed, whether the expected number or a required
word (a function name) appears, whether a code fence is left open, whether sentences repeat, and whether an answer to an
unknowable question admits uncertainty.

They cannot show: that an answer is correct (a number appearing is not a correct derivation, and a correct number can
appear by accident), that code runs, that the tone is right, that facts are not invented, or that one answer is
more useful than another. Hedging and filler are phrase lists, so they miss wording they do not list. With one answer
per question and a model that varies between runs, small differences are noise; repeat a run before believing a
one-question swing. Read the side-by-side excerpts for anything flagged.

`evals/questions.json` has 40 questions in eight buckets with optional `expect` hints (`answer`, `mustContain`,
`maxWords`, `bullets`, `uncertain`). It holds no private data and no questions that need live web search. The "most
recent Formula 1 race" question is there to check that the model admits it cannot know, not that it knows.
