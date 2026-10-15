// @ts-nocheck -- ported unchanged from the Jarvis project's backend function of the same name; only the import line differs.
import { createClientFromRequest } from './local'

const SOURCES = [
  {
    name: 'ExchangeRate-API',
    url: (base: string) => `https://open.er-api.com/v6/latest/${base}`,
    read: (data: any) => ({
      date: data?.time_last_update_utc ?? data?.time_last_update_unix ?? '',
      rates: data?.rates && typeof data.rates === 'object' ? data.rates : null,
    }),
  },
  {
    name: 'Frankfurter (ECB)',
    url: (base: string) => `https://api.frankfurter.app/latest?from=${base}`,
    read: (data: any) => ({
      date: data?.date ?? '',
      rates: data?.rates && typeof data.rates === 'object' ? { ...data.rates, [base]: 1 } : null,
    }),
  },
];

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const base = String(body?.base ?? 'USD').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD';

    const failures = [];
    for (const source of SOURCES) {
      try {
        const response = await fetch(source.url(base), { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          failures.push(`${source.name} responded ${response.status}`);
          continue;
        }
        const { date, rates } = source.read(await response.json());
        if (!rates || Object.keys(rates).length < 10) {
          failures.push(`${source.name} returned no usable table`);
          continue;
        }
        return Response.json({
          ok: true,
          base,
          date,
          source: source.name,
          count: Object.keys(rates).length,
          rates,
        });
      } catch (error) {
        failures.push(`${source.name}: ${error?.message ?? 'failed'}`);
      }
    }

    return Response.json({ error: `Live rates are unavailable right now (${failures.join('; ')}).` }, { status: 502 });
  } catch (error) {
    return Response.json({ error: error?.message ?? 'The rate lookup failed.' }, { status: 500 });
  }
}