import { useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Stat, CopyBtn, Panel } from './shared';

const FIRST = ['Aarav', 'Meera', 'Rohan', 'Priya', 'Kabir', 'Ananya', 'Dev', 'Isha', 'Arjun', 'Nisha', 'Liam', 'Emma', 'Noah', 'Olivia', 'Sofia', 'Yuki'];
const LAST = ['Sharma', 'Patel', 'Rao', 'Iyer', 'Khan', 'Mehta', 'Smith', 'Johnson', 'Garcia', 'Müller', 'Tanaka', 'Silva'];
const CITY = ['Mumbai', 'Bengaluru', 'Delhi', 'Chennai', 'Pune', 'London', 'Berlin', 'Toronto', 'Sydney', 'Singapore', 'Tokyo'];
const JOB = ['Product Designer', 'Software Engineer', 'Data Analyst', 'Teacher', 'Nurse', 'Chef', 'Photographer', 'Accountant', 'Architect', 'Pilot'];
const COMPANY = ['Northwind', 'Lumen Labs', 'Vertex', 'Brightline', 'Kestrel', 'Orbit Works', 'Nimbus', 'Harbour Co'];
const DOMAIN = ['example.com', 'mail.test', 'sample.org'];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

const makeRow = () => {
  const first = pick(FIRST);
  const last = pick(LAST);
  return {
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@${pick(DOMAIN)}`,
    phone: `+91 ${Math.floor(6000000000 + Math.random() * 3999999999)}`,
    city: pick(CITY),
    job: pick(JOB),
    company: pick(COMPANY),
    joined: new Date(Date.now() - Math.floor(Math.random() * 1000 * 86400000)).toISOString().slice(0, 10),
  };
};

export default function FakeData() {
  const [count, setCount] = useState(8);
  const [rows, setRows] = useState([]);

  const run = () => setRows(Array.from({ length: Math.max(1, Math.min(200, Number(count) || 1)) }, makeRow));

  const columns = rows.length ? Object.keys(rows[0]) : [];
  const asCsv = [columns.join(',')].concat(rows.map((r) => columns.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(','))).join('\n');

  return (
    <div className="space-y-4">
      <ToolHeader icon={Database} title="Fake Data Generator" desc="Invent realistic sample records for testing tables, forms and exports." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How many records (1–200)">
          <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={run} className="gap-1.5"><RefreshCw className="h-3.5 w-3.5" /> Generate</Button>
          {rows.length > 0 && <CopyBtn value={JSON.stringify(rows, null, 2)} label="Copy JSON" />}
          {rows.length > 0 && <CopyBtn value={asCsv} label="Copy CSV" />}
        </div>
      </div>
      {rows.length > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Records" value={String(rows.length)} />
            <Stat label="Fields" value={String(columns.length)} />
            <Stat label="Cities" value={String(new Set(rows.map((r) => r.city)).size)} />
          </div>
          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-secondary/60">
                <tr>{columns.map((c) => <th key={c} className="px-3 py-2 font-semibold capitalize text-muted-foreground">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border/60">
                    {columns.map((c) => <td key={c} className="px-3 py-2">{r[c]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
          Press generate to create sample records.
        </div>
      )}
    </div>
  );
}