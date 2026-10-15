import { useState } from 'react';
import { KeySquare } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const TYPES = [
  { value: 'uuid4', label: 'UUID v4' },
  { value: 'uuid7', label: 'UUID v7' },
  { value: 'ulid', label: 'ULID' },
  { value: 'objectid', label: 'ObjectId' },
  { value: 'short', label: 'Short id' },
  { value: 'nanoid', label: 'Custom' },
];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SAFE64 = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const HUMAN = '346789abcdefghjkmnpqrstuvwxyz'; // no look-alike characters

const bytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (arr) => Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');

const uuid4 = () => {
  const b = bytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const uuid7 = () => {
  const b = new Uint8Array(16);
  let t = Date.now();
  for (let i = 5; i >= 0; i--) { b[i] = t & 0xff; t = Math.floor(t / 256); }
  b.set(bytes(10), 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const ulid = () => {
  let t = Date.now();
  const time = Array.from({ length: 10 }, () => {
    const chunk = CROCKFORD[t & 31];
    t = Math.floor(t / 32);
    return chunk;
  }).reverse().join('');
  const random = Array.from(bytes(16), (b) => CROCKFORD[b & 31]).join('');
  return `${time}${random}`;
};

const objectId = () => {
  let t = Math.floor(Date.now() / 1000);
  const stamp = Array.from({ length: 4 }, () => {
    const b = t & 0xff;
    t = Math.floor(t / 256);
    return b.toString(16).padStart(2, '0');
  }).reverse().join('');
  return `${stamp}${hex(bytes(5))}${hex(bytes(3))}`;
};

const randomFrom = (alphabet, length) => {
  let out = '';
  while (out.length < length) {
    const chunk = bytes(length * 2);
    for (const b of chunk) {
      if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
};

export default function IdTokenGenerator() {
  const [type, setType] = useState('uuid4');
  const [count, setCount] = useState(5);
  const [length, setLength] = useState(21);
  const [human, setHuman] = useState(false);
  const [values, setValues] = useState(() => Array.from({ length: 5 }, uuid4));

  const make = (kind, howMany, len, safe) => Array.from({ length: howMany }, () => {
    if (kind === 'uuid4') return uuid4();
    if (kind === 'uuid7') return uuid7();
    if (kind === 'ulid') return ulid();
    if (kind === 'objectid') return objectId();
    if (kind === 'short') return randomFrom(BASE62, 8);
    return randomFrom(safe ? HUMAN : SAFE64, len);
  });

  const regenerate = (next = {}) => {
    const kind = next.type || type;
    const howMany = next.count ?? count;
    const len = next.length ?? length;
    const safe = next.human ?? human;
    setValues(make(kind, howMany, len, safe));
  };

  const changeType = (kind) => { setType(kind); regenerate({ type: kind }); };
  const changeCount = (n) => { setCount(n); regenerate({ count: n }); };

  const all = values.join('\n');
  const bits = type === 'uuid4' || type === 'uuid7' ? 122 : type === 'ulid' ? 80 : type === 'objectid' ? 64 : type === 'short' ? 48 : Math.round(length * Math.log2(human ? HUMAN.length : SAFE64.length));

  return (
    <ToolShell
      toolId="token"
      icon={KeySquare}
      title="ID & Token Generator"
      desc="UUIDs, ULIDs, ObjectIds and custom ids — generated with the browser's cryptographic randomness."
      state={{ type, count, length, human, values }}
      onRestore={(saved) => {
        if (saved.type) setType(saved.type);
        setCount(saved.count ?? 5);
        setLength(saved.length ?? 21);
        setHuman(!!saved.human);
        if (Array.isArray(saved.values) && saved.values.length) setValues(saved.values);
      }}
      exportText={all}
      exportName="ids.txt"
    >
      <Field label="Kind">
        <Seg value={type} onChange={changeType} options={TYPES} />
      </Field>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">{values.length} generated</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => regenerate()} className="text-[11px] text-cyan-j transition hover:underline">
              Regenerate
            </button>
            <CopyBtn value={all} label="Copy all" />
          </div>
        </div>
        <div className="max-h-72 space-y-1 overflow-auto scrollbar-thin">
          {values.map((v, i) => (
            <div key={`${v}-${i}`} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
              <span className="w-6 shrink-0 text-[10px] text-muted-foreground">#{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-mono-j text-[11px]">{v}</span>
              <CopyBtn value={v} />
            </div>
          ))}
        </div>
      </Panel>

      <Field label={`How many · ${count}`}>
        <input type="range" min={1} max={50} value={count} onChange={(e) => changeCount(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      {type === 'nanoid' && (
        <Field label={`Length · ${length} characters`}>
          <input type="range" min={6} max={64} value={length} onChange={(e) => { setLength(Number(e.target.value)); regenerate({ length: Number(e.target.value) }); }} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      )}

      {type === 'nanoid' && (
        <ToggleRow
          label="Avoid look-alike characters"
          checked={human}
          onChange={(v) => { setHuman(v); regenerate({ human: v }); }}
          hint="no 0/O, 1/l/I"
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Kind" value={type === 'nanoid' ? `${length}-char id` : TYPES.find((t) => t.value === type)?.label} />
        <Stat label="Randomness" value={`≈${bits} bits`} mono />
        <Stat label="Alphabet" value={type === 'nanoid' ? String(human ? HUMAN.length : SAFE64.length) : type === 'ulid' ? '32' : '16'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          UUID v4 and v7 differ in one useful way: v7 starts with a timestamp, so ids sort in the order they were created and database indexes stay
          happy. ULIDs do the same with a shorter, case-insensitive alphabet. Keep these ids for keys and handles — not as secrets.
        </p>
      </Panel>
    </ToolShell>
  );
}