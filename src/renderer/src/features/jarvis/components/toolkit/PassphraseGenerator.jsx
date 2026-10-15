import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const WORDS = ('amber anchor apple arrow atlas autumn bamboo banana basket beacon beetle bishop blossom bottle breeze bridge bronze brook bucket butter ' +
  'cactus candle canyon carbon carpet castle cedar cherry circle citrus clever clover cobalt coffee comet copper coral cosmos cotton crater cricket ' +
  'crystal daisy dawn delta desert dolphin dragon drift eagle ember falcon feather fern field flame flint forest fossil fountain galaxy garden ' +
  'gecko ginger glacier globe granite grape gravel guitar harbor hazel heron honey horizon iceberg indigo ivory jade jasmine jungle kettle kiwi ' +
  'koala lagoon lantern laser lemon leopard lightning lilac linen lobster lotus lunar magnet mango maple marble meadow melon mentor meteor midnight ' +
  'mineral mirror misty monkey monsoon moss mountain muffin mustard nectar nickel night noble north nutmeg oasis ocean olive onyx opal orbit orchid ' +
  'otter oxygen paddle panda papaya parrot pebble pecan pelican pepper petal phoenix piano pigeon pillow pilot planet plateau plum pollen poppy ' +
  'prairie prism pumpkin puppet quartz quill rabbit radar rainbow raven rocket rosemary ruby saffron sage salmon sapphire satin scarlet shadow shell ' +
  'silk silver sketch slate snow solar sparrow spice spring spruce squirrel star steel stone storm sugar sunset swan sycamore tangerine teal ' +
  'thistle thunder tiger timber toffee topaz tornado tortoise trophy tulip tundra turquoise turtle twilight velvet violet vulture walnut willow ' +
  'winter wolf yarrow zebra zenith zephyr').split(' ');

const SEPARATORS = [
  { value: '-', label: 'dash' },
  { value: '.', label: 'dot' },
  { value: '_', label: 'underscore' },
  { value: ' ', label: 'space' },
  { value: '', label: 'none' },
];

const CASES = [
  { value: 'lower', label: 'lowercase' },
  { value: 'title', label: 'Title Case' },
  { value: 'upper', label: 'UPPERCASE' },
];

const SYMBOLS = ['!', '@', '#', '$', '%', '?', '&'];

const rand = (max) => {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return Math.floor((buffer[0] / 4294967296) * max);
};

const makeWords = (count) => Array.from({ length: count }, () => WORDS[rand(WORDS.length)]);

const styled = (word, mode) => (mode === 'upper' ? word.toUpperCase() : mode === 'title' ? word[0].toUpperCase() + word.slice(1) : word);

export default function PassphraseGenerator() {
  const [count, setCount] = useState(4);
  const [words, setWords] = useState(() => makeWords(4));
  const [separator, setSeparator] = useState('-');
  const [caps, setCaps] = useState('lower');
  const [digits, setDigits] = useState(1);
  const [symbol, setSymbol] = useState(false);

  const changeCount = (next) => {
    setCount(next);
    setWords(makeWords(next));
  };

  const digitChars = Array.from({ length: digits }, () => String(rand(10))).join('');
  const symbolChar = symbol ? SYMBOLS[rand(SYMBOLS.length)] : '';
  const phrase = `${words.map((w) => styled(w, caps)).join(separator)}${digitChars}${symbolChar}`;

  const entropy = words.length * Math.log2(WORDS.length) + (digits ? digits * Math.log2(10) : 0) + (symbol ? Math.log2(SYMBOLS.length) : 0);
  const verdict = entropy >= 90 ? 'Excellent' : entropy >= 70 ? 'Strong' : entropy >= 50 ? 'Fair' : 'Weak';
  const verdictTone = entropy >= 70 ? 'text-cyan-j' : entropy >= 50 ? 'text-amber-500' : 'text-red-500';

  return (
    <ToolShell
      toolId="passphrase"
      icon={KeyRound}
      title="Passphrase Generator"
      desc="Memorable word-based passwords, drawn on your device with real randomness and the entropy shown."
      state={{ count, separator, caps, digits, symbol, words }}
      onRestore={(saved) => {
        setCount(saved.count ?? 4);
        setSeparator(saved.separator ?? '-');
        setCaps(saved.caps || 'lower');
        setDigits(saved.digits ?? 1);
        setSymbol(!!saved.symbol);
        if (Array.isArray(saved.words) && saved.words.length) setWords(saved.words);
      }}
      exportText={phrase}
      exportName="passphrase.txt"
    >
      <Panel className="text-center">
        <div className="break-all font-mono-j text-lg font-semibold text-cyan-j">{phrase}</div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setWords(makeWords(count))}
            className="rounded-lg border border-cyan-j/50 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/10"
          >
            Generate a new one
          </button>
          <CopyBtn value={phrase} />
        </div>
      </Panel>

      <Field label={`Words · ${count}`}>
        <input type="range" min={2} max={10} value={count} onChange={(e) => changeCount(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <Field label="Separator">
        <Seg value={separator} onChange={setSeparator} options={SEPARATORS} />
      </Field>

      <Field label="Letter case">
        <Seg value={caps} onChange={setCaps} options={CASES} />
      </Field>

      <Field label={`Digits on the end · ${digits}`}>
        <input type="range" min={0} max={4} value={digits} onChange={(e) => setDigits(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <ToggleRow label="Add a symbol" checked={symbol} onChange={setSymbol} hint="one random symbol" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Words" value={String(words.length)} />
        <Stat label="Word list" value={String(WORDS.length)} />
        <Stat label="Entropy" value={`${Math.round(entropy)} bits`} />
      </div>

      <Panel className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Strength</span>
        <span className={`text-sm font-semibold ${verdictTone}`}>{verdict}</span>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          {Math.round(entropy)} bits of entropy, drawn from your browser's cryptographic random source and never sent anywhere.
          Longer phrases are easier to remember and harder to guess than a short jumble of symbols.
        </p>
      </Panel>
    </ToolShell>
  );
}