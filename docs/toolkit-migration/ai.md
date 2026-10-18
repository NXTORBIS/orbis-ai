# AI subject: 0 laboratories, 0 features

Laboratories found in the "ai" subject: 0. Features found: 0.

## Why the count is zero

- The catalogue type declares `'ai'` as an app domain (`src/shared/native/manifest.ts`, lines 50 and 63).
- No catalogue entry sets `domain: 'ai'`. A search of `src/` for `'ai'` as a domain value returns no laboratory.
- The Labs screen does have a "Learning machines" group with id `ai` (`src/renderer/src/components/labs/LabsView.tsx`, line 51). It shows only apps whose domain is `ai`, so it is empty.

## Closest laboratories (filed under another subject, not counted)

These two are about learning machines but are declared under the `computing` domain, so they are not in the ai subject. They are listed for reference only and no features are written for them here.

1. Machine Learning Laboratory, id `learning-lab`. Declared in `src/shared/native/phase5.ts` (entry starts line 1037, domain line 1040). Component: `src/renderer/src/components/native/LearningLab.tsx`.
2. Neural Network Laboratory, id `neural-lab`. Declared in `src/shared/native/phase5.ts` (entry starts line 1074, domain line 1077). Component: `src/renderer/src/components/native/NeuralLab.tsx`.

To count them under the ai subject, their `domain` would need to change from `'computing'` to `'ai'` in `phase5.ts`. That is a code change and was not made.
