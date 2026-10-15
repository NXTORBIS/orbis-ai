import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const CLASSES = [
  { value: 7, label: 'rwx', desc: 'full control' },
  { value: 6, label: 'rw-', desc: 'read and write' },
  { value: 5, label: 'r-x', desc: 'read and execute' },
  { value: 4, label: 'r--', desc: 'read only' },
  { value: 3, label: '-wx', desc: 'write and execute' },
  { value: 2, label: '-w-', desc: 'write only' },
  { value: 1, label: '--x', desc: 'execute only' },
  { value: 0, label: '---', desc: 'no access' },
];

const COMMON = [
  { mode: '755', example: 'web directories and executables' },
  { mode: '644', example: 'regular files you own' },
  { mode: '600', example: 'private keys and secrets' },
  { mode: '700', example: 'private directories such as .ssh' },
  { mode: '775', example: 'shared group directories' },
  { mode: '664', example: 'shared group files' },
  { mode: '777', example: 'everything to everyone, avoid it' },
  { mode: '444', example: 'read-only files' },
];

const digit = (value) => (Number.isFinite(value) ? Math.max(0, Math.min(7, value)) : 0);

export default function ChmodCalculator() {
  const [owner, setOwner] = useState(6);
  const [group, setGroup] = useState(4);
  const [other, setOther] = useState(4);
  const [setuid, setSetuid] = useState(false);
  const [setgid, setSetgid] = useState(false);
  const [sticky, setSticky] = useState(false);
  const [umask, setUmask] = useState('022');
  const [file, setFile] = useState('script.sh');

  const result = useMemo(() => {
    const special = (setuid ? 4 : 0) + (setgid ? 2 : 0) + (sticky ? 1 : 0);
    const octal = String(special) + digit(owner) + digit(group) + digit(other);
    const shortOctal = special ? octal : String(digit(owner)) + String(digit(group)) + String(digit(other));

    const symbolic = (value, specialCharacter) => {
      const read = value & 4 ? 'r' : '-';
      const write = value & 2 ? 'w' : '-';
      const executeBit = value & 1;
      const execute = specialCharacter
        ? (executeBit ? specialCharacter : specialCharacter.toLowerCase())
        : (executeBit ? 'x' : '-');
      return read + write + execute;
    };

    const ownerSymbols = symbolic(digit(owner), setuid ? 's' : '');
    const groupSymbols = symbolic(digit(group), setgid ? 's' : '');
    const otherSymbols = symbolic(digit(other), sticky ? 't' : '');
    const symbolicForm = ownerSymbols + groupSymbols + otherSymbols;

    const mask = String(umask).padStart(3, '0').slice(-3);
    const maskDigits = mask.split('').map((value) => digit(Number(value)));
    const defaultBase = maskDigits.some((value) => value & 1) ? 6 : 6;
    const applyMask = (value, maskValue) => value & ~maskValue & 7;
    const resultingFileMode = String(applyMask(defaultBase, maskDigits[0])) + String(applyMask(defaultBase, maskDigits[1])) + String(applyMask(defaultBase, maskDigits[2]));
    const resultingDirectoryBase = 7;
    const resultingDirectoryMode = String(applyMask(resultingDirectoryBase, maskDigits[0])) + String(applyMask(resultingDirectoryBase, maskDigits[1])) + String(applyMask(resultingDirectoryBase, maskDigits[2]));

    const security = [];
    if (digit(other) & 2) security.push('Group and other can write to this. That is only appropriate for a deliberately shared scratch area.');
    if (digit(other) === 7) security.push('Everyone has full access. This is the classic accidental hole created by chmod 777.');
    if (setuid) security.push('setuid means the program runs with the owner privileges rather than the caller. Useful for a few system binaries, dangerous everywhere else.');
    if (setgid) security.push('setgid on a directory makes new files inherit the group, which is a tidy way to share a folder between a team.');
    if (sticky) security.push('The sticky bit on a shared directory stops people deleting files they do not own — which is why /tmp uses it.');
    if ((digit(owner) & 1) && !(digit(owner) & 4)) security.push('Execute without read is unusual: a binary that cannot be inspected.');

    return {
      octal, shortOctal, symbolicForm, ownerSymbols, groupSymbols, otherSymbols, special, mask, resultingFileMode, resultingDirectoryMode,
      security: security.length ? security : ['Nothing about this mode is obviously dangerous. Check that group access matches who actually needs it.'],
      readable: [digit(owner), digit(group), digit(other)].map((value) => (CLASSES.find((entry) => entry.value === value) || CLASSES[7]).desc),
    };
  }, [owner, group, other, setuid, setgid, sticky, umask]);

  const report = useMemo(() => [
    'Octal: ' + result.octal + ' (short form ' + result.shortOctal + ')',
    'Symbolic: ' + result.symbolicForm,
    '',
    'Owner ' + result.ownerSymbols + ' · group ' + result.groupSymbols + ' · other ' + result.otherSymbols,
    'Special bits: ' + (result.special ? (result.setuidText || '') + '' : 'none') + (result.special ? '' : ''),
    '',
    'chmod ' + result.octal + ' ' + file,
    '',
    'Umask ' + result.mask + ' gives new files ' + result.resultingFileMode + ' and new directories ' + result.resultingDirectoryMode,
    '',
    ...result.security.map((line) => '· ' + line),
  ].join('\n'), [result, file]);

  return (
    <ToolShell
      toolId="chmod-calculator"
      icon={Lock}
      title="File Permission Calculator"
      desc="Tick the permissions and read the octal and symbolic forms both ways, with the special bits explained, the umask effect on new files and the security consequences spelled out."
      state={{ owner, group, other, setuid, setgid, sticky, umask, file }}
      onRestore={(restored) => {
        if (restored.owner !== undefined) setOwner(digit(Number(restored.owner)));
        if (restored.group !== undefined) setGroup(digit(Number(restored.group)));
        if (restored.other !== undefined) setOther(digit(Number(restored.other)));
        if (restored.setuid !== undefined) setSetuid(!!restored.setuid);
        if (restored.setgid !== undefined) setSetgid(!!restored.setgid);
        if (restored.sticky !== undefined) setSticky(!!restored.sticky);
        if (typeof restored.umask === 'string') setUmask(restored.umask);
        if (typeof restored.file === 'string') setFile(restored.file);
      }}
      exportText={report}
      exportName="permissions.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Permissions</div>
          <div className="space-y-2">
            {[['Owner', owner, setOwner, 'the user who owns the file'], ['Group', group, setGroup, 'members of the file group'], ['Other', other, setOther, 'everyone else']].map((entry) => (
              <div key={entry[0]} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium">{entry[0]}</span>
                  <span className="font-mono-j text-[11px] text-cyan-j">{result.readable[entry[0] === 'Owner' ? 0 : entry[0] === 'Group' ? 1 : 2]}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CLASSES.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => entry[2](option.value)}
                      className={option.value === entry[1]
                        ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2 py-1 font-mono-j text-[11px] text-cyan-j'
                        : 'rounded-lg border border-border/70 px-2 py-1 font-mono-j text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
                      title={option.desc}
                    >
                      {option.value} {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <div className="space-y-3">
          <Hero
            label="Octal mode"
            value={result.octal}
            sub={'Symbolic form ' + result.symbolicForm + '. The command is chmod ' + result.octal + ' ' + file + ', and 4 is read, 2 is write, 1 is execute, added together per class.'}
          />
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Special bits</div>
            <div className="space-y-1.5">
              <ToggleRow label="setuid — run as the file owner (4)" checked={setuid} onChange={() => setSetuid((current) => !current)} />
              <ToggleRow label="setgid — run as the group, or inherit it on directories (2)" checked={setgid} onChange={() => setSetgid((current) => !current)} />
              <ToggleRow label="sticky — only the owner may delete (1)" checked={sticky} onChange={() => setSticky((current) => !current)} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              With no special bits the leading digit is omitted and the mode is three digits. Any special bit adds a fourth digit in front.
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Read the mode</span>
            <CopyBtn value={'chmod ' + result.octal + ' ' + file} label="Copy command" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Owner', result.ownerSymbols], ['Group', result.groupSymbols], ['Other', result.otherSymbols]].map((entry) => (
              <div key={entry[0]} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                <div className="text-[10px] text-muted-foreground">{entry[0]}</div>
                <div className="mt-1 font-mono-j text-lg text-cyan-j">{entry[1]}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Numeric</span><span>{digit(owner)} {digit(group)} {digit(other)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Symbolic</span><span>{result.symbolicForm}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Special digit</span><span>{result.special}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Command</span><span className="text-cyan-j">chmod {result.octal} {file}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Symbolic command</span><span>chmod u={result.ownerSymbols.replace(/-/g, '')},g={result.groupSymbols.replace(/-/g, '')},o={result.otherSymbols.replace(/-/g, '')} {file}</span></div>
          </div>
          <div className="mt-3">
            <Field label="File name for the command"><input value={file} onChange={(e) => setFile(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What this mode means in practice</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.security.map((line) => <p key={line}>· {line}</p>)}
            <p className="mt-2 text-cyan-j">Owner {result.readable[0]}, group {result.readable[1]}, other {result.readable[2]}.</p>
          </div>
          <div className="mt-3">
            <Field label="Umask"><input value={umask} onChange={(e) => setUmask(e.target.value)} inputMode="numeric" className="h-9 w-full max-w-[10rem] rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The umask removes permissions from the defaults when a file is created. With umask {result.mask}, new files arrive as {result.resultingFileMode} and new directories as
            {result.resultingDirectoryMode}, which is why 022 gives you 644 files and 755 directories without anyone typing a chmod.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Octal" value={result.octal} mono sub={result.symbolicForm} />
        <Stat label="Owner" value={result.ownerSymbols} mono sub={'digit ' + digit(owner)} />
        <Stat label="Group" value={result.groupSymbols} mono sub={'digit ' + digit(group)} />
        <Stat label="Other" value={result.otherSymbols} mono sub={'digit ' + digit(other)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Modes you will meet constantly</div>
          <div className="space-y-1.5">
            {COMMON.map((entry) => (
              <button
                key={entry.mode}
                type="button"
                onClick={() => {
                  const digits = entry.mode.split('').map(Number);
                  setOwner(digit(digits[0]));
                  setGroup(digit(digits[1]));
                  setOther(digit(digits[2]));
                  setSetuid(false);
                  setSetgid(false);
                  setSticky(false);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-left text-[11px] transition hover:border-cyan-j/50"
              >
                <span className="font-mono-j text-cyan-j">{entry.mode}</span>
                <span className="text-muted-foreground">{entry.example}</span>
              </button>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Permissions that keep you out of trouble</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Never use 777 to fix a permission problem. It usually means the owner or group is wrong, and 777 hands the file to everyone including any compromised process.</p>
            <p>· Directories need execute to be entered, so 644 on a directory makes it look broken rather than private. Directories are almost always 755 or 700.</p>
            <p>· Private keys, tokens and .env files belong at 600. Anything less is readable by other accounts on the machine.</p>
            <p>· Web server content is typically 644 for files and 755 for directories, owned by the user running the server rather than root.</p>
            <p>· Prefer group ownership over broad permissions when several people need access. A shared group with 750 beats 755 every time.</p>
            <p>· Recurring problems with permissions usually mean a deployment is running as the wrong user, not that the mode is wrong.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Octal', value: result.octal },
                { label: 'Symbolic', value: result.symbolicForm },
                { label: 'Umask', value: result.mask },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How each digit works</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>4 = read · 2 = write · 1 = execute — added together per class</p>
          <p>owner, group, other in that order, so 644 is owner 6, group 4, other 4</p>
          <p>leading 4 = setuid, 2 = setgid, 1 = sticky, added together</p>
          <p>umask removes bits from the create defaults: 666 for files and 777 for directories</p>
          <p className="text-cyan-j">Here {digit(owner)} = {digit(owner) & 4 ? '4' : '0'} + {digit(owner) & 2 ? '2' : '0'} + {digit(owner) & 1 ? '1' : '0'} for the owner.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The arithmetic here is exact and matches how the kernel reads the mode bits. What the mode means for your setup depends on who owns the file, which groups exist and what
          the service account is, so check those alongside the number.
        </p>
      </Panel>
    </ToolShell>
  );
}