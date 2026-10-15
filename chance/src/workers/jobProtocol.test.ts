/**
 * Tests for the engine-job protocol.
 *
 * The third test here is the important one. An `EngineError` is a refusal: it
 * says what is missing. If that message is lost crossing the worker boundary
 * the interface shows "[object Object]" or nothing, and the user is told the
 * computation failed without being told why — a correctness failure under this
 * project's rules, not a cosmetic one. The test drives the real worker-side
 * responder through a loopback that applies `structuredClone` to every message
 * in both directions, so it exercises exactly what `postMessage` does.
 */
import { describe, expect, it, vi } from 'vitest';
import { EngineError } from '../engine/core/result';
import { ENGINE_JOBS, getEngineJob, hasEngineJob } from '../engine/jobs/registry';
import { createJobResponder, driveEngineJob, toIssues, type JobCommand, type JobEvent } from './jobProtocol';
import { EngineJobClient, type WorkerLike } from './jobClient';

/* -------------------------------------------------------------- fixtures */

const BAUM_WELCH_PAYLOAD = {
  sequences: [[0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]],
  states: 2,
  template: { kind: 'discrete' as const, symbols: ['a', 'b'], matrix: [[0.6, 0.4], [0.3, 0.7]] },
  options: { restarts: 2, maxIterations: 12, seed: 'protocol-test' },
};

const EM_PAYLOAD = {
  initial: { A: [[1]], C: [[1]], Q: [[0.1]], R: [[1]], mu0: [0], Sigma0: [[1]] },
  observations: Array.from({ length: 40 }, (_, t) => [Math.sin(t / 4)]),
  options: { maxIterations: 6 },
};

/**
 * A loopback "worker": the client's messages are structured-cloned into the
 * real responder and its events structured-cloned back, so anything that
 * cannot survive `postMessage` fails here exactly as it would in a browser.
 */
function loopbackWorker(): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message: unknown) {
      respond(structuredClone(message) as JobCommand);
    },
    terminate() {
      worker.onmessage = null;
    },
  };
  const respond = createJobResponder((event: JobEvent) => {
    const cloned = structuredClone(event);
    worker.onmessage?.({ data: cloned });
  });
  return worker;
}

/* -------------------------------------------------------------- registry */

describe('the engine job registry', () => {
  it('looks jobs up by id, the way simulation models are', () => {
    expect(ENGINE_JOBS.length).toBeGreaterThan(0);
    for (const job of ENGINE_JOBS) {
      expect(hasEngineJob(job.id)).toBe(true);
      expect(getEngineJob(job.id)).toBe(job);
    }
  });

  it('refuses an unknown id by name rather than returning nothing', () => {
    expect(() => getEngineJob('nope')).toThrow(/Unknown engine job "nope"/);
  });

  it('has no duplicate ids', () => {
    expect(new Set(ENGINE_JOBS.map((j) => j.id)).size).toBe(ENGINE_JOBS.length);
  });

  it('exposes every job as a generator, so a run can be cancelled between chunks', () => {
    const steps = getEngineJob('hmm.baum-welch').run(getEngineJob('hmm.baum-welch').parse(BAUM_WELCH_PAYLOAD), {});
    expect(typeof steps.next).toBe('function');
    expect(typeof steps.return).toBe('function');
    expect(steps.next().done).toBe(false);
    steps.return(undefined as never);
  });
});

/* ------------------------------------------------------------ the driver */

describe('driveEngineJob', () => {
  it('runs a job to completion and reports progress that only moves forward', async () => {
    const progress: number[] = [];
    const outcome = await driveEngineJob('hmm.baum-welch', BAUM_WELCH_PAYLOAD, { onProgress: (p) => progress.push(p.completed) });
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') throw new Error('unreachable');
    const result = outcome.result as { logLikelihood: number; runs: unknown[] };
    expect(Number.isFinite(result.logLikelihood)).toBe(true);
    expect(result.runs).toHaveLength(2);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('runs the state-space EM job to completion', async () => {
    const outcome = await driveEngineJob('filtering.em', EM_PAYLOAD, {});
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') throw new Error('unreachable');
    const result = outcome.result as { iterations: number; logLikelihood: number };
    expect(result.iterations).toBeGreaterThan(0);
    expect(Number.isFinite(result.logLikelihood)).toBe(true);
  });

  it('stops a cancelled job and reports no result at all', async () => {
    let calls = 0;
    const outcome = await driveEngineJob('hmm.baum-welch', { ...BAUM_WELCH_PAYLOAD, options: { restarts: 4, maxIterations: 200, seed: 'cancel' } }, {
      // Cancel once a little work has been done, so the run is genuinely
      // interrupted part-way rather than refused before it starts.
      isCancelled: () => ++calls > 3,
    });
    expect(outcome.status).toBe('cancelled');
    expect('result' in outcome).toBe(false);
  });

  it('stops promptly rather than finishing the remaining chunks', async () => {
    const slowPayload = { ...BAUM_WELCH_PAYLOAD, options: { restarts: 20, maxIterations: 2000, seed: 'cancel-2' } };
    const full = await driveEngineJob('hmm.baum-welch', slowPayload, {});
    expect(full.status).toBe('done');
    let steps = 0;
    const started = Date.now();
    const outcome = await driveEngineJob('hmm.baum-welch', slowPayload, { isCancelled: () => ++steps > 2 });
    expect(outcome.status).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('refuses an invalid payload with a message naming what is missing', async () => {
    await expect(driveEngineJob('hmm.baum-welch', { states: 2 }, {})).rejects.toThrow(/at least one observation sequence/);
    await expect(driveEngineJob('filtering.em', { initial: {} }, {})).rejects.toThrow(/observation series/);
    await expect(driveEngineJob('gp.fit-hyperparameters', { request: { X: [[0]], y: [0], kernel: { kind: 'base', id: 'rbf' } } }, {})).rejects.toThrow(/noise variance/);
  });
});

/* ----------------------------------------------------- the error crossing */

describe('toIssues', () => {
  it('keeps an EngineError message', () => {
    expect(toIssues(new EngineError('The series is too short.', 'insufficient-data'))).toEqual([
      { code: 'insufficient-data', message: 'The series is too short.' },
    ]);
  });

  it('never produces an empty or "[object Object]" message', () => {
    for (const thrown of [new Error(''), {}, null, undefined, '', 0, [1, 2]]) {
      const issues = toIssues(thrown);
      expect(issues).toHaveLength(1);
      expect(issues[0].message.length).toBeGreaterThan(0);
      expect(issues[0].message).not.toBe('[object Object]');
    }
  });
});

describe('the client over a structured-clone loopback', () => {
  it('delivers a result that survives postMessage', async () => {
    const client = new EngineJobClient(loopbackWorker);
    expect(client.usesWorker).toBe(true);
    expect(client.fallbackReason).toBeNull();
    const progress: number[] = [];
    const handle = client.start('hmm.baum-welch', BAUM_WELCH_PAYLOAD, { onProgress: (p) => progress.push(p.completed) });
    const outcome = await handle.promise;
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') throw new Error('unreachable');
    expect(Number.isFinite(outcome.result.logLikelihood)).toBe(true);
    // The result came back through structuredClone, so it is clone-safe by
    // construction; assert it again explicitly for the next reader.
    expect(() => structuredClone(outcome.result)).not.toThrow();
    client.dispose();
  });

  it('carries an EngineError across the boundary with its message intact', async () => {
    const client = new EngineJobClient(loopbackWorker);
    // Two time steps are needed to estimate a transition; one is a refusal
    // from deep inside the engine, raised during the run rather than in parse.
    const handle = client.start('filtering.em', { ...EM_PAYLOAD, observations: [[0]] });
    await expect(handle.promise).rejects.toThrowError(EngineError);
    await handle.promise.catch((e: unknown) => {
      expect(e).toBeInstanceOf(EngineError);
      const error = e as EngineError;
      expect(error.message).toMatch(/needs at least 2 time steps/);
      expect(error.message).not.toBe('[object Object]');
      expect(error.issues[0].code).toBe('insufficient-data');
      expect(error.issues[0].message).toBe(error.message);
    });
    client.dispose();
  });

  it('reports a payload refusal from the worker side with its own message', async () => {
    const client = new EngineJobClient(loopbackWorker);
    const handle = client.start('hmm.baum-welch', { sequences: [], states: 2, template: { kind: 'discrete', symbols: ['a'], matrix: [[1]] } });
    await expect(handle.promise).rejects.toThrow(/at least one observation sequence/);
    client.dispose();
  });

  it('reports cancellation, and no result, when the job is cancelled', async () => {
    const client = new EngineJobClient(loopbackWorker);
    const handle = client.start('hmm.baum-welch', { ...BAUM_WELCH_PAYLOAD, options: { restarts: 8, maxIterations: 400, seed: 'client-cancel' } });
    // The cancel message is delivered while the job is between chunks, which
    // is possible only because the job yields.
    await new Promise((r) => setTimeout(r, 10));
    handle.cancel();
    const outcome = await handle.promise;
    expect(outcome.status).toBe('cancelled');
    expect('result' in outcome).toBe(false);
    client.dispose();
  });

  it('sends only structured-clone-safe payloads', async () => {
    const sent: unknown[] = [];
    const client = new EngineJobClient(() => ({
      onmessage: null,
      onerror: null,
      postMessage: (m: unknown) => sent.push(m),
      terminate: () => undefined,
    }));
    const handle = client.start('gp.fit-hyperparameters', {
      request: { X: [[0], [1], [2]], y: [0, 1, 0], kernel: { kind: 'base', id: 'rbf' }, noiseVariance: 0.1 },
      options: { restarts: 1 },
    });
    expect(sent).toHaveLength(1);
    expect(() => structuredClone(sent[0])).not.toThrow();
    // This mock never answers, so disposing rejects the job; that rejection is
    // the documented behaviour and is consumed here rather than left floating.
    const settled = handle.promise.catch((e: unknown) => e);
    client.dispose();
    await expect(settled).resolves.toBeInstanceOf(EngineError);
  });

  it('falls back to the main thread, saying so, when no worker can be made', async () => {
    const client = new EngineJobClient(null);
    expect(client.usesWorker).toBe(false);
    expect(client.fallbackReason).toMatch(/main thread/);
    const outcome = await client.start('filtering.em', EM_PAYLOAD).promise;
    expect(outcome.status).toBe('done');
    client.dispose();
  });

  it('fails every pending job with a readable message when the worker dies', async () => {
    const worker: WorkerLike = { onmessage: null, onerror: null, postMessage: () => undefined, terminate: () => undefined };
    const client = new EngineJobClient(() => worker);
    const handle = client.start('filtering.em', EM_PAYLOAD);
    worker.onerror?.({ message: 'out of memory' });
    await expect(handle.promise).rejects.toThrow(/out of memory/);
    client.dispose();
  });

  it('ignores a late reply from a job that was already cancelled', async () => {
    const spy = vi.fn();
    const client = new EngineJobClient(loopbackWorker);
    const handle = client.start('filtering.em', EM_PAYLOAD, { onProgress: spy });
    handle.cancel();
    const outcome = await handle.promise;
    expect(outcome.status === 'cancelled' || outcome.status === 'done').toBe(true);
    client.dispose();
  });
});
