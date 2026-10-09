import ElementTile from './ElementTile.jsx';

const LANTHANIDE_START = 57;
const ACTINIDE_START = 89;

export default function PeriodicTableGrid({ elements, matchIds, onSelect }) {
  const mainRow = (el) => el.period;
  const mainCol = (el) => el.group;

  const isFooter = (el) => (el.group === 3 && (el.period === 6 || el.period === 7));

  const footerRow = (el) => (el.period === 6 ? 8 : 9);
  const footerCol = (el) => 3 + (el.atomic_number - (el.period === 6 ? LANTHANIDE_START : ACTINIDE_START));

  return (
    <div className="scrollbar-thin overflow-x-auto pb-4">
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(18, minmax(38px, 1fr))', minWidth: 900 }}>
        {elements.map((el) => {
          if (isFooter(el)) return null;
          const dimmed = matchIds && !matchIds.has(el.atomic_number);
          return (
            <ElementTile
              key={el.atomic_number}
              el={el}
              dimmed={dimmed}
              onClick={onSelect}
              style={{ gridColumn: mainCol(el), gridRow: mainRow(el) }}
            />
          );
        })}

        {/* Placeholders pointing to footer rows */}
        <div style={{ gridColumn: 3, gridRow: 6 }} className="grid place-items-center rounded-md border border-dashed border-border/50 text-[8px] text-muted-foreground">57–71</div>
        <div style={{ gridColumn: 3, gridRow: 7 }} className="grid place-items-center rounded-md border border-dashed border-border/50 text-[8px] text-muted-foreground">89–103</div>

        {elements.map((el) => {
          if (!isFooter(el)) return null;
          const dimmed = matchIds && !matchIds.has(el.atomic_number);
          return (
            <ElementTile
              key={el.atomic_number}
              el={el}
              dimmed={dimmed}
              onClick={onSelect}
              style={{ gridColumn: footerCol(el), gridRow: footerRow(el) }}
            />
          );
        })}
      </div>
    </div>
  );
}