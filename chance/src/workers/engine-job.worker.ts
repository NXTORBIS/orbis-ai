/**
 * Engine-job worker.
 *
 * Thin: it wires `self` to the protocol in `jobProtocol.ts`, which is also
 * what the main-thread fallback and the tests use. Everything about the
 * protocol — job lookup, yielding between chunks so `cancel` is received, and
 * sending refusals as issues so the message survives — lives there.
 */
import { createJobResponder, type JobCommand } from './jobProtocol';

const respond = createJobResponder((event) => self.postMessage(event));

self.onmessage = (event: MessageEvent<JobCommand>) => respond(event.data);
