import { useMemo, useState } from 'react';
import { Utensils } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MEALS = ['Breakfast', 'Lunch', 'Dinner'];

const emptyWeek = () => Object.fromEntries(DAYS.map((day) => [day, MEALS.map(() => ({ name: '', kcal: '', protein: '' }))]));

const START_TARGETS = { kcal: '2200', protein: '140' };

export default function MealPlanner() {
  const [week, setWeek] = useState(emptyWeek);
  const [targets, setTargets] = useState(START_TARGETS);

  const updateMeal = (day, index, patch) => setWeek((current) => ({
    ...current,
    [day]: current[day].map((meal, mealIndex) => (mealIndex === index ? { ...meal, ...patch } : meal)),
  }));

  const analysis = useMemo(() => {
    const dayTotals = DAYS.map((day) => {
      const meals = week[day];
      const kcal = meals.reduce((sum, meal) => sum + (Number(meal.kcal) || 0), 0);
      const protein = meals.reduce((sum, meal) => sum + (Number(meal.protein) || 0), 0);
      const planned = meals.filter((meal) => meal.name.trim()).length;
      return { day, kcal, protein, planned };
    });
    const plannedDays = dayTotals.filter((row) => row.planned > 0);
    const weekKcal = dayTotals.reduce((sum, row) => sum + row.kcal, 0);
    const weekProtein = dayTotals.reduce((sum, row) => sum + row.protein, 0);
    const targetKcal = Number(targets.kcal) || 0;
    const targetProtein = Number(targets.protein) || 0;
    const averageKcal = plannedDays.length ? weekKcal / plannedDays.length : 0;
    const averageProtein = plannedDays.length ? weekProtein / plannedDays.length : 0;
    const off = dayTotals.filter((row) => row.planned && targetKcal && Math.abs(row.kcal - targetKcal) > targetKcal * 0.15);
    const mealNames = DAYS.flatMap((day) => week[day].map((meal) => meal.name)).filter((name) => name.trim());
    const uniqueMeals = [...new Set(mealNames.map((name) => name.trim().toLowerCase()))];
    const mostRepeated = mealNames.length ? Object.entries(mealNames.reduce((counts, name) => {
      const key = name.trim().toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {})).sort((a, b) => b[1] - a[1])[0] : null;

    return {
      dayTotals, weekKcal, weekProtein, averageKcal, averageProtein, off, plannedDays: plannedDays.length,
      uniqueCount: uniqueMeals.length, mostRepeated,
      coverage: (plannedDays.length / DAYS.length) * 100,
    };
  }, [week, targets]);

  const report = [
    `Weekly meal plan · target ${targets.kcal} kcal and ${targets.protein} g protein a day`,
    ...DAYS.map((day) => {
      const row = analysis.dayTotals.find((entry) => entry.day === day);
      const meals = week[day].filter((meal) => meal.name.trim()).map((meal) => meal.name).join(', ');
      return `${day}: ${meals || 'nothing planned'} — ${row.kcal} kcal, ${row.protein} g protein`;
    }),
    '',
    `Average ${Math.round(analysis.averageKcal)} kcal and ${Math.round(analysis.averageProtein)} g protein across ${analysis.plannedDays} planned days`,
    `Week total ${analysis.weekKcal} kcal, ${analysis.weekProtein} g protein`,
  ].join('\n');

  return (
    <ToolShell
      toolId="meal-planner"
      icon={Utensils}
      title="Weekly Meal Planner"
      desc="Lay out a week of meals and watch the calories and protein add up per day — so you can see a low-protein Tuesday before it happens."
      state={{ week, targets }}
      onRestore={(restored) => {
        if (restored.week && typeof restored.week === 'object') setWeek({ ...emptyWeek(), ...restored.week });
        if (restored.targets) setTargets({ ...START_TARGETS, ...restored.targets });
      }}
      exportText={report}
      exportName="meal-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy the week" />
        <button
          type="button"
          onClick={() => setWeek(emptyWeek())}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-rose-400/50 hover:text-rose-400"
        >
          Clear the week
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Daily calorie target">
          <input value={targets.kcal} onChange={(e) => setTargets({ ...targets, kcal: e.target.value })} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Daily protein target (g)">
          <input value={targets.protein} onChange={(e) => setTargets({ ...targets, protein: e.target.value })} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Calories per week">
          <div className="flex h-9 items-center justify-end font-mono-j text-sm text-cyan-j">{(Number(targets.kcal) || 0) * 7} kcal</div>
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {DAYS.map((day) => {
          const row = analysis.dayTotals.find((entry) => entry.day === day);
          const kcalPct = targets.kcal ? ((row.kcal / Number(targets.kcal)) * 100) : 0;
          return (
            <div key={day} className="tk-card tk-depth tk-topline relative overflow-hidden rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
              <span aria-hidden className="tk-shine pointer-events-none absolute inset-0" />
              <div className="relative mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">{day}</span>
                <span className={`font-mono-j text-[10px] ${kcalPct > 115 || (kcalPct && kcalPct < 85) ? 'text-amber-400' : 'text-cyan-j'}`}>{row.kcal} kcal</span>
              </div>
              <div className="relative space-y-2">
                {MEALS.map((label, index) => (
                  <div key={label}>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
                    <input
                      value={week[day][index].name}
                      onChange={(e) => updateMeal(day, index, { name: e.target.value })}
                      placeholder="meal"
                      className="h-7 w-full rounded-md border border-input bg-transparent px-2 text-[11px]"
                    />
                    <div className="mt-0.5 grid grid-cols-2 gap-1">
                      <input
                        value={week[day][index].kcal}
                        onChange={(e) => updateMeal(day, index, { kcal: e.target.value })}
                        inputMode="numeric"
                        placeholder="kcal"
                        className="h-6 rounded-md border border-input bg-transparent px-1.5 text-right font-mono-j text-[10px]"
                      />
                      <input
                        value={week[day][index].protein}
                        onChange={(e) => updateMeal(day, index, { protein: e.target.value })}
                        inputMode="numeric"
                        placeholder="g pro"
                        className="h-6 rounded-md border border-input bg-transparent px-1.5 text-right font-mono-j text-[10px]"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="relative mt-2 border-t border-border/50 pt-1.5 font-mono-j text-[10px] text-muted-foreground">
                {row.protein} g protein · {row.planned ? `${(row.protein / Math.max(1, row.kcal) * 100).toFixed(0)}% of kcal` : 'nothing planned'}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Average day so far"
          value={analysis.averageKcal ? Math.round(analysis.averageKcal).toLocaleString() : '0'}
          unit="kcal"
          sub={`${Math.round(analysis.averageProtein)} g protein a day across ${analysis.plannedDays} of 7 days planned`}
        />
        <Ring
          value={analysis.averageProtein}
          max={Number(targets.protein) || 1}
          tone={analysis.averageProtein >= Number(targets.protein) * 0.9 ? 'emerald' : 'amber'}
          label="Protein against target"
          sub={`${Math.round(analysis.averageProtein)} g of ${targets.protein} g a day`}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Calories per day against your target</div>
        <Bars
          data={analysis.dayTotals.map((row) => ({ label: row.day, value: row.kcal }))}
          format={(value) => (value / 1000).toFixed(1)}
          suffix="k"
          highlightLast={false}
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Target line is {targets.kcal} kcal. {analysis.off.length
            ? `${analysis.off.map((row) => row.day).join(', ')} drift more than 15% away from it.`
            : 'Every planned day sits within 15% of the target.'}
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Days planned" value={`${analysis.plannedDays}/7`} mono sub={`${analysis.coverage.toFixed(0)}% of the week`} />
        <Stat label="Week calories" value={analysis.weekKcal.toLocaleString()} mono />
        <Stat label="Week protein" value={`${analysis.weekProtein.toLocaleString()} g`} mono />
        <Stat label="Distinct meals" value={String(analysis.uniqueCount)} mono sub={analysis.mostRepeated ? `"${analysis.mostRepeated[0]}" ×${analysis.mostRepeated[1]}` : 'nothing repeated'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Planning that survives a Tuesday</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Repeat breakfasts deliberately — {analysis.mostRepeated ? `"${analysis.mostRepeated[0]}" already appears ${analysis.mostRepeated[1]} times` : 'pick one breakfast and stop deciding'}. Fewer decisions on the day is the whole point.</p>
          <p>· Aim for 25–35 g of protein per main meal; {analysis.averageProtein < Number(targets.protein) ? 'your week currently lands under target, so add a protein anchor to breakfast.' : 'your week clears the target comfortably.'}</p>
          <p>· Plan the shop from the plan, not the other way around: {analysis.uniqueCount} distinct meals means roughly {Math.max(6, Math.round(analysis.uniqueCount * 2.5))} ingredients to buy.</p>
          <p>· Leave one day unplanned on purpose. A small surplus of flexibility beats a plan you abandon on Wednesday.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Per day target', value: `${targets.kcal} kcal` },
              { label: 'Protein target', value: `${targets.protein} g` },
              { label: 'Week', value: `${analysis.weekKcal.toLocaleString()} kcal` },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Use a rough per-portion figure for each meal rather than hunting for exact values — the plan is for spotting the pattern (a protein-light
          breakfast, a 1,200-calorie dinner), not for nutrient accounting. If a day shows far more calories than the rest of the week, you have found the
          meal worth changing, and changing one meal is far easier than changing a whole diet.
        </p>
      </Panel>
    </ToolShell>
  );
}