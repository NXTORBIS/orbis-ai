import { normalCDF, logGamma } from '@jarvis/components/toolkit/wave2/math';
export { normalCDF } from '@jarvis/components/toolkit/wave2/math';
export function inverseNormal(probability) {
  let low = -9, high = 9;
  for (let i = 0; i < 64; i++) { const middle = (low + high) / 2; if (normalCDF(middle) < probability) low = middle; else high = middle; }
  return (low + high) / 2;
}
export function erlangB(traffic, servers) {
  let blocking = 1;
  for (let i = 1; i <= servers; i++) blocking = traffic * blocking / (i + traffic * blocking);
  return blocking;
}
export function erlangC(arrivals, service, servers) {
  const traffic = arrivals / service, utilization = traffic / servers, blocking = erlangB(traffic, servers);
  return blocking / (1 - utilization + utilization * blocking);
}
export const poissonPMF = (mean, k) => mean === 0 ? (k === 0 ? 1 : 0) : Math.exp(-mean + k * Math.log(mean) - logGamma(k + 1));
export function poissonCDF(mean, k) { let sum = 0; for (let i = 0; i <= k; i++) sum += poissonPMF(mean, i); return Math.min(1, sum); }