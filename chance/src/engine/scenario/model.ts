/**
 * Scenario model: a declarative description of variables, their distributions
 * or fixed values, dependencies between them, derived expressions and output
 * metrics.
 *
 * Dependency handling
 * -------------------
 * Three explicit mechanisms exist; nothing is assumed independent by default
 * beyond variables the user leaves unconnected.
 *
 *  1. Derived variables — an expression of other variables. This is exact
 *     functional dependence.
 *  2. A correlation group — a set of continuous distribution variables linked
 *     by a Gaussian copula: standard normal variates are drawn, mapped through
 *     Φ to uniforms, then through each variable's inverse CDF.
 *
 *     The user specifies a target *Spearman* (rank) correlation, which is not
 *     the correlation of the latent normals. For a Gaussian copula the two are
 *     related exactly by ρ_s = (6/π)·asin(ρ/2), so the latent correlation used
 *     is ρ = 2·sin(π·ρ_s/6). Feeding the Spearman target straight into the
 *     normal correlation matrix would produce a realised rank correlation
 *     noticeably below the one requested (0.8 would come out at about 0.786).
 *     Rank correlation is used because it is invariant under the marginal
 *     transforms, unlike Pearson correlation, which also depends on the
 *     margins. The matrix of latent correlations must be positive definite.
 *  3. Conditional variables — a variable whose distribution parameters are
 *     expressions of earlier variables (for example a success probability that
 *     depends on a sampled quality level).
 *
 * Structures outside these three mechanisms (for example an arbitrary joint
 * distribution specified by its density, or tail dependence that a Gaussian
 * copula cannot represent) are not supported and are reported as such rather
 * than silently approximated.
 */
import { EngineError, type Issue } from '../core/result';
import { compile, parseExpression, referencedVariables, topologicalOrder, type CompiledFn } from '../expression/expression';
import { getDistribution, hasDistribution, validateParams } from '../distributions/registry';
import { normalCdf } from '../special/gamma';
import type { Random } from '../random/rng';
import type { OutputSpec, PreparedModel, SimulationModelDef } from '../simulation/types';
import { choleskyWithCheck } from '../stats/linalg';

export type VariableKind = 'fixed' | 'distribution' | 'derived' | 'categorical' | 'bernoulli';

export interface CategoryOption {
  label: string;
  /** Numeric value used in expressions. */
  value: number;
  weight: number;
}

export interface ScenarioVariable {
  id: string;
  /** Identifier used in expressions: letters, digits and underscores. */
  name: string;
  label: string;
  kind: VariableKind;
  description?: string;
  unit?: string;
  /** kind = 'fixed' */
  value?: number;
  /** kind = 'distribution' */
  distributionId?: string;
  /** Fixed numeric parameters. */
  params?: Record<string, number>;
  /**
   * kind = 'distribution': parameters given as expressions of other variables
   * (conditional dependence). Takes precedence over `params` for the same key.
   */
  paramExpressions?: Record<string, string>;
  /** kind = 'derived' */
  expression?: string;
  /** kind = 'categorical' */
  categories?: CategoryOption[];
  /** kind = 'bernoulli': probability of the event (1), may be an expression. */
  probability?: number;
  probabilityExpression?: string;
  /** Round sampled values to whole numbers (e.g. counts of people). */
  integer?: boolean;
  /** Clamp sampled values to this range (applied after sampling). */
  clampMin?: number;
  clampMax?: number;
  /** Include this variable's samples in the result for sensitivity analysis. */
  track?: boolean;
}

export interface CorrelationGroup {
  id: string;
  label: string;
  /** Variable names in the group; all must be continuous distribution variables. */
  variables: string[];
  /**
   * Target Spearman rank correlations, as a flat list of pairs. Missing pairs
   * are treated as 0.
   */
  pairs: { a: string; b: string; rho: number }[];
}

export interface ScenarioOutput {
  id: string;
  key: string;
  label: string;
  expression: string;
  unit?: string;
  /** 'indicator' outputs must evaluate to 0 or 1 and are reported as probabilities. */
  kind: 'continuous' | 'discrete' | 'indicator';
  description?: string;
}

export interface ScenarioModelConfig {
  variables: ScenarioVariable[];
  correlationGroups: CorrelationGroup[];
  outputs: ScenarioOutput[];
  assumptions: string[];
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['pi', 'e', 'true', 'false', 'and', 'or', 'not', 'if', 'min', 'max']);

export function validateScenario(config: ScenarioModelConfig): Issue[] {
  const issues: Issue[] = [];
  if (!config || !Array.isArray(config.variables) || !Array.isArray(config.outputs)) {
    return [{ code: 'invalid', message: 'Scenario configuration is malformed.' }];
  }
  if (config.variables.length === 0) issues.push({ code: 'required', field: 'variables', message: 'Add at least one variable.' });
  if (config.outputs.length === 0) issues.push({ code: 'required', field: 'outputs', message: 'Add at least one output metric.' });
  if (config.variables.length > 200) issues.push({ code: 'limit', field: 'variables', message: 'A scenario supports at most 200 variables.' });

  const names = new Set<string>();
  for (const v of config.variables) {
    const field = `variable:${v.id}`;
    if (!NAME_RE.test(v.name ?? '')) {
      issues.push({ code: 'name', field, message: `"${v.name}" is not a valid variable name. Use letters, digits and underscores, starting with a letter.` });
      continue;
    }
    if (RESERVED.has(v.name.toLowerCase())) {
      issues.push({ code: 'name', field, message: `"${v.name}" is a reserved word. Choose another name.` });
    }
    if (names.has(v.name)) {
      issues.push({ code: 'duplicate', field, message: `Variable name "${v.name}" is used more than once.` });
    }
    names.add(v.name);
    switch (v.kind) {
      case 'fixed':
        if (typeof v.value !== 'number' || !Number.isFinite(v.value)) {
          issues.push({ code: 'finite', field, message: `${v.label || v.name}: enter a finite numeric value.` });
        }
        break;
      case 'distribution': {
        if (!v.distributionId || !hasDistribution(v.distributionId)) {
          issues.push({ code: 'unknown', field, message: `${v.label || v.name}: choose a distribution.` });
          break;
        }
        const def = getDistribution(v.distributionId);
        const exprKeys = new Set(Object.keys(v.paramExpressions ?? {}));
        // Only validate numerically the parameters that are not expressions.
        const numeric: Record<string, number> = {};
        for (const spec of def.params) {
          if (exprKeys.has(spec.key)) continue;
          numeric[spec.key] = v.params?.[spec.key] ?? NaN;
        }
        if (exprKeys.size === 0) {
          issues.push(...validateParams(def, numeric).map((i) => ({ ...i, field, message: `${v.label || v.name}: ${i.message}` })));
        } else {
          for (const [key, expr] of Object.entries(v.paramExpressions ?? {})) {
            if (!def.params.some((p) => p.key === key)) {
              issues.push({ code: 'unknown', field, message: `${v.label || v.name}: "${key}" is not a parameter of the ${def.name} distribution.` });
            }
            try {
              parseExpression(expr);
            } catch (e) {
              issues.push({ code: 'syntax', field, message: `${v.label || v.name}, parameter ${key}: ${(e as Error).message}` });
            }
          }
        }
        break;
      }
      case 'derived':
        if (!v.expression?.trim()) {
          issues.push({ code: 'required', field, message: `${v.label || v.name}: enter an expression.` });
        } else {
          try {
            parseExpression(v.expression);
          } catch (e) {
            issues.push({ code: 'syntax', field, message: `${v.label || v.name}: ${(e as Error).message}` });
          }
        }
        break;
      case 'categorical': {
        const cats = v.categories ?? [];
        if (cats.length < 2) {
          issues.push({ code: 'required', field, message: `${v.label || v.name}: define at least two categories.` });
          break;
        }
        let total = 0;
        for (const c of cats) {
          if (!(c.weight >= 0) || !Number.isFinite(c.weight)) {
            issues.push({ code: 'range', field, message: `${v.label || v.name}: category "${c.label}" needs a weight of 0 or more.` });
          } else total += c.weight;
          if (!Number.isFinite(c.value)) {
            issues.push({ code: 'finite', field, message: `${v.label || v.name}: category "${c.label}" needs a finite numeric value.` });
          }
        }
        if (total <= 0) issues.push({ code: 'sum', field, message: `${v.label || v.name}: at least one category weight must be greater than 0.` });
        break;
      }
      case 'bernoulli':
        if (v.probabilityExpression) {
          try {
            parseExpression(v.probabilityExpression);
          } catch (e) {
            issues.push({ code: 'syntax', field, message: `${v.label || v.name}: ${(e as Error).message}` });
          }
        } else if (!(typeof v.probability === 'number' && v.probability >= 0 && v.probability <= 1)) {
          issues.push({ code: 'range', field, message: `${v.label || v.name}: probability must be between 0 and 1.` });
        }
        break;
      default:
        issues.push({ code: 'unknown', field, message: `Unsupported variable type "${v.kind}".` });
    }
  }

  // Outputs
  const outKeys = new Set<string>();
  for (const o of config.outputs) {
    const field = `output:${o.id}`;
    if (!o.key || outKeys.has(o.key)) {
      issues.push({ code: 'duplicate', field, message: `Output key "${o.key}" is missing or duplicated.` });
    }
    outKeys.add(o.key);
    if (!o.expression?.trim()) {
      issues.push({ code: 'required', field, message: `${o.label || o.key}: enter an expression.` });
      continue;
    }
    try {
      const node = parseExpression(o.expression);
      for (const ref of referencedVariables(node)) {
        if (!names.has(ref)) {
          issues.push({ code: 'unknown-variable', field, message: `${o.label || o.key}: unknown variable "${ref}".` });
        }
      }
    } catch (e) {
      issues.push({ code: 'syntax', field, message: `${o.label || o.key}: ${(e as Error).message}` });
    }
  }

  // Dependency references and cycles
  if (!issues.some((i) => i.code === 'syntax' || i.code === 'name')) {
    const deps: { name: string; deps: Set<string> }[] = [];
    for (const v of config.variables) {
      const d = new Set<string>();
      const addRefs = (src?: string) => {
        if (!src) return;
        for (const r of referencedVariables(parseExpression(src))) {
          if (!names.has(r)) {
            issues.push({ code: 'unknown-variable', field: `variable:${v.id}`, message: `${v.label || v.name}: unknown variable "${r}".` });
          } else d.add(r);
        }
      };
      if (v.kind === 'derived') addRefs(v.expression);
      if (v.kind === 'distribution') Object.values(v.paramExpressions ?? {}).forEach(addRefs);
      if (v.kind === 'bernoulli') addRefs(v.probabilityExpression);
      deps.push({ name: v.name, deps: d });
    }
    try {
      topologicalOrder(deps);
    } catch (e) {
      if (e instanceof EngineError) issues.push(...e.issues);
      else throw e;
    }
  }

  // Correlation groups
  for (const g of config.correlationGroups ?? []) {
    const field = `group:${g.id}`;
    if (g.variables.length < 2) {
      issues.push({ code: 'required', field, message: `Correlation group "${g.label}" needs at least two variables.` });
      continue;
    }
    for (const n of g.variables) {
      const v = config.variables.find((x) => x.name === n);
      if (!v) {
        issues.push({ code: 'unknown-variable', field, message: `Correlation group "${g.label}": unknown variable "${n}".` });
        continue;
      }
      if (v.kind !== 'distribution') {
        issues.push({
          code: 'unsupported',
          field,
          message: `Correlation group "${g.label}": "${n}" is a ${v.kind} variable. Correlation can only be applied to variables that draw from a distribution.`,
        });
        continue;
      }
      if (v.paramExpressions && Object.keys(v.paramExpressions).length) {
        issues.push({
          code: 'unsupported',
          field,
          message: `Correlation group "${g.label}": "${n}" has parameters that depend on other variables. A variable cannot be both conditional and part of a correlation group.`,
        });
      }
    }
    const inOther = (config.correlationGroups ?? []).filter((o) => o.id !== g.id).flatMap((o) => o.variables);
    for (const n of g.variables) {
      if (inOther.includes(n)) {
        issues.push({ code: 'unsupported', field, message: `"${n}" appears in more than one correlation group. Combine them into a single group.` });
      }
    }
    for (const p of g.pairs) {
      if (!(p.rho >= -1 && p.rho <= 1)) {
        issues.push({ code: 'range', field, message: `Correlation between ${p.a} and ${p.b} must be between −1 and 1.` });
      }
      if (p.a === p.b) issues.push({ code: 'invalid', field, message: 'A variable cannot be correlated with itself.' });
    }
    // Positive definiteness
    if (!issues.some((i) => i.field === field)) {
      const m = correlationMatrix(g);
      const chol = choleskyWithCheck(m);
      if (!chol.ok) {
        issues.push({
          code: 'not-positive-definite',
          field,
          message: `The correlations in group "${g.label}" are mutually inconsistent (the correlation matrix is not positive definite), so no joint distribution has all of them. Reduce the strength of one or more correlations.`,
        });
      }
    }
  }
  return issues;
}

/**
 * Latent normal correlation that produces a given Spearman rank correlation
 * under a Gaussian copula: ρ = 2·sin(π·ρ_s/6), the inverse of the exact
 * relationship ρ_s = (6/π)·asin(ρ/2).
 */
export function spearmanToLatentCorrelation(rhoSpearman: number): number {
  return 2 * Math.sin((Math.PI * rhoSpearman) / 6);
}

/** The inverse: the rank correlation a latent normal correlation produces. */
export function latentToSpearmanCorrelation(rho: number): number {
  return (6 / Math.PI) * Math.asin(rho / 2);
}

/**
 * The matrix of *latent normal* correlations for a group, converted from the
 * Spearman targets the user supplied. This is the matrix the copula uses and
 * the one whose positive definiteness has to hold.
 */
export function correlationMatrix(g: CorrelationGroup): number[][] {
  const n = g.variables.length;
  const idx = new Map(g.variables.map((v, i) => [v, i]));
  const m: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (const p of g.pairs) {
    const i = idx.get(p.a);
    const j = idx.get(p.b);
    if (i === undefined || j === undefined || i === j) continue;
    const latent = spearmanToLatentCorrelation(p.rho);
    m[i][j] = latent;
    m[j][i] = latent;
  }
  return m;
}

type Step = (rng: Random, vals: Float64Array) => void;

/** Compile a scenario into a prepared simulation model. */
export function prepareScenario(config: ScenarioModelConfig): PreparedModel {
  const issues = validateScenario(config);
  if (issues.length) throw new EngineError(issues);

  const names = config.variables.map((v) => v.name);
  const index = new Map(names.map((n, i) => [n, i]));
  const byName = new Map(config.variables.map((v) => [v.name, v]));

  // Order variables so dependencies are sampled first.
  const deps = config.variables.map((v) => {
    const d = new Set<string>();
    const add = (src?: string) => {
      if (src) for (const r of referencedVariables(parseExpression(src))) if (index.has(r)) d.add(r);
    };
    if (v.kind === 'derived') add(v.expression);
    if (v.kind === 'distribution') Object.values(v.paramExpressions ?? {}).forEach(add);
    if (v.kind === 'bernoulli') add(v.probabilityExpression);
    return { name: v.name, deps: d };
  });
  const order = topologicalOrder(deps);

  // Correlation groups are sampled as a block before the ordered steps,
  // because a copula draw fills several variables at once. Group members have
  // no dependencies (enforced in validation), so this is safe.
  const groupSteps: Step[] = [];
  const grouped = new Set<string>();
  for (const g of config.correlationGroups ?? []) {
    const m = correlationMatrix(g);
    const chol = choleskyWithCheck(m);
    if (!chol.ok) throw new EngineError('Correlation matrix is not positive definite.', 'not-positive-definite');
    const L = chol.L;
    const n = g.variables.length;
    const targets = g.variables.map((name) => {
      const v = byName.get(name)!;
      const def = getDistribution(v.distributionId!);
      const params = { ...(v.params ?? {}) };
      grouped.add(name);
      return { slot: index.get(name)!, def, params, variable: v };
    });
    const z = new Float64Array(n);
    groupSteps.push((rng, vals) => {
      for (let i = 0; i < n; i++) z[i] = rng.normal();
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j <= i; j++) s += L[i][j] * z[j];
        const u = normalCdf(s);
        const t = targets[i];
        // Guard against u exactly 0 or 1, where some quantiles are infinite.
        const uu = Math.min(1 - 1e-15, Math.max(1e-15, u));
        vals[t.slot] = postProcess(t.def.quantile(uu, t.params), t.variable);
      }
    });
  }

  const steps: Step[] = [];
  for (const name of order) {
    if (grouped.has(name)) continue;
    const v = byName.get(name)!;
    const slot = index.get(name)!;
    switch (v.kind) {
      case 'fixed': {
        const value = v.value!;
        steps.push((_rng, vals) => {
          vals[slot] = value;
        });
        break;
      }
      case 'derived': {
        const fn = compile(parseExpression(v.expression!), index);
        steps.push((_rng, vals) => {
          vals[slot] = postProcess(fn(vals), v);
        });
        break;
      }
      case 'bernoulli': {
        if (v.probabilityExpression) {
          const pf = compile(parseExpression(v.probabilityExpression), index);
          steps.push((rng, vals) => {
            const p = pf(vals);
            // A probability expression that does not evaluate to a probability
            // is a broken model, not a probability of zero. Writing NaN marks
            // the trial as non-finite so the runner counts it and reports it,
            // exactly as the conditional-distribution branch below does.
            // Silently clamping produced a far worse outcome than a wrong
            // number: an expression such as 1/base with base = 0 became p = 0,
            // the event then never occurred, and the result carried the
            // caveat "the event did not occur in any trial — that does not
            // make it impossible, it means the probability is small relative
            // to the number of trials". That explanation was false. The event
            // never occurred because the model had been quietly rewritten.
            if (!Number.isFinite(p) || p < 0 || p > 1) {
              vals[slot] = NaN;
              return;
            }
            vals[slot] = rng.uniform() < p ? 1 : 0;
          });
        } else {
          const p = v.probability!;
          steps.push((rng, vals) => {
            vals[slot] = rng.uniform() < p ? 1 : 0;
          });
        }
        break;
      }
      case 'categorical': {
        const cats = v.categories!;
        const cum = new Float64Array(cats.length);
        let acc = 0;
        for (let i = 0; i < cats.length; i++) {
          acc += cats[i].weight;
          cum[i] = acc;
        }
        const values = Float64Array.from(cats.map((c) => c.value));
        steps.push((rng, vals) => {
          vals[slot] = values[rng.categorical(cum)];
        });
        break;
      }
      case 'distribution': {
        const def = getDistribution(v.distributionId!);
        const exprEntries = Object.entries(v.paramExpressions ?? {});
        if (exprEntries.length === 0) {
          const params = { ...(v.params ?? {}) };
          steps.push((rng, vals) => {
            vals[slot] = postProcess(def.sample(rng, params), v);
          });
        } else {
          const base = { ...(v.params ?? {}) };
          const compiled: [string, CompiledFn][] = exprEntries.map(([k, src]) => [k, compile(parseExpression(src), index)]);
          const scratch: Record<string, number> = { ...base };
          steps.push((rng, vals) => {
            for (const [k, fn] of compiled) scratch[k] = fn(vals);
            const bad = validateParams(def, scratch);
            if (bad.length) {
              // A conditional parameter went out of range for this trial.
              vals[slot] = NaN;
              return;
            }
            vals[slot] = postProcess(def.sample(rng, scratch), v);
          });
        }
        break;
      }
    }
  }

  const outputSpecs: OutputSpec[] = config.outputs.map((o) => ({
    key: o.key,
    label: o.label,
    kind: o.kind,
    unit: o.unit,
    role: 'output',
    description: o.description,
  }));
  const outputFns = config.outputs.map((o) => compile(parseExpression(o.expression), index));

  // Tracked input variables are recorded as extra columns for sensitivity analysis.
  const tracked = config.variables.filter((v) => v.track && v.kind !== 'fixed');
  for (const v of tracked) {
    outputSpecs.push({
      key: `input:${v.name}`,
      label: v.label || v.name,
      kind: v.kind === 'bernoulli' || v.integer || v.kind === 'categorical' ? 'discrete' : 'continuous',
      unit: v.unit,
      role: 'input',
      description: v.description,
    });
  }
  const trackedSlots = tracked.map((v) => index.get(v.name)!);

  const values = new Float64Array(names.length);
  const assumptions = [...(config.assumptions ?? [])];
  const unconnected = config.variables.filter(
    (v) => v.kind === 'distribution' && !grouped.has(v.name) && !Object.keys(v.paramExpressions ?? {}).length,
  );
  if (unconnected.length > 1) {
    assumptions.push(
      `These variables are sampled independently of each other: ${unconnected.map((v) => v.label || v.name).join(', ')}. If any of them move together in reality, add a correlation group or make one depend on the other.`,
    );
  }
  for (const g of config.correlationGroups ?? []) {
    const pairs = g.pairs.map((p) => `${p.a}–${p.b} ${p.rho}`).join(', ');
    assumptions.push(
      `Variables ${g.variables.join(', ')} are linked by a Gaussian copula targeting these Spearman rank correlations: ${pairs || 'none set'}. A Gaussian copula produces no tail dependence: extreme values of these variables are no more likely to coincide than the correlation alone implies.`,
    );
  }

  return {
    outputs: outputSpecs,
    assumptions,
    procedure: `Each trial samples ${config.variables.filter((v) => v.kind !== 'fixed' && v.kind !== 'derived').length} random variable(s), evaluates ${config.variables.filter((v) => v.kind === 'derived').length} derived value(s), then records ${config.outputs.length} output metric(s).`,
    runTrial(rng, out) {
      for (const s of groupSteps) s(rng, values);
      for (const s of steps) s(rng, values);
      for (let i = 0; i < outputFns.length; i++) out[i] = outputFns[i](values);
      for (let i = 0; i < trackedSlots.length; i++) out[outputFns.length + i] = values[trackedSlots[i]];
    },
  };
}

function postProcess(x: number, v: ScenarioVariable): number {
  let y = x;
  if (v.integer) y = Math.round(y);
  if (v.clampMin !== undefined && y < v.clampMin) y = v.clampMin;
  if (v.clampMax !== undefined && y > v.clampMax) y = v.clampMax;
  return y;
}

export const scenarioModel: SimulationModelDef<ScenarioModelConfig> = {
  id: 'scenario',
  name: 'Scenario model',
  description: 'A user-defined model of variables, dependencies and output metrics.',
  validate: validateScenario,
  prepare: prepareScenario,
};
