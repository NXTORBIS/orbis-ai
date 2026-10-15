/** Shared measuring helpers for the Connection Doctor. */

export const hostOf = (value) =>
  String(value || '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();

export const urlOf = (value) => {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/\/+$/, '')}/`;
};

export const isIp = (value) => /^(\d{1,3}\.){3}\d{1,3}$/.test(hostOf(value));

export const reverseName = (ip) => `${hostOf(ip).split('.').reverse().join('.')}.in-addr.arpa`;

export const bust = (url) => `${url}${url.includes('?') ? '&' : '?'}_=${Math.random().toString(36).slice(2)}`;

export const stats = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: at(0.5),
    p95: at(0.95),
    count: values.length,
  };
};

/** How much each measurement differs from the one before it — the number calls and games feel. */
export const jitterOf = (values) => {
  if (values.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < values.length; i += 1) total += Math.abs(values[i] - values[i - 1]);
  return total / (values.length - 1);
};

/**
 * One timed request. `no-cors` means any host answers and we measure the round trip
 * rather than the content — which is exactly what a ping measures.
 */
export const probe = async (url, signal) => {
  const started = performance.now();
  await fetch(url, { mode: 'no-cors', cache: 'no-store', signal });
  return performance.now() - started;
};

export const bars = (values, every = 4) =>
  values.map((value, index) => ({ label: index % every === 0 ? String(index + 1) : '', value: Math.round(value) }));

export const round = (value) => Math.round(value);

export const pingVerdict = (median, loss) => {
  if (loss >= 10) return { label: 'Lossy', tone: 'rose', note: `${loss}% of probes never came back. Loss hurts far more than latency — check Wi-Fi signal and cables first.` };
  if (!median) return { label: 'No answer', tone: 'rose', note: 'Nothing came back at all. The host may block requests, be offline, or only answer on a plain-HTTP port a browser cannot reach.' };
  if (median < 40) return { label: 'Excellent', tone: 'emerald', note: 'Under 40 ms — comfortable for video calls, remote desktops and games.' };
  if (median < 90) return { label: 'Good', tone: 'cyan', note: 'Fine for calls and general use; gaming will feel slightly behind.' };
  if (median < 180) return { label: 'Sluggish', tone: 'amber', note: 'Noticeable on calls and page loads. Distance or an overloaded route is the usual cause.' };
  return { label: 'Poor', tone: 'rose', note: 'Every interaction waits on this. Try a closer target to see whether it is the route or your own link.' };
};

export const bloatGrade = (idle, loaded) => {
  const increase = loaded - idle;
  if (increase < 30) return { grade: 'A', tone: 'emerald', label: 'No bufferbloat', increase };
  if (increase < 60) return { grade: 'B', tone: 'cyan', label: 'Slight buffering under load', increase };
  if (increase < 100) return { grade: 'C', tone: 'amber', label: 'Noticeable bufferbloat', increase };
  if (increase < 200) return { grade: 'D', tone: 'rose', label: 'Heavy bufferbloat', increase };
  return { grade: 'F', tone: 'rose', label: 'Severe bufferbloat', increase };
};