// Central index for Physics Studio educational content.
// Each section module exports an object keyed by topic id. The aggregator
// merges them so ConceptExplainer can look up any topic by id.
// A safe fallback ensures the UI never breaks for a topic without a
// hand-written entry, but every shipped topic is covered explicitly.
import classical from './classical';
import em from './em';
import waves from './waves';
import thermo from './thermo';
import quantum from './quantum';
import qinfo from './qinfo';
import comp from './comp';
import astro from './astro';
import nuclear from './nuclear';
import fluid from './fluid';
import condensed from './condensed';
import vlab from './vlab';
import datalab from './datalab';
import research from './research';
import meta from './meta';

const DB = {
  ...classical, ...em, ...waves, ...thermo, ...quantum, ...qinfo, ...comp,
  ...astro, ...nuclear, ...fluid, ...condensed, ...vlab, ...datalab,
  ...research, ...meta,
};

export function getExplanation(topicId) {
  return DB[topicId] || null;
}

export function hasExplanation(topicId) {
  return Boolean(DB[topicId]);
}

export const EXPLANATION_COUNT = Object.keys(DB).length;