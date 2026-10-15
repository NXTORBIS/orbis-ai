import { useMemo, useState } from 'react';
import { Smile } from 'lucide-react';
import { ToolHeader, Panel, useCopy } from './shared';

const GROUPS = [
  { name: 'Smileys', items: { grin: '😀', smile: '😃', happy: '😄', beaming: '😁', laugh: '😆', nervous: '😅', joy: '😂', rofl: '🤣', blush: '😊', wink: '😉', love: '😍', kiss: '😘', cool: '😎', starstruck: '🤩', thinking: '🤔', sleepy: '😴', cry: '😭', angry: '😡', shock: '😱', mindblown: '🤯', hug: '🤗', quiet: '🤫' } },
  { name: 'People & Gestures', items: { thumbsup: '👍', thumbsdown: '👎', clap: '👏', pray: '🙏', muscle: '💪', wave: '👋', perfect: '👌', victory: '✌️', pointright: '👉', pointleft: '👈', celebrate: '🙌', deal: '🤝', eyes: '👀', brain: '🧠', student: '🧑‍🎓', developer: '🧑‍💻', ninja: '🥷', hero: '🦸' } },
  { name: 'Animals & Nature', items: { dog: '🐶', cat: '🐱', mouse: '🐭', fox: '🦊', bear: '🐻', panda: '🐼', lion: '🦁', tiger: '🐯', monkey: '🐵', unicorn: '🦄', bee: '🐝', butterfly: '🦋', turtle: '🐢', whale: '🐳', dolphin: '🐬', tree: '🌳', cactus: '🌵', sunflower: '🌻', rose: '🌹', clover: '🍀', fire: '🔥', rainbow: '🌈', star: '⭐', moon: '🌙', sun: '☀️', cloud: '☁️', snow: '❄️', bolt: '⚡' } },
  { name: 'Food & Drink', items: { apple: '🍎', banana: '🍌', grapes: '🍇', melon: '🍉', pizza: '🍕', burger: '🍔', fries: '🍟', sushi: '🍣', taco: '🌮', ramen: '🍜', cake: '🍰', cookie: '🍪', coffee: '☕', tea: '🍵', juice: '🧃', beer: '🍺', wine: '🍷', icecream: '🍦', honey: '🍯', avocado: '🥑' } },
  { name: 'Travel', items: { car: '🚗', taxi: '🚕', bus: '🚌', train: '🚆', plane: '✈️', rocket: '🚀', ship: '🚢', bike: '🚲', motorbike: '🏍️', walking: '🚶', running: '🏃', mountain: '⛰️', beach: '🏖️', city: '🏙️', home: '🏠', office: '🏢', map: '🗺️', compass: '🧭', tent: '⛺', globe: '🌍' } },
  { name: 'Tech & Objects', items: { laptop: '💻', desktop: '🖥️', phone: '📱', keyboard: '⌨️', camera: '📷', video: '🎥', tv: '📺', headphones: '🎧', mic: '🎤', sound: '🔊', bell: '🔔', mail: '✉️', folder: '📁', file: '📄', books: '📚', notebook: '📓', pencil: '✏️', ruler: '📏', scissors: '✂️', clip: '📎', lock: '🔒', key: '🔑', bulb: '💡', battery: '🔋', plug: '🔌', gear: '⚙️', link: '🔗', chart: '📈', calendar: '📅', alarm: '⏰', money: '💸', coin: '🪙', card: '💳', gift: '🎁', trophy: '🏆', medal: '🥇', target: '🎯', crown: '👑', gem: '💎', magnet: '🧲', flask: '🧪', dna: '🧬', telescope: '🔭', satellite: '🛰️', robot: '🤖' } },
  { name: 'Symbols', items: { check: '✅', cross: '❌', warning: '⚠️', question: '❓', plus: '➕', minus: '➖', infinity: '♾️', recycle: '♻️', heart: '❤️', broken: '💔', sparkles: '✨', boom: '💥', drop: '💧', speech: '💬', thought: '💭', right: '➡️', up: '⬆️', down: '⬇️', refresh: '🔄', play: '▶️', pause: '⏸️', stop: '⏹️', hundred: '💯' } },
  { name: 'Fun & Sports', items: { soccer: '⚽', basketball: '🏀', tennis: '🎾', cricket: '🏏', chess: '♟️', dice: '🎲', gamepad: '🎮', art: '🎨', music: '🎵', guitar: '🎸', drums: '🥁', yoga: '🧘', swim: '🏊', ski: '⛷️', flag: '🚩', balloon: '🎈', party: '🎉', medal2: '🏅' } },
];

export default function EmojiPicker() {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState([]);
  const { copied, copy } = useCopy();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS
      .map((g) => ({ ...g, items: Object.fromEntries(Object.entries(g.items).filter(([k]) => k.includes(q))) }))
      .filter((g) => Object.keys(g.items).length || g.name.toLowerCase().includes(q));
  }, [query]);

  const pick = (emoji) => {
    copy(emoji);
    setRecent((r) => [emoji, ...r.filter((e) => e !== emoji)].slice(0, 12));
  };

  const total = GROUPS.reduce((n, g) => n + Object.keys(g.items).length, 0);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Smile} title="Emoji Picker" desc={`Search ${total} emoji by keyword and copy any of them instantly.`} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by keyword — smile, rocket, coin…"
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-glow"
      />
      {recent.length > 0 && (
        <Panel>
          <div className="mb-2 text-xs text-muted-foreground">{copied ? 'Copied!' : 'Recently copied'}</div>
          <div className="flex flex-wrap gap-1.5 text-2xl">
            {recent.map((e) => <button key={e} onClick={() => pick(e)} className="rounded-lg px-1.5 py-1 transition hover:bg-accent">{e}</button>)}
          </div>
        </Panel>
      )}
      {filtered.map((g) => (
        <div key={g.name}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{g.name}</div>
          <div className="grid grid-cols-8 gap-1 sm:grid-cols-12">
            {Object.entries(g.items).map(([keyword, emoji]) => (
              <button
                key={keyword + emoji}
                title={keyword}
                onClick={() => pick(emoji)}
                className="grid aspect-square place-items-center rounded-lg border border-transparent text-xl transition hover:border-cyan-j/40 hover:bg-accent active:scale-90 sm:text-2xl"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ))}
      {filtered.length === 0 && <p className="text-sm text-muted-foreground">No emoji match “{query}”.</p>}
    </div>
  );
}