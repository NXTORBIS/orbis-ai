/**
 * Importance measures: which component deserves maintenance attention.
 *
 * All measures are computed from the exact structure function, not from an
 * approximation, and all of them inherit the independence assumption of the
 * underlying system model.
 */

import { EngineError, Validator, type Exactness } from '../core/result';
import { defined, undefinedMoment, type Moment } from '../distributions/types';
import {
  INDEPENDENCE_ASSUMED_NOTE,
  inspectStructure,
  minimalCutSets,
  inclusionExclusionUnion,
  structureReliability,
  type Reliabilities,
  type Structure,
} from './structures';

export interface ComponentImportance {
  id: string;
  reliability: number;
  /** ∂R_sys/∂r_i = R(r_i=1) − R(r_i=0). How much the system cares at all. */
  birnbaum: number;
  /**
   * Birnbaum × q_i / Q_sys: P(i is critical and failed | system failed).
   *
   * These four measures all divide by a quantity that can be zero (the system
   * failure probability, or the failure probability with i perfected), and
   * Fussell–Vesely additionally needs enumerable cut sets. They are therefore
   * reported with the engine's `Moment` shape — `{defined: false, reason}` —
   * rather than as NaN or Infinity. A sentinel number would oblige every
   * caller to remember a guard, and one forgotten guard renders "NaN" into the
   * interface; an undefined variant cannot be formatted by accident.
   */
  criticality: Moment;
  /** Fussell–Vesely: P(at least one minimal cut set containing i is failed | system failed). */
  fussellVesely: Moment;
  /** Risk achievement worth: Q_sys(r_i = 0) / Q_sys. How bad if i is guaranteed to fail. */
  riskAchievementWorth: Moment;
  /** Risk reduction worth: Q_sys / Q_sys(r_i = 1). How much is gained by perfecting i. */
  riskReductionWorth: Moment;
}

export interface ImportanceResult {
  systemReliability: number;
  components: ComponentImportance[];
  /** Component ids ordered by Birnbaum importance, most important first. */
  birnbaumRanking: string[];
  /** Component ids ordered by Fussell–Vesely importance, most important first. */
  fussellVeselyRanking: string[];
  exactness: Exactness;
  independenceAssumed: boolean;
  independenceNote: string;
  notes: string[];
}

export function importanceMeasures(structure: Structure, reliabilities: Reliabilities): ImportanceResult {
  const info = inspectStructure(structure);
  const v = new Validator();
  for (const id of info.ids) {
    const r = reliabilities[id];
    if (r === undefined) v.add(`No reliability was given for component "${id}".`, id, 'required');
    else if (!Number.isFinite(r)) v.add(`Reliability of component "${id}" must be finite.`, id, 'finite');
    else if (r < 0 || r > 1) v.add(`Reliability of component "${id}" is ${r}, outside [0, 1].`, id, 'range');
  }
  v.throwIfInvalid();

  const rSys = structureReliability(structure, reliabilities);
  const qSys = 1 - rSys;
  const notes: string[] = [];

  let cutSets: string[][] | null = null;
  try {
    cutSets = minimalCutSets(structure);
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    notes.push(
      'Minimal cut sets could not be enumerated for this structure, so Fussell–Vesely importance is unavailable: ' +
        e.message,
    );
  }
  if (cutSets && cutSets.length > 22) {
    notes.push(
      `This structure has ${cutSets.length} minimal cut sets; exact Fussell–Vesely by inclusion–exclusion is ` +
        'limited to 22 sets, so it is reported as undefined rather than approximated.',
    );
    cutSets = null;
  }

  const components: ComponentImportance[] = info.ids.map((id) => {
    const up = structureReliability(structure, { ...reliabilities, [id]: 1 });
    const down = structureReliability(structure, { ...reliabilities, [id]: 0 });
    const birnbaum = up - down;
    const q = 1 - reliabilities[id];
    const perfectSystem =
      'the system cannot fail under these inputs, so the conditional probability this measure divides by is zero';
    const criticality = qSys > 0 ? defined((birnbaum * q) / qSys) : undefinedMoment(perfectSystem);
    let fussellVesely: Moment;
    if (!cutSets) {
      fussellVesely = undefinedMoment('the minimal cut sets of this structure could not be enumerated exactly');
    } else if (qSys <= 0) {
      fussellVesely = undefinedMoment(perfectSystem);
    } else {
      const containing = cutSets.filter((c) => c.includes(id));
      fussellVesely = defined(
        containing.length === 0 ? 0 : inclusionExclusionUnion(containing, (cid) => 1 - reliabilities[cid]) / qSys,
      );
    }
    const raw = qSys > 0 ? defined((1 - down) / qSys) : undefinedMoment(perfectSystem);
    // Perfecting component i can make the system unfailable, which makes the
    // ratio unbounded rather than merely large. Infinity is a number the
    // interface would happily print, so report it as undefined with the reason.
    const rrw =
      1 - up > 0
        ? defined(qSys / (1 - up))
        : undefinedMoment(`perfecting component "${id}" removes every way the system can fail, so the ratio is unbounded`);
    return {
      id,
      reliability: reliabilities[id],
      birnbaum,
      criticality,
      fussellVesely,
      riskAchievementWorth: raw,
      riskReductionWorth: rrw,
    };
  });

  if (qSys <= 0) {
    notes.push(
      'The system is perfectly reliable under these inputs, so criticality, Fussell–Vesely and ' +
        'risk-worth ratios divide by the system failure probability, so they are reported as undefined with that ' +
        'reason rather than as a misleading 0.',
    );
  }

  const rank = (key: (c: ComponentImportance) => number): string[] =>
    [...components]
      .sort((a, b) => key(b) - key(a) || a.id.localeCompare(b.id))
      .map((c) => c.id);

  return {
    systemReliability: rSys,
    components,
    birnbaumRanking: rank((c) => c.birnbaum),
    // An undefined measure sorts last rather than being treated as zero.
    fussellVeselyRanking: rank((c) => (c.fussellVesely.defined ? c.fussellVesely.value : -1)),
    exactness: 'exact',
    independenceAssumed: true,
    independenceNote: INDEPENDENCE_ASSUMED_NOTE,
    notes,
  };
}
