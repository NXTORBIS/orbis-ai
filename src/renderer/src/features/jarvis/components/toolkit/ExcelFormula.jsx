import { useMemo, useState } from 'react';
import { Search, Table } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';
import { Input } from '@jarvis/components/ui/input';

const FORMULAS = [
  { name: 'SUM', group: 'Maths', template: '=SUM(range)', args: [{ ph: 'range', label: 'Range', demo: 'B2:B100' }], note: 'Adds everything in a range. Ignores text and blanks.' },
  { name: 'SUMIF', group: 'Maths', template: '=SUMIF(criteriaRange, criteria, sumRange)', args: [{ ph: 'criteriaRange', label: 'Criteria range', demo: 'A2:A100' }, { ph: 'criteria', label: 'Criteria', demo: '"North"' }, { ph: 'sumRange', label: 'Sum range', demo: 'C2:C100' }], note: 'Sums only the rows that match a condition.' },
  { name: 'SUMIFS', group: 'Maths', template: '=SUMIFS(sumRange, range1, criteria1, range2, criteria2)', args: [{ ph: 'sumRange', label: 'Sum range', demo: 'C2:C100' }, { ph: 'range1', label: 'Range 1', demo: 'A2:A100' }, { ph: 'criteria1', label: 'Criteria 1', demo: '"North"' }, { ph: 'range2', label: 'Range 2', demo: 'B2:B100' }, { ph: 'criteria2', label: 'Criteria 2', demo: '">1000"' }], note: 'Multiple conditions, all of which must match.' },
  { name: 'AVERAGEIF', group: 'Maths', template: '=AVERAGEIF(range, criteria, averageRange)', args: [{ ph: 'range', label: 'Criteria range', demo: 'A2:A100' }, { ph: 'criteria', label: 'Criteria', demo: '"North"' }, { ph: 'averageRange', label: 'Average range', demo: 'C2:C100' }], note: 'Average of the values that pass a test.' },
  { name: 'ROUND', group: 'Maths', template: '=ROUND(number, digits)', args: [{ ph: 'number', label: 'Number', demo: 'A2' }, { ph: 'digits', label: 'Digits', demo: '2' }], note: 'Rounds half away from zero — the one people expect on money.' },
  { name: 'MOD', group: 'Maths', template: '=MOD(number, divisor)', args: [{ ph: 'number', label: 'Number', demo: 'A2' }, { ph: 'divisor', label: 'Divisor', demo: '2' }], note: 'Remainder after division. MOD(row,2)=0 marks even rows.' },
  { name: 'VLOOKUP', group: 'Lookup', template: '=VLOOKUP(lookupValue, tableRange, columnIndex, FALSE)', args: [{ ph: 'lookupValue', label: 'Look up', demo: 'A2' }, { ph: 'tableRange', label: 'Table', demo: 'Sheet2!A:D' }, { ph: 'columnIndex', label: 'Column', demo: '4' }], note: 'Searches the first column and returns from another. FALSE forces an exact match.' },
  { name: 'XLOOKUP', group: 'Lookup', template: '=XLOOKUP(lookupValue, lookupRange, returnRange, "not found")', args: [{ ph: 'lookupValue', label: 'Look up', demo: 'A2' }, { ph: 'lookupRange', label: 'Search in', demo: 'Data!A:A' }, { ph: 'returnRange', label: 'Return from', demo: 'Data!D:D' }], note: 'Modern replacement for VLOOKUP: any direction, exact by default, easy fallback.' },
  { name: 'INDEX + MATCH', group: 'Lookup', template: '=INDEX(returnRange, MATCH(lookupValue, lookupRange, 0))', args: [{ ph: 'returnRange', label: 'Return from', demo: 'D:D' }, { ph: 'lookupValue', label: 'Look up', demo: 'A2' }, { ph: 'lookupRange', label: 'Search in', demo: 'A:A' }], note: 'Works left as well as right, and survives columns being inserted.' },
  { name: 'FILTER', group: 'Lookup', template: '=FILTER(array, condition, "none")', args: [{ ph: 'array', label: 'Data', demo: 'A2:D100' }, { ph: 'condition', label: 'Condition', demo: 'C2:C100>1000' }], note: 'Spills every matching row. Far better than copying formulas down.' },
  { name: 'UNIQUE', group: 'Lookup', template: '=UNIQUE(range)', args: [{ ph: 'range', label: 'Range', demo: 'A2:A100' }], note: 'One row per distinct value — the fastest way to build a list.' },
  { name: 'IF', group: 'Logic', template: '=IF(condition, valueIfTrue, valueIfFalse)', args: [{ ph: 'condition', label: 'Condition', demo: 'C2>1000' }, { ph: 'valueIfTrue', label: 'If true', demo: '"high"' }, { ph: 'valueIfFalse', label: 'If false', demo: '"low"' }], note: 'The basic branch. Nest IFs sparingly; IFS reads better.' },
  { name: 'IFS', group: 'Logic', template: '=IFS(test1, result1, test2, result2, TRUE, "other")', args: [{ ph: 'test1', label: 'Test 1', demo: 'A2>90' }, { ph: 'result1', label: 'Result 1', demo: '"A"' }, { ph: 'test2', label: 'Test 2', demo: 'A2>80' }], note: 'Multiple conditions in order. The TRUE branch catches everything left.' },
  { name: 'IFERROR', group: 'Logic', template: '=IFERROR(expression, valueIfError)', args: [{ ph: 'expression', label: 'Expression', demo: 'A2/B2' }, { ph: 'valueIfError', label: 'If error', demo: '0' }], note: 'Hides #DIV/0 and #N/A without hiding real mistakes — use it deliberately.' },
  { name: 'AND / OR', group: 'Logic', template: '=AND(test1, test2)', args: [{ ph: 'test1', label: 'Test 1', demo: 'A2>0' }, { ph: 'test2', label: 'Test 2', demo: 'B2<100' }], note: 'Combines conditions inside IF or conditional formatting.' },
  { name: 'COUNTIF', group: 'Counting', template: '=COUNTIF(range, criteria)', args: [{ ph: 'range', label: 'Range', demo: 'A2:A100' }, { ph: 'criteria', label: 'Criteria', demo: '"North"' }], note: 'How many entries match. Wildcards work: "N*" counts anything starting with N.' },
  { name: 'COUNTIFS', group: 'Counting', template: '=COUNTIFS(range1, criteria1, range2, criteria2)', args: [{ ph: 'range1', label: 'Range 1', demo: 'A2:A100' }, { ph: 'criteria1', label: 'Criteria 1', demo: '"North"' }, { ph: 'range2', label: 'Range 2', demo: 'D2:D100' }, { ph: 'criteria2', label: 'Criteria 2', demo: '">=2025-01-01"' }], note: 'Counts rows meeting every condition you give it.' },
  { name: 'COUNTA', group: 'Counting', template: '=COUNTA(range)', args: [{ ph: 'range', label: 'Range', demo: 'A2:A100' }], note: 'Counts non-empty cells, text included — useful for response tracking.' },
  { name: 'TEXT', group: 'Text', template: '=TEXT(value, "format")', args: [{ ph: 'value', label: 'Value', demo: 'A2' }, { ph: 'format', label: 'Format', demo: '"0.0%"' }], note: 'Numbers into styled text. Remember the result is text, not a number.' },
  { name: 'CONCAT / TEXTJOIN', group: 'Text', template: '=TEXTJOIN(delimiter, ignoreEmpty, range)', args: [{ ph: 'delimiter', label: 'Separator', demo: '", "' }, { ph: 'ignoreEmpty', label: 'Skip blanks', demo: 'TRUE' }, { ph: 'range', label: 'Range', demo: 'A2:A20' }], note: 'Joins a whole range with a separator — no more & chains.' },
  { name: 'LEFT / RIGHT / MID', group: 'Text', template: '=MID(text, start, length)', args: [{ ph: 'text', label: 'Text', demo: 'A2' }, { ph: 'start', label: 'Start', demo: '4' }, { ph: 'length', label: 'Length', demo: '2' }], note: 'Slices text by position. Combine with FIND to split codes and names.' },
  { name: 'TRIM / CLEAN', group: 'Text', template: '=TRIM(CLEAN(text))', args: [{ ph: 'text', label: 'Text', demo: 'A2' }], note: 'Strips the stray spaces and non-printing characters that break lookups.' },
  { name: 'SUBSTITUTE', group: 'Text', template: '=SUBSTITUTE(text, old, new)', args: [{ ph: 'text', label: 'Text', demo: 'A2' }, { ph: 'old', label: 'Find', demo: '"Ltd"' }, { ph: 'new', label: 'Replace', demo: '"Limited"' }], note: 'Replaces every occurrence. Case-sensitive, unlike Find & Replace.' },
  { name: 'TODAY / NOW', group: 'Dates', template: '=TODAY()', args: [], note: 'Today at midnight, volatile — it recalculates every time the sheet opens.' },
  { name: 'DATEDIF', group: 'Dates', template: '=DATEDIF(start, end, "Y")', args: [{ ph: 'start', label: 'Start', demo: 'A2' }, { ph: 'end', label: 'End', demo: 'TODAY()' }], note: 'Complete years, months or days between two dates. Undocumented but reliable.' },
  { name: 'EOMONTH', group: 'Dates', template: '=EOMONTH(startDate, months)', args: [{ ph: 'startDate', label: 'Start', demo: 'A2' }, { ph: 'months', label: 'Months', demo: '0' }], note: 'The last day of a month, offset by any number of months — month-end reporting.' },
  { name: 'NETWORKDAYS', group: 'Dates', template: '=NETWORKDAYS(start, end, holidays)', args: [{ ph: 'start', label: 'Start', demo: 'A2' }, { ph: 'end', label: 'End', demo: 'B2' }, { ph: 'holidays', label: 'Holidays', demo: 'H:H' }], note: 'Working days between two dates, weekends excluded.' },
  { name: 'WEEKDAY', group: 'Dates', template: '=WEEKDAY(date, 2)', args: [{ ph: 'date', label: 'Date', demo: 'A2' }], note: 'Day number with Monday as 1. Weekends are where the result is 6 or 7.' },
];

const GROUPS = ['Maths', 'Lookup', 'Logic', 'Counting', 'Text', 'Dates'];

export default function ExcelFormula() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('Maths');
  const [selected, setSelected] = useState('SUMIFS');
  const [values, setValues] = useState({});

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return FORMULAS.filter((formula) => {
      const matchesGroup = search ? true : formula.group === group;
      const matchesSearch = !search || formula.name.toLowerCase().includes(search) || formula.note.toLowerCase().includes(search);
      return matchesGroup && matchesSearch;
    });
  }, [query, group]);

  const active = useMemo(() => FORMULAS.find((formula) => formula.name === selected) || FORMULAS[0], [selected]);

  const built = useMemo(() => {
    let output = active.template;
    active.args.forEach((arg) => {
      const value = values[active.name + ':' + arg.ph];
      output = output.split(arg.ph).join(value && value.trim() ? value.trim() : arg.demo);
    });
    return output;
  }, [active, values]);

  const placeholderCount = active.args.length;
  const demo = useMemo(() => {
    let output = active.template;
    active.args.forEach((arg) => { output = output.split(arg.ph).join(arg.demo); });
    return output;
  }, [active]);

  const report = useMemo(() => [
    active.name + ' — ' + active.group,
    active.template,
    '',
    active.note,
    '',
    'Filled: ' + built,
    'Example: ' + demo,
  ].join('\n'), [active, built, demo]);

  const setValue = (ph, value) => setValues((current) => ({ ...current, [active.name + ':' + ph]: value }));

  return (
    <ToolShell
      toolId="excel-formula"
      icon={Table}
      title="Spreadsheet Formula Builder"
      desc="Twenty-eight formulas that do real work, each explained, filled in with your own cells and ready to paste into Excel or Sheets."
      state={{ query, group, selected, values }}
      onRestore={(restored) => {
        if (typeof restored.query === 'string') setQuery(restored.query);
        if (restored.group) setGroup(restored.group);
        if (restored.selected) setSelected(restored.selected);
        if (restored.values && typeof restored.values === 'object') setValues(restored.values);
      }}
      exportText={report}
      exportName="formula.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Field label="Search formulas">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="lookup, round, count how many…" className="pl-9" />
          </div>
        </Field>
        <div className="flex flex-wrap items-end gap-1.5">
          {GROUPS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => { setGroup(name); setQuery(''); }}
              className={!query && group === name
                ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1.5 text-xs text-cyan-j'
                : 'rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition hover:text-foreground'}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((formula) => (
          <button
            key={formula.name}
            type="button"
            onClick={() => setSelected(formula.name)}
            className={formula.name === active.name
              ? 'tk-card tk-depth rounded-xl border border-cyan-j/50 bg-cyan-j/10 p-2.5 text-left'
              : 'tk-card tk-depth rounded-xl border border-border/70 bg-card/50 p-2.5 text-left'}
          >
            <div className={formula.name === active.name ? 'font-mono-j text-[12px] text-cyan-j' : 'font-mono-j text-[12px]'}>{formula.name}</div>
            <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{formula.note}</div>
          </button>
        ))}
        {!filtered.length && <span className="text-[11px] text-muted-foreground">Nothing matches "{query}" — try a keyword like "count" or "lookup".</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={active.name}
          value={built.length > 42 ? built.slice(0, 42) + '…' : built}
          sub={active.note}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Copy it</div>
          <div className="space-y-2">
            <div className="rounded-lg border border-cyan-j/40 bg-cyan-j/5 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Your version</div>
              <div className="break-all font-mono-j text-[11px] text-cyan-j">{built}</div>
              <div className="mt-2"><CopyBtn value={built} label="Copy formula" /></div>
            </div>
            <div className="rounded-lg border border-border/50 bg-card/40 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Worked example</div>
              <div className="break-all font-mono-j text-[11px] text-muted-foreground">{demo}</div>
              <div className="mt-2"><CopyBtn value={demo} label="Copy example" /></div>
            </div>
          </div>
        </Panel>
      </div>

      {placeholderCount > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Fill in your own references</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {active.args.map((arg) => (
              <Field key={arg.ph} label={arg.label}>
                <input
                  value={values[active.name + ':' + arg.ph] || ''}
                  onChange={(e) => setValue(arg.ph, e.target.value)}
                  placeholder={arg.demo}
                  spellCheck={false}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
                />
              </Field>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Leave a box empty to keep the example value. Everything is plain text — the formula updates as you type, so you can see the shape before pasting it.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How it reads</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· <span className="font-mono-j text-cyan-j">{active.template}</span></p>
            <p>· {active.note}</p>
            <p>· Arguments are positional, separated by commas (semicolons in some locales). Every bracket must close.</p>
            <p>· Absolute references with $ — <span className="font-mono-j">$A$2</span> — stop ranges drifting when the formula is dragged down.</p>
            <p>· Wrap anything in IFERROR when a blank cell could produce #DIV/0 or #N/A in a report somebody else will read.</p>
            <p>· Prefer SUMIFS, COUNTIFS and XLOOKUP over their older cousins; they are clearer and faster on large sheets.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The formulas worth memorising</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· SUMIFS covers most "how much of X, where Y" questions without a pivot table.</p>
            <p>· XLOOKUP or INDEX+MATCH joins two tables reliably; VLOOKUP breaks the moment a column is inserted.</p>
            <p>· FILTER and UNIQUE turn a static sheet into something that updates itself.</p>
            <p>· TRIM and CLEAN before a lookup solve a surprising share of "the value is definitely there" problems.</p>
            <p>· TEXT for display, never for further maths — it returns text, and text will not sum.</p>
            <p>· TODAY and NOW recalculate constantly; put them in one cell and reference that rather than scattering them.</p>
          </div>
          <div className="mt-3">
            <CopyBtn value={report} label="Copy this explainer" />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Formulas" value={String(FORMULAS.length)} mono />
        <Stat label="Showing" value={String(filtered.length)} mono sub={query ? 'search results' : group} />
        <Stat label="Arguments" value={String(placeholderCount)} mono sub="to fill" />
        <Stat label="Length" value={String(built.length)} mono sub="characters" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Building formulas that survive</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Name your ranges. A formula reading Revenue minus Cost is reviewable; one full of C2:C487 is not.</p>
          <p>· Keep one idea per cell. Long nested formulas are impossible to audit and are the usual source of a wrong number nobody spots.</p>
          <p>· Test the edge cases: an empty row, a zero, a text value where a number should be. That is where the ugly errors live.</p>
          <p>· Prefer a helper column to a monster formula — you can see the intermediate result, and so can whoever inherits the sheet.</p>
          <p>· If a sheet needs dozens of these, it is telling you to move the data to where it can be queried instead.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Selected', value: active.name },
              { label: 'Group', value: active.group },
              { label: 'Arguments', value: String(placeholderCount) },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every entry here is a real formula with its argument order preserved, and the builder substitutes your references into the exact positions Excel
          expects — so what you copy is valid syntax rather than a description of it. The examples use conventional ranges you can swap for your own without
          changing the structure.
        </p>
      </Panel>
    </ToolShell>
  );
}