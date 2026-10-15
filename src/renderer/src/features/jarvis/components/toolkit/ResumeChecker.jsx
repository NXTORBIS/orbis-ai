import { useMemo, useState } from 'react';
import { FileSearch } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Stat } from './shared';

const SAMPLE = `ALEX MORGAN
alex.morgan@email.com | 555 018 2299 | linkedin.com/in/alexmorgan | London

SUMMARY
Product analyst with four years of experience in B2B SaaS, focused on activation and retention.

EXPERIENCE
Product Analyst, Northwind Software — 2021 to present
- Built a cohort retention dashboard in SQL and Looker, cutting weekly reporting from two days to twenty minutes
- Ran 14 A/B tests on onboarding, lifting activation by 23% and adding £340k in annual recurring revenue
- Worked on the pricing project with the marketing team
- Responsible for weekly stakeholder updates

Analyst, Bright Data Co — 2019 to 2021
- Automated a manual reconciliation process, saving 12 hours a week across a team of five
- Helped with the migration to a new analytics stack

EDUCATION
BSc Economics, University of Leeds, 2019

SKILLS
SQL, Python, Looker, dbt, experiment design, stakeholder communication`;

const VERBS = ['built', 'ran', 'led', 'designed', 'delivered', 'launched', 'automated', 'reduced', 'increased', 'improved', 'created', 'managed', 'shipped', 'analysed', 'analyzed', 'migrated', 'optimised', 'optimized', 'negotiated', 'scaled', 'owned', 'drove', 'streamlined', 'implemented', 'developed', 'grew', 'cut'];
const WEAK = ['responsible for', 'worked on', 'helped with', 'duties included', 'team player', 'hard working', 'hard-working', 'detail oriented', 'detail-oriented', 'go-getter', 'think outside the box', 'results-driven', 'self-starter'];
const BUZZ = ['synergy', 'guru', 'ninja', 'rockstar', 'rock star', 'wizard', 'unicorn', 'disrupt', 'world-class', 'world class'];

export default function ResumeChecker() {
  const [text, setText] = useState(SAMPLE);
  const [role, setRole] = useState('Product Analyst');
  const [keywords, setKeywords] = useState('SQL, A/B testing, retention, cohort analysis, Looker, dbt, stakeholder management, Python');

  const result = useMemo(() => {
    const body = String(text);
    const lower = body.toLowerCase();
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    const bulletLines = lines.filter((line) => /^[-•*·‣]/.test(line));
    const words = body.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const estimatedPages = wordCount / 450;

    const hasEmail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(body);
    const hasPhone = /(\+?\d[\d\s().-]{7,}\d)/.test(body);
    const hasLinkedIn = /linkedin\.com\//i.test(lower);
    const hasLocation = /(london|new york|berlin|paris|remote|dublin|boston|toronto|sydney|mumbai|bengaluru|bangalore)/i.test(body);

    const sections = {
      summary: /(summary|profile|objective|about)/i.test(body),
      experience: /(experience|employment|work history)/i.test(body),
      education: /(education|qualifications)/i.test(body),
      skills: /(skills|technologies|toolkit)/i.test(body),
      projects: /(projects|portfolio)/i.test(body),
      certifications: /(certification|certificate|licences|licenses|training)/i.test(body),
    };
    const sectionCount = Object.values(sections).filter(Boolean).length;

    const numbersCount = (body.match(/\b\d+(\.\d+)?%?\b/g) || []).length;
    const percentCount = (body.match(/\d+(\.\d+)?%/g) || []).length;

    const strongBullets = bulletLines.filter((line) => VERBS.some((verb) => line.toLowerCase().replace(/^[-•*·‣]\s*/, '').startsWith(verb))).length;
    const weakHits = WEAK.filter((phrase) => lower.includes(phrase));
    const buzzHits = BUZZ.filter((phrase) => lower.includes(phrase));
    const pronounHits = (body.match(/\b(I|my|me|we|our)\b/g) || []).length;

    const dateFormats = {
      yearRange: (body.match(/\b(19|20)\d{2}\s*[-–]\s*((19|20)\d{2}|present)\b/gi) || []).length,
      monthYear: (body.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}\b/gi) || []).length,
      slash: (body.match(/\b\d{1,2}\/\d{4}\b/g) || []).length,
    };
    const usedFormats = Object.values(dateFormats).filter((value) => value > 0).length;

    const averageBulletLength = bulletLines.length
      ? Math.round(bulletLines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / bulletLines.length)
      : 0;
    const longBullet = bulletLines.find((line) => line.split(/\s+/).length > 32);

    const keywordList = String(keywords).split(',').map((word) => word.trim()).filter(Boolean);
    const matched = keywordList.filter((word) => lower.includes(word.toLowerCase()));
    const missing = keywordList.filter((word) => !lower.includes(word.toLowerCase()));
    const coverage = keywordList.length ? (matched.length / keywordList.length) * 100 : 0;

    const checks = [
      {
        label: 'Contact details are findable',
        weight: 10,
        status: hasEmail && hasPhone ? 'pass' : 'fail',
        detail: (hasEmail ? 'Email found. ' : 'No email address found. ') + (hasPhone ? 'Phone found. ' : 'No phone number found. ') + (hasLinkedIn ? 'LinkedIn link present.' : 'No LinkedIn or profile link.') + (hasLocation ? '' : ' No location, which some filters require.'),
        fix: 'Put email, phone, location and one profile link on separate lines at the very top. Recruiters look for them in the first two seconds.',
      },
      {
        label: 'Standard section headings',
        weight: 12,
        status: sectionCount >= 4 ? 'pass' : sectionCount >= 3 ? 'warn' : 'fail',
        detail: sectionCount + ' of 6 recognised headings found: ' + Object.entries(sections).filter((entry) => entry[1]).map((entry) => entry[0]).join(', ') + '.',
        fix: 'Use the plain names an applicant tracking system expects: Experience, Education, Skills. Clever headings such as Where I Have Been do not map to any field.',
      },
      {
        label: 'Quantified achievements',
        weight: 16,
        status: numbersCount >= 6 ? 'pass' : numbersCount >= 3 ? 'warn' : 'fail',
        detail: numbersCount + ' numeric figures found across ' + bulletLines.length + ' bullet points, including ' + percentCount + ' percentages.',
        fix: 'Give every strong bullet a number: how much, how many, how fast, or by what percentage. Numbers are what separate a claim from evidence.',
      },
      {
        label: 'Bullets start with a strong verb',
        weight: 14,
        status: bulletLines.length && strongBullets / bulletLines.length > 0.7 ? 'pass' : strongBullets > 0 ? 'warn' : 'fail',
        detail: strongBullets + ' of ' + bulletLines.length + ' bullets open with a concrete action verb.',
        fix: 'Start each bullet with a verb such as built, reduced, launched or migrated. Worked on and responsible for describe a job description, not an achievement.',
      },
      {
        label: 'No weak filler phrases',
        weight: 12,
        status: weakHits.length === 0 ? 'pass' : weakHits.length <= 1 ? 'warn' : 'fail',
        detail: weakHits.length ? 'Found: ' + weakHits.join(', ') + '.' : 'No filler phrases detected.',
        fix: 'Delete every instance. Each one occupies a line that could carry a result instead.',
      },
      {
        label: 'No empty buzzwords',
        weight: 8,
        status: buzzHits.length === 0 ? 'pass' : 'warn',
        detail: buzzHits.length ? 'Found: ' + buzzHits.join(', ') + '.' : 'No buzzwords detected.',
        fix: 'Replace buzzwords with the specific thing you did. A recruiter has read synergy several thousand times and remembers none of them.',
      },
      {
        label: 'Written in the third person',
        weight: 8,
        status: pronounHits <= 2 ? 'pass' : pronounHits <= 5 ? 'warn' : 'fail',
        detail: pronounHits + ' first-person pronouns found.',
        fix: 'Drop the I at the start of bullets. Job descriptions are written impersonally and resumes read better the same way.',
      },
      {
        label: 'Consistent date formatting',
        weight: 8,
        status: usedFormats <= 1 ? 'pass' : 'warn',
        detail: usedFormats === 0 ? 'No dates detected at all, which is itself a problem.' : usedFormats + ' different date formats in use.',
        fix: 'Pick one format and use it everywhere, for example Jan 2021 to present. Mixed formats look careless and confuse automatic parsing.',
      },
      {
        label: 'Length is appropriate',
        weight: 6,
        status: wordCount >= 350 && wordCount <= 900 ? 'pass' : wordCount < 350 ? 'warn' : 'warn',
        detail: wordCount + ' words, roughly ' + estimatedPages.toFixed(1) + ' page' + (estimatedPages >= 2 ? 's' : '') + ' at 450 words a page.',
        fix: wordCount < 350 ? 'Add detail: more evidence of outcomes rather than more adjectives.' : 'Trim the weakest bullet in each role. One page per decade of experience is the usual ceiling.',
      },
      {
        label: 'Bullet length is readable',
        weight: 6,
        status: averageBulletLength && averageBulletLength <= 26 ? 'pass' : 'warn',
        detail: bulletLines.length ? 'Average bullet is ' + averageBulletLength + ' words' + (longBullet ? ', with one at ' + longBullet.split(/\s+/).length + ' words.' : '.') : 'No bullet points found.',
        fix: 'Aim for one or two lines per bullet. Anything over about 30 words stops being read and starts being skimmed.',
      },
      {
        label: 'Role keywords are present',
        weight: 10,
        status: keywordList.length === 0 ? 'warn' : coverage >= 70 ? 'pass' : coverage >= 45 ? 'warn' : 'fail',
        detail: keywordList.length ? matched.length + ' of ' + keywordList.length + ' target keywords found (' + coverage.toFixed(0) + '%).' : 'No target keywords entered, so this check is idle.',
        fix: 'Mirror the wording of the job advert where it is genuinely true of you. Applicants are matched on the words a system can see.',
      },
    ];

    const earned = checks.reduce((sum, check) => sum + (check.status === 'pass' ? check.weight : check.status === 'warn' ? check.weight * 0.5 : 0), 0);
    const possible = checks.reduce((sum, check) => sum + check.weight, 0);
    const score = possible ? Math.round((earned / possible) * 100) : 0;

    const report = [
      'Resume check for ' + role,
      'Score ' + score + ' out of 100',
      '',
      ...checks.map((check) => [check.status.toUpperCase(), check.label, '—', check.detail].join(' ')),
      '',
      missing.length ? 'Missing keywords: ' + missing.join(', ') : 'All target keywords present.',
      '',
      ...checks.filter((check) => check.status !== 'pass').map((check) => 'Fix: ' + check.fix),
    ].join('\n');

    return {
      checks, score, coverage, matched, missing, wordCount, estimatedPages, bulletLines: bulletLines.length, numbersCount,
      chart: checks.map((check) => ({ label: check.label.split(' ').slice(0, 2).join(' '), value: check.weight })),
      statusCounts: {
        pass: checks.filter((check) => check.status === 'pass').length,
        warn: checks.filter((check) => check.status === 'warn').length,
        fail: checks.filter((check) => check.status === 'fail').length,
      },
      report,
      role: role || 'this role',
    };
  }, [text, role, keywords]);

  return (
    <ToolShell
      toolId="resume-check"
      icon={FileSearch}
      title="Resume & ATS Checker"
      desc="Paste a resume and get the checks an applicant tracking system and a tired recruiter both apply — contact details, headings, quantified results, filler phrases, dates and keyword coverage."
      state={{ text, role, keywords }}
      onRestore={(restored) => {
        if (typeof restored.text === 'string') setText(restored.text);
        if (typeof restored.role === 'string') setRole(restored.role);
        if (typeof restored.keywords === 'string') setKeywords(restored.keywords);
      }}
      exportText={result.report}
      exportName="resume-check.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Resume text</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{result.wordCount} words · about {result.estimatedPages.toFixed(1)} page{result.estimatedPages >= 2 ? 's' : ''}</span>
          </div>
          <Area value={text} onChange={setText} rows={16} mono placeholder={'YOUR NAME\nemail | phone | linkedin.com/in/you\n\nEXPERIENCE\n- Built ...'} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Paste plain text, not a formatted document. A tracking system reads the text layer, so checking the text layer tells you what the system actually sees.
          </p>
        </Panel>
        <div className="space-y-3">
          <Field label="Role you are targeting"><input value={role} onChange={(e) => setRole(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
          <Panel className="!p-3">
            <Field label="Keywords from the job advert, comma separated">
              <Area value={keywords} onChange={setKeywords} rows={4} placeholder="SQL, A/B testing, retention" />
            </Field>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Copy the skills and requirements straight from the advert. Only include words that genuinely describe your experience — a system that scores well on words you cannot
              discuss in the interview has not helped you.
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.score >= 80 ? 'emerald' : result.score >= 60 ? 'amber' : 'rose'}
          label={'Score for ' + result.role}
          value={String(result.score)}
          unit="/100"
          sub={result.statusCounts.pass + ' checks passed, ' + result.statusCounts.warn + ' need attention and ' + result.statusCounts.fail + ' failed. Keyword coverage against the words you listed is ' + result.coverage.toFixed(0) + '%.'}
        />
        <Ring
          value={result.coverage}
          max={100}
          tone={result.coverage >= 70 ? 'emerald' : 'amber'}
          label="Keyword coverage"
          sub={result.missing.length ? result.missing.length + ' of your target keywords are missing entirely' : 'Every target keyword appears'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Every check, with what to do about it</span>
          <CopyBtn value={result.report} label="Copy the report" />
        </div>
        <div className="space-y-1.5">
          {result.checks.map((check) => (
            <div
              key={check.label}
              className="rounded-lg border px-2.5 py-1.5"
              style={{
                borderColor: check.status === 'pass' ? 'hsl(160 60% 45% / 0.4)' : check.status === 'warn' ? 'hsl(38 92% 55% / 0.45)' : 'hsl(0 84% 60% / 0.45)',
                backgroundColor: check.status === 'pass' ? 'hsl(160 60% 45% / 0.06)' : check.status === 'warn' ? 'hsl(38 92% 55% / 0.06)' : 'hsl(0 84% 60% / 0.06)',
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-border/60 px-1.5 py-0.5 font-mono-j text-[10px] uppercase text-muted-foreground">{check.status}</span>
                <span className="text-[11px] font-medium">{check.label}</span>
                <span className="ml-auto font-mono-j text-[10px] text-muted-foreground">weight {check.weight}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{check.detail}</p>
              {check.status !== 'pass' && <p className="mt-1 text-[11px] text-cyan-j">{check.fix}</p>}
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Weight of each check</div>
          <Bars data={result.chart} format={(value) => String(value)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Quantified results carry the most weight because they are the single strongest signal of real work. Contact details matter less to the score and more in practice — a
            resume nobody can reply to scores nothing at all.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Keywords</div>
          {result.matched.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] text-muted-foreground">Present</div>
              <div className="flex flex-wrap gap-1">
                {result.matched.map((word) => (
                  <span key={word} className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-200">{word}</span>
                ))}
              </div>
            </div>
          )}
          {result.missing.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] text-muted-foreground">Missing</div>
              <div className="flex flex-wrap gap-1">
                {result.missing.map((word) => (
                  <span key={word} className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-200">{word}</span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Add a missing keyword only where it is honestly true, and put it where it belongs: in the skills list and in a bullet that shows it in use. Keyword stuffing without
            evidence reads badly to the human who reads it second.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Score" value={result.score + '/100'} mono sub={result.role} />
        <Stat label="Keyword coverage" value={result.coverage.toFixed(0) + '%'} mono sub={result.matched.length + ' of ' + (result.matched.length + result.missing.length)} />
        <Stat label="Numbers used" value={String(result.numbersCount)} mono sub={'across ' + result.bulletLines + ' bullets'} />
        <Stat label="Length" value={result.wordCount + ' words'} mono sub={'about ' + result.estimatedPages.toFixed(1) + ' pages'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What a tracking system actually does</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· It extracts text and tries to map it onto fields: name, contact, employer, job title, dates, education. Anything it cannot map is effectively invisible.</p>
            <p>· Columns, tables, text boxes and headers or footers are the most common causes of lost content. A single column of plain paragraphs is the safest structure.</p>
            <p>· A scanned image or a design export without a real text layer usually parses as nothing at all. Export a text-based PDF and check by copying a line out of it.</p>
            <p>· Standard headings matter because the parser looks for them by name. Experience, Education, Skills and Summary are understood; inventive headings are not.</p>
            <p>· Dates need to be machine-readable and consistent. A present or current end date is understood; a bare dash is not.</p>
            <p>· File names are read too. Alex-Morgan-Product-Analyst.pdf is a better first impression than resume-final-v3.pdf.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What a human does in the next twenty seconds</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· They read the top third and your most recent role. Put the strongest evidence there, not a career objective written in 2015.</p>
            <p>· They look for results. Every bullet should answer what changed because you were there.</p>
            <p>· They check whether the job title and dates line up with the advert. Gaps are fine if they are not hidden.</p>
            <p>· They scan for the things in the advert. If the advert asks for stakeholder management and the word never appears, that is the end of the read.</p>
            <p>· They notice inconsistency: mixed date formats, three different bullet styles, a skills list that stops after five items.</p>
            <p>· One page per decade of experience is a good ceiling. Two tight pages beat three padded ones every time.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Score', value: result.score + '/100' },
                { label: 'Passed', value: result.statusCounts.pass + ' checks' },
                { label: 'To fix', value: String(result.statusCounts.warn + result.statusCounts.fail) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The checks in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>contact: an email pattern and a phone pattern must both appear</p>
          <p>headings: six standard section names are searched for in the text</p>
          <p>quantification: every number in the document is counted, with percentages tracked separately</p>
          <p>verbs: bullets must open with a concrete action verb from a fixed list</p>
          <p>filler: a list of weak and empty phrases is matched case-insensitively</p>
          <p>dates: three common formats are detected, and using more than one costs points</p>
          <p className="text-cyan-j">Pass is worth full weight, a warning half, and a failure nothing. The score is the weighted total.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These are widely used rules of thumb, not any particular employer system. Real screening tools differ in what they parse and how they rank, and a human always reads a
          shortlist — so treat a high score as removing obvious obstacles rather than as a guarantee of anything.
        </p>
      </Panel>
    </ToolShell>
  );
}