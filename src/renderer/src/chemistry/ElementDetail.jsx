import { useState } from 'react';
import { useParams, useNavigate, Link } from './ui/router.jsx';
import { motion } from './ui/motion.jsx';
import {
  ArrowLeft, Star, Atom, Thermometer, FlaskConical, History, ShieldAlert,
  Sparkles, Beaker, ChevronRight,
} from 'lucide-react';
import { getElement } from './lib/elementsData.js';
import { getCategory } from './lib/chemistryCategories.js';
import ShellDiagram from './parts/ShellDiagram.jsx';
import { renderFormula } from './lib/formulaRender.jsx';
import AIPanel, { askAI } from './parts/AIPanel.jsx';
import { useSettings } from './ui/useSettings.js';

function InfoRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right font-medium">{value}</span>
    </div>
  );
}

function Section({ icon: Icon, title, children, accent }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass glass-border rounded-2xl p-4"
    >
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: accent || 'var(--muted-foreground)' }}>
        <Icon className="h-4 w-4" strokeWidth={1.5} /> {title}
      </div>
      {children}
    </motion.div>
  );
}

function Sub({ title }) { return <h4 className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-cyan-j">{title}</h4>; }

function AIActions({ element, setAIPrompt }) {
  const name = element.name;
  return (
    <div className="flex flex-wrap gap-1.5">
      {[
        `Explain the element ${name} in detail including its atomic structure, key properties, and uses.`,
        `Explain ${name} like I'm 10 years old, using simple analogies.`,
        `Explain ${name} for a Class 11 student preparing for exams.`,
        `Explain ${name} for JEE Main preparation with important points and exceptions.`,
        `Explain ${name} for NEET preparation with key facts to remember.`,
        `Generate 5 flashcards (Q&A) about ${name}.`,
        `Generate a 5-question multiple-choice quiz about ${name} with answers.`,
        `Write concise revision notes about ${name}.`,
        `List common exam questions about ${name} and how to answer them.`,
      ].map((p, i) => (
        <button key={i} onClick={() => setAIPrompt(p)} className="rounded-lg border border-border/60 bg-card/50 px-3 py-1.5 text-[11px] transition hover:border-cyan-j/50 hover:text-foreground">
          {['Explain this element','Explain like I\'m 10','For Class 11','For JEE','For NEET','Flashcards','Quiz','Revision notes','Exam questions'][i]}
        </button>
      ))}
    </div>
  );
}

export default function ElementDetail() {
  const { atomicNumber } = useParams();
  const nav = useNavigate();
  const { settings, update } = useSettings();
  const el = getElement(Number(atomicNumber));
  const [aiPrompt, setAiPrompt] = useState('');

  if (!el) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <p className="text-sm text-muted-foreground">Element not found.</p>
        <Link to="/chemistry" className="mt-3 inline-block text-cyan-j hover:underline">Back to Periodic Table</Link>
      </div>
    );
  }

  const cat = getCategory(el.category);
  const favorites = settings.favoriteElements || [];
  const isFavorite = favorites.includes(el.atomic_number);
  const toggleFavorite = () => {
    const next = isFavorite ? favorites.filter((n) => n !== el.atomic_number) : [...favorites, el.atomic_number];
    update({ favoriteElements: next });
  };

  const neutrons = Math.round(el.atomic_mass) - el.atomic_number;
  const isMetal = ['alkali-metal','alkaline-earth-metal','transition-metal','post-transition-metal','lanthanide','actinide'].includes(el.category);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={() => nav('/chemistry')} className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} /> Back to Periodic Table
      </button>

      {/* Hero */}
      <div className="mb-6 flex flex-col items-center gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center" style={{ borderColor: cat.color + '55', background: `linear-gradient(135deg, ${cat.color}15, transparent)` }}>
        <div className="flex h-28 w-28 shrink-0 flex-col items-center justify-center rounded-2xl border-2 bg-card/70" style={{ borderColor: cat.color }}>
          <span className="text-[11px] text-muted-foreground">{el.atomic_number}</span>
          <span className="font-display text-4xl font-bold" style={{ color: cat.color }}>{el.symbol}</span>
          <span className="text-[9px] text-muted-foreground">{el.atomic_mass.toFixed(3)}</span>
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h1 className="font-display text-3xl font-bold">{el.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{el.summary}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
            <span className="rounded-full px-2.5 py-0.5 text-[11px]" style={{ color: cat.color, background: cat.color + '20' }}>{cat.label}</span>
            {el.radioactive && <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-[11px] text-destructive">Radioactive</span>}
            {el.synthetic && <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] text-amber-400">Synthetic</span>}
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] capitalize text-secondary-foreground">{el.phase}</span>
          </div>
        </div>
        <button onClick={toggleFavorite} className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-amber-400">
          <Star className={`h-6 w-6 ${isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} strokeWidth={1.5} />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* General */}
        <Section icon={FlaskConical} title="General" accent={cat.color}>
          <InfoRow label="Symbol" value={el.symbol} />
          <InfoRow label="Atomic Number" value={el.atomic_number} />
          <InfoRow label="Atomic Mass" value={`${el.atomic_mass} u`} />
          <InfoRow label="Category" value={cat.label} />
          <InfoRow label="Group / Period" value={`${el.group || '—'} / ${el.period}`} />
          <InfoRow label="Block" value={`${el.block}-block`} />
          <InfoRow label="CAS Number" value={el.cas} />
          <InfoRow label="Appearance" value={el.appearance} />
          <InfoRow label="Phase (STP)" value={el.phase} />
        </Section>

        {/* Atomic structure */}
        <Section icon={Atom} title="Atomic Structure" accent={cat.color}>
          <InfoRow label="Protons" value={el.atomic_number} />
          <InfoRow label="Neutrons" value={neutrons} />
          <InfoRow label="Electrons" value={el.atomic_number} />
          <InfoRow label="Electron Configuration" value={el.electron_configuration} />
          <InfoRow label="Noble Gas Config." value={el.electron_configuration_noble} />
          <InfoRow label="Valence Electrons" value={el.valence_electrons} />
          <InfoRow label="Atomic Radius" value={`${el.atomic_radius} pm`} />
          <InfoRow label="Ionization Energy" value={`${el.ionization_energy} kJ/mol`} />
          <InfoRow label="Electronegativity" value={el.electronegativity || '—'} />
          <div className="mt-3 flex justify-center"><ShellDiagram atomicNumber={el.atomic_number} color={cat.color} /></div>
        </Section>

        {/* Chemical properties */}
        <Section icon={Beaker} title="Chemical Properties" accent={cat.color}>
          <InfoRow label="Common Oxidation States" value={el.oxidation_states?.join(', ') || '—'} />
          <InfoRow label="Metallic Character" value={isMetal ? 'Metal' : 'Nonmetal / metalloid'} />
          <InfoRow label="Reactivity" value={isMetal ? (el.category === 'alkali-metal' || el.category === 'alkaline-earth-metal' ? 'High (reactive metal)' : 'Moderate') : 'Varies'} />
          <InfoRow label="Bonding" value={isMetal ? 'Metallic / ionic' : 'Covalent / ionic'} />
          <Sub>Lewis Dot (valence electrons)</Sub>
          <div className="flex h-16 items-center gap-2">
            <span className="font-display text-2xl" style={{ color: cat.color }}>{el.symbol}</span>
            <div className="flex flex-wrap gap-0.5">
              {Array.from({ length: Math.min(el.valence_electrons, 8) }).map((_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
              ))}
            </div>
          </div>
        </Section>

        {/* Physical properties */}
        <Section icon={Thermometer} title="Physical Properties" accent={cat.color}>
          <InfoRow label="Density" value={el.density ? `${el.density} g/cm³` : '—'} />
          <InfoRow label="Melting Point" value={el.melting_point ? `${el.melting_point} K (${Math.round(el.melting_point - 273.15)} °C)` : '—'} />
          <InfoRow label="Boiling Point" value={el.boiling_point ? `${el.boiling_point} K (${Math.round(el.boiling_point - 273.15)} °C)` : '—'} />
          <InfoRow label="Phase at Room Temp" value={el.phase} />
          <InfoRow label="State at STP" value={el.phase} />
          <InfoRow label="Color / Appearance" value={el.appearance} />
        </Section>

        {/* Discovery */}
        <Section icon={History} title="Discovery" accent={cat.color}>
          <InfoRow label="Discovered By" value={el.discovered_by} />
          <InfoRow label="Year" value={el.discovery_year ? (el.discovery_year < 0 ? `${Math.abs(el.discovery_year)} BC` : el.discovery_year) : 'Ancient / unknown'} />
          <Sub>Scientific Significance</Sub>
          <p className="text-xs text-muted-foreground">{el.summary}</p>
        </Section>

        {/* Uses & safety */}
        <Section icon={ShieldAlert} title="Uses & Safety" accent={cat.color}>
          <Sub>Applications</Sub>
          <p className="text-xs text-muted-foreground">{el.uses}</p>
          <Sub>Safety Notes</Sub>
          <p className="text-xs text-muted-foreground">
            {el.radioactive ? '⚠ Radioactive — handle with shielding and follow strict protocols.' : ''}
            {el.synthetic ? ' Synthetic — no natural occurrence; produced in laboratories.' : ''}
            {['F','Cl','Br','I','At'].includes(el.symbol) ? ' Halogen — may be corrosive/toxic; handle with care.' : ''}
            {['Hg','Pb','Cd','Tl','As','Sb'].includes(el.symbol) ? ' Toxic heavy metal — avoid ingestion and inhalation.' : ''}
            {!el.radioactive && !el.synthetic && !['F','Cl','Br','I','At','Hg','Pb','Cd','Tl','As','Sb'].includes(el.symbol) ? ' Generally low hazard in elemental form; follow standard lab practice.' : ''}
          </p>
        </Section>
      </div>

      {/* Related modules */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { icon: Beaker, label: 'Combine Elements', to: `/chemistry/combine?focus=${el.symbol}` },
          { icon: Atom, label: 'Periodic Table', to: '/chemistry' },
        ].map((m, i) => (
          <Link key={i} to={m.to} className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-3 text-xs transition hover:border-cyan-j/50">
            <m.icon className="h-4 w-4 text-cyan-j" strokeWidth={1.5} />
            <span className="flex-1">{m.label}</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </Link>
        ))}
      </div>

      {/* AI assistant */}
      <div className="glass glass-border mt-6 rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-j">
          <Sparkles className="h-4 w-4" strokeWidth={1.5} /> AI Chemistry Assistant — {el.name}
        </div>
        <AIActions element={el} setAIPrompt={setAiPrompt} />
        <div className="mt-4">
          <AIPanel
            systemContext={`You are Jarvis, an expert chemistry tutor. The user is viewing the element ${el.name} (symbol ${el.symbol}, atomic number ${el.atomic_number}, category ${cat.label}, electron configuration ${el.electron_configuration}). Give accurate, concise, educational answers.`}
            initialPrompt={aiPrompt}
            key={aiPrompt}
            placeholder={`Ask Jarvis anything about ${el.name}…`}
          />
        </div>
      </div>
    </div>
  );
}