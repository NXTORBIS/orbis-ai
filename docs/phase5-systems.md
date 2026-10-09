# Phase 5 — the computing laboratories

Seven laboratories, each over an engine that works the thing out rather than describing it.

| Lab | Engine | What it will not do |
| --- | --- | --- |
| Digital Logic | `src/shared/compute/logic.ts` | no op-amps, no analogue; a circuit that never settles is reported as never settling |
| Processor | `src/shared/compute/processor.ts` | no real instruction set; the samples are the programmes it has |
| Operating System | `src/shared/compute/scheduling.ts` | no real processes; nothing it shows comes from this machine |
| Network | `src/shared/compute/networking.ts` | no real packets leave; IPv4 only |
| Image | `src/shared/compute/imaging.ts` | works on pictures it draws itself, never on your own photographs |
| Machine Learning | `src/shared/compute/learning.machine.ts` | small built-in datasets; no deep learning, no outside data |
| Neural Network | `src/shared/compute/neural.ts` | a few hundred weights, on the processor; no language models, no graphics card |

## The rules every one of them keeps

- **Measured, never asserted.** A truth table is produced by running the circuit; a pipeline trace is produced by
  running the pipeline; backpropagation is checked against numerical gradients in its own tests.
- **A control that cannot do anything is not drawn.** Progressive disclosure is declared in `shownWhen`, and a
  control whose own control is hidden is hidden with it.
- **A refusal names the control.** `"unobtainium" is not one of the choices` is useless in a batch of thirteen;
  every refusal is prefixed with the control's name.
- **Nothing claims what Orbis has not got.** `surfaces.test.ts` fails the build if a registered app has no surface,
  if a manifest states fewer than three limitations, or if the catalogue mentions a capability that resolves to
  nothing. There is no finite-element engine, so nothing may offer one.

## Where things are

- Manifests and controls: `src/shared/native/phase5.ts`
- Workers: `src/renderer/src/components/native/systems.worker.ts`, `intelligence.worker.ts`
- Panels: `LogicLab`, `ProcessorLab`, `OsLab`, `NetworkLab`, `ImageLab`, `LearningLab`, `NeuralLab`, all on `LabShell`
- Styles: `phase5.css`, namespaced `p5-`

## Verified by running it

`probe-phase5.mjs` drives the real window over the debugging port: 57 apps registered, each lab found the way
somebody would ask ("truth table", "page replacement", "confusion matrix"), each capability opens, configuration
lands, controls appear and disappear with what they belong to, a late result is still dropped, and
`runFiniteElement` is still refused.
