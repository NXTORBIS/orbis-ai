# What a Page can compute

Every calculation a Page does goes through one call: `pages:compute`, which takes `{pageId, operation, input}`. There
is no second route to an engine. The operation is looked up in one map, the capability it needs is checked against
what that Page was granted, and only then does an engine see the input.

An operation that is not in the map cannot run. That is deny-by-default by construction rather than by a check
somebody remembered to write: adding an engine function does not make it reachable until it is given a capability.

## The shape of every answer

A result is `{ok: true, ...}` or `{ok: false, error, message, capability?}`. `ok` answers *did the request run*, which
is a different question from whether the thing being checked passed. Where an engine has its own verdict called `ok` —
a document satisfying a schema, an artifact that would work, a project that holds together — it is renamed in the
response (`satisfied`, `valid`, `holdsTogether`, `usable`, `importable`) rather than spread over the envelope's.

`message` is written for the person who will read it. Nothing rewrites it on the way out.

## A Page never sends code

Several engines take a function: an objective to minimise, a model to sample, a curve to plot, a constraint to prune
cases with. A Page cannot send one, and none of these operations accepts one.

Instead a Page sends an **expression as text**, and the AST interpreter in `shared/compute/expression.ts` turns it
into something callable. The interpreter walks a parsed tree. There is no `eval`, no `new Function`, and no path by
which text from a Page becomes code the JavaScript engine runs. `x^2 + 3x` gets arithmetic; `process.exit()` gets a
parse error, because that is not an expression.

The expression language is arithmetic only, deliberately. It has no comparison operators and no booleans, so anything
that needs a condition carries it beside the expressions rather than inside them — a sweep constraint is
`{left, comparison, right}`, not `"x < 3"`. Every operator added to that language is added for every engine that
compiles one, which is why it stays small.

## Whole numbers arrive as text

Number theory works in `bigint`, and JSON has no bigint. A JSON number past 2^53 loses its lower digits silently, so
`number.*` and `combinatorics.*` take decimal **strings** and return them. A number sent as a JSON literal outside the
safe range is refused with an explanation rather than rounded: a primality test on the wrong number is worse than a
refusal. At most 200 digits.

## Where the operations live

| File | Operations | What it covers |
| --- | --- | --- |
| `src/main/pages/engines.ts` | 41 | Statistics, tables, plotting, measurement, optimisation, simulation |
| `src/main/pages/mathEngines.ts` | 62 | Algebra, matrices, number theory, combinatorics, graphs, calculus, geometry |
| `src/main/pages/studyEngines.ts` | 34 | Uncertainty, parameter studies, documents, file formats |
| `src/main/pages/reasoningEngines.ts` | 31 | Workspaces, scenarios, learning, builders, projects |

Plus the units, expression and solver operations held directly in `service.ts`.

Each file exports its own capability map, and `service.ts` merges all of them into the one map it checks. A file that
forgets to export its map has operations nobody can call, which is the right way round.

## The capabilities

All of these are `computation.*`: local, deterministic, reaching no network, no files and no devices. They are the
only capabilities granted automatically.

| Capability | Operations | What a Page can do with it |
| --- | --- | --- |
| `computation.mathematics` | 62 | Exact and numeric mathematics across five laboratories |
| `computation.reasoning` | 31 | Structure a piece of work: assumptions, scenarios, plans, projects |
| `computation.simulate` | 14 | Run a model forward, sweep it, study its parameters |
| `computation.measurement` | 13 | Measurements, uncertainty and how it carries through |
| `computation.document` | 11 | Structured documents, outlines, references, citations |
| `computation.interchange` | 9 | Detect, decode and convert file formats the Page already holds |
| `computation.statistics` | 9 | Summarise and analyse numbers |
| `computation.data` | 8 | Read, sort, filter, join and summarise tables |
| `computation.plot` | 6 | Sample a function and work out what is needed to draw it |
| `computation.optimise` | 5 | Search for the best settings, subject to constraints |

## Prototype keys

Every user-chosen key — a variable name, a node id, a column name, a field name — is read with
`Object.prototype.hasOwnProperty.call` and written with `Object.defineProperty`. A node called `__proto__` is
something a person can type, and it has to stay a node rather than becoming a prototype. This is tested explicitly
rather than assumed.

## Bounds

Every operation is bounded before an engine sees the input, and the engines that call a compiled expression share a
work budget per request. Without that, one Page sending a slow expression to a multi-start optimiser makes the main
process unresponsive, and no capability check would have stopped it — the Page was allowed to do arithmetic, and that
is all it did.

## Adding one

1. Write the engine in `src/shared/compute/` or `src/shared/pages/`, with its own tests.
2. Add a case to the right bridge's dispatch, reading every field explicitly.
3. Add the operation to that bridge's capability map.
4. `src/main/pages/labEngines.test.ts` checks that every mapped operation has an implementation, that every capability
   named exists, and that no operation appears in two bridges. It will fail until all three hold.
5. If the engine's result has its own `ok`, rename it in the response.
