import { useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const LAYOUTS = [
  { value: 'stacked', label: 'Stacked' },
  { value: 'inline', label: 'Inline' },
  { value: 'card', label: 'Card with accent bar' },
];

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export default function EmailSignatureBuilder() {
  const [name, setName] = useState('Alex Morgan');
  const [title, setTitle] = useState('Product Analyst');
  const [company, setCompany] = useState('Northwind Software');
  const [email, setEmail] = useState('alex.morgan@northwind.example');
  const [phone, setPhone] = useState('+44 20 7946 0182');
  const [website, setWebsite] = useState('northwind.example');
  const [address, setAddress] = useState('18 Bell Yard, London EC4A 2LA');
  const [linkedin, setLinkedin] = useState('linkedin.com/in/alexmorgan');
  const [accent, setAccent] = useState('#22d3ee');
  const [layout, setLayout] = useState('card');
  const [fontSize, setFontSize] = useState('13');
  const [showDivider, setShowDivider] = useState(true);
  const [disclaimer, setDisclaimer] = useState('');

  const result = useMemo(() => {
    const size = Math.max(10, Math.min(18, Number(fontSize) || 13));
    const colour = accent;
    const muted = '#5b6472';
    const lines = [];

    if (layout === 'card') {
      lines.push('<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:' + size + 'px;color:#1f2933;">');
      lines.push('  <tr>');
      lines.push('    <td style="width:4px;background:' + colour + ';border-radius:2px;">&nbsp;</td>');
      lines.push('    <td style="padding-left:14px;line-height:1.5;">');
      lines.push('      <div style="font-size:' + (size + 3) + 'px;font-weight:bold;color:#111827;">' + escapeHtml(name) + '</div>');
      lines.push('      <div style="color:' + colour + ';font-weight:600;">' + escapeHtml(title) + '</div>');
      lines.push('      <div style="color:' + muted + ';">' + escapeHtml(company) + '</div>');
      lines.push('      <div style="margin-top:6px;color:' + muted + ';">' + escapeHtml(email) + ' · ' + escapeHtml(phone) + '</div>');
      lines.push('      <div style="color:' + muted + ';">' + escapeHtml(website) + (linkedin ? ' · ' + escapeHtml(linkedin) : '') + '</div>');
      if (address) lines.push('      <div style="color:' + muted + ';font-size:' + (size - 1) + 'px;">' + escapeHtml(address) + '</div>');
      lines.push('    </td>');
      lines.push('  </tr>');
      lines.push('</table>');
    } else if (layout === 'stacked') {
      lines.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:' + size + 'px;line-height:1.55;color:#1f2933;">');
      lines.push('  <div style="font-size:' + (size + 2) + 'px;font-weight:bold;color:#111827;">' + escapeHtml(name) + '</div>');
      lines.push('  <div style="color:' + muted + ';">' + escapeHtml(title) + ', ' + escapeHtml(company) + '</div>');
      if (showDivider) lines.push('  <div style="border-top:1px solid ' + colour + ';width:64px;margin:8px 0;">&nbsp;</div>');
      lines.push('  <div>' + escapeHtml(email) + '</div>');
      lines.push('  <div>' + escapeHtml(phone) + '</div>');
      if (website) lines.push('  <div>' + escapeHtml(website) + '</div>');
      if (linkedin) lines.push('  <div>' + escapeHtml(linkedin) + '</div>');
      if (address) lines.push('  <div style="color:' + muted + ';font-size:' + (size - 1) + 'px;">' + escapeHtml(address) + '</div>');
      lines.push('</div>');
    } else {
      const separator = ' <span style="color:' + colour + ';">|</span> ';
      lines.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:' + size + 'px;color:#1f2933;line-height:1.5;">');
      lines.push('  <div><span style="font-weight:bold;color:#111827;">' + escapeHtml(name) + '</span>' + separator + '<span style="color:' + muted + ';">' + escapeHtml(title) + '</span>' + separator + '<span style="color:' + muted + ';">' + escapeHtml(company) + '</span></div>');
      if (showDivider) lines.push('  <div style="border-top:1px solid ' + colour + ';margin:6px 0;">&nbsp;</div>');
      lines.push('  <div><span style="color:' + muted + ';">' + escapeHtml(email) + '</span>' + separator + '<span style="color:' + muted + ';">' + escapeHtml(phone) + '</span>' + separator + '<span style="color:' + muted + ';">' + escapeHtml(website) + '</span></div>');
      if (linkedin || address) lines.push('  <div style="color:' + muted + ';font-size:' + (size - 1) + 'px;">' + escapeHtml([linkedin, address].filter(Boolean).join(' · ')) + '</div>');
      lines.push('</div>');
    }

    if (disclaimer) {
      lines.push('<div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#7a8494;max-width:520px;line-height:1.45;">' + escapeHtml(disclaimer) + '</div>');
    }

    const html = lines.join('\n');

    const plain = [
      name,
      title + ', ' + company,
      email,
      phone,
      website,
      linkedin,
      address,
      disclaimer,
    ].filter(Boolean).join('\n');

    const stats = {
      characters: html.length,
      kilobytes: (html.length / 1024).toFixed(1),
      images: 0,
      links: [website, linkedin].filter(Boolean).length,
      lines: lines.length,
    };

    const warnings = [];
    if (html.length > 4000) warnings.push('The signature is ' + stats.kilobytes + ' KB of markup. Anything much over about 4 KB starts to look heavy in some clients, mostly because of repeated inline styles.');
    if (!email) warnings.push('There is no email address in the signature. A signature without a reply address is decoration.');
    if (!phone) warnings.push('No phone number. Some recipients will want to call rather than reply.');
    if (linkedin && !/^https?:\/\//.test(linkedin) && linkedin.includes('.com')) warnings.push('Write the LinkedIn link as a full URL with https:// so it becomes clickable in every client.');
    if (/<img/i.test(html)) warnings.push('Images are supported but often blocked by default. Everything here is text, which is why it will always render.');
    if (!company) warnings.push('No company name, which is the first thing an outside recipient looks for to know who you are.');

    return { html, plain, stats, warnings, size };
  }, [name, title, company, email, phone, website, address, linkedin, accent, layout, fontSize, showDivider, disclaimer]);

  return (
    <ToolShell
      toolId="email-signature"
      icon={Mail}
      title="Email Signature Builder"
      desc="A text-only signature that renders in every mail client, in three layouts — with the HTML to copy, a plain-text version for the clients that strip formatting, and checks that catch the usual mistakes."
      state={{ name, title, company, email, phone, website, address, linkedin, accent, layout, fontSize, showDivider, disclaimer }}
      onRestore={(restored) => {
        if (typeof restored.name === 'string') setName(restored.name);
        if (typeof restored.title === 'string') setTitle(restored.title);
        if (typeof restored.company === 'string') setCompany(restored.company);
        if (typeof restored.email === 'string') setEmail(restored.email);
        if (typeof restored.phone === 'string') setPhone(restored.phone);
        if (typeof restored.website === 'string') setWebsite(restored.website);
        if (typeof restored.address === 'string') setAddress(restored.address);
        if (typeof restored.linkedin === 'string') setLinkedin(restored.linkedin);
        if (typeof restored.accent === 'string') setAccent(restored.accent);
        if (restored.layout) setLayout(restored.layout);
        if (restored.fontSize !== undefined) setFontSize(String(restored.fontSize));
        if (typeof restored.showDivider === 'boolean') setShowDivider(restored.showDivider);
        if (typeof restored.disclaimer === 'string') setDisclaimer(restored.disclaimer);
      }}
      exportText={result.html}
      exportName="signature.html"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name"><input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Job title"><input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Company"><input value={company} onChange={(e) => setCompany(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Website"><input value={website} onChange={(e) => setWebsite(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="LinkedIn or profile"><input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Address or location"><input value={address} onChange={(e) => setAddress(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="Accent colour">
          <div className="flex items-center gap-2">
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent" />
            <input value={accent} onChange={(e) => setAccent(e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </div>
        </Field>
      </div>

      <Seg value={layout} onChange={setLayout} options={LAYOUTS} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={'Base font size — ' + fontSize + ' px'}>
          <input type="range" min="11" max="16" value={fontSize} onChange={(e) => setFontSize(e.target.value)} className="w-full accent-cyan-j" />
        </Field>
        <div className="flex items-end">
          <ToggleRow label="Show the accent divider line" checked={showDivider} onChange={setShowDivider} />
        </div>
      </div>

      <Field label="Optional legal or confidentiality line">
        <input value={disclaimer} onChange={(e) => setDisclaimer(e.target.value)} placeholder="This message is confidential and intended only for the named recipient." className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Preview</div>
          <div className="rounded-lg border border-border/60 bg-white p-4 text-[#1f2933]" dangerouslySetInnerHTML={{ __html: result.html }} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Rendered here in a white panel, because that is how it will look in most mail clients — which are light by default, and which will keep your colours even in a dark
            theme.
          </p>
        </Panel>
        <div className="space-y-3">
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Plain-text version</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-card/40 p-2.5 font-mono-j text-[11px]">{result.plain}</pre>
            <div className="mt-2">
              <CopyBtn value={result.plain} label="Copy plain text" />
            </div>
          </Panel>
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Checks</div>
            {result.warnings.length === 0 ? (
              <p className="text-[11px] text-emerald-200">Nothing to flag. The signature is text-only, has a reply address, and carries every detail a recipient needs.</p>
            ) : (
              <div className="space-y-1 text-[11px] text-amber-200">
                {result.warnings.map((line) => <p key={line}>· {line}</p>)}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">HTML to paste into your mail client</span>
          <CopyBtn value={result.html} label="Copy the HTML" />
        </div>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-card/40 p-2.5 font-mono-j text-[10px] text-muted-foreground">{result.html}</pre>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Signature size"
          value={result.stats.kilobytes}
          unit="KB"
          sub={'At ' + result.size + ' px text, this is ' + result.stats.characters.toLocaleString() + ' characters of markup across ' + result.stats.lines + ' lines, with ' + result.stats.links + ' link' + (result.stats.links === 1 ? '' : 's') + ' and no images at all. That is small enough to stay out of the way and robust enough to render everywhere.'}
        />
        <Ring
          value={Math.min(result.stats.characters, 8000)}
          max={8000}
          tone={result.stats.characters < 4000 ? 'emerald' : 'amber'}
          label="Markup weight"
          sub={result.stats.characters < 4000 ? 'Comfortably light for every client' : 'Getting heavy — simplify the layout or drop a field'}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Markup" value={result.stats.characters.toLocaleString() + ' chars'} mono sub={result.stats.kilobytes + ' KB'} />
        <Stat label="Links" value={String(result.stats.links)} mono sub="website and profile" />
        <Stat label="Images" value="none" mono sub="text only, never blocked" />
        <Stat label="Layout" value={layout} mono sub={result.size + ' px base size'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Installing it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Gmail: Settings, then See all settings, then General, scroll to Signature. Create one, paste this with the formatting kept, and save.</p>
            <p>· Outlook: File, then Options, then Mail, then Signatures. Or paste into a new message and use File, Save as, to store it as an .htm file.</p>
            <p>· Apple Mail: Settings, then Signatures, create one, then paste. Uncheck Always match my default message font so the formatting survives.</p>
            <p>· Mobile clients often ignore HTML signatures entirely, so keep the plain-text version handy for your phone.</p>
            <p>· Company-wide signatures managed by an IT department usually want this same HTML pasted into their template. Inline styles are used throughout here precisely so that a template cannot break it.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What makes a signature work</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Keep it to four or five lines of information. Long signatures are skipped by the eye and can trigger spam filtering on very short messages.</p>
            <p>· Text beats images. A logo image is blocked by default in many clients, leaving a broken placeholder where your brand should be.</p>
            <p>· Tables are the one safe layout mechanism, because everything from Outlook to Gmail renders them the same way. This builder uses a table only for the card layout.</p>
            <p>· Inline styles, never a stylesheet. Mail clients strip style blocks and classes, which is why every rule here sits on the element.</p>
            <p>· A dark background often inverts oddly in dark mode. Light backgrounds with dark text survive both themes.</p>
            <p>· Skip the motivational quote and the animated GIF. Neither survives, and both cost you the reader's attention for the things that matter.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Layout', value: layout },
                { label: 'Size', value: result.stats.kilobytes + ' KB' },
                { label: 'Accent', value: accent },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Why the markup looks like this</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>every style is inline, because mail clients strip style blocks and class names</p>
          <p>a table replaces flexbox, because Outlook does not support flexbox or grid</p>
          <p>font stacks are Arial and Helvetica, which exist on every platform and never silently fail</p>
          <p>no web fonts, no images and no background images, none of which are reliably loaded</p>
          <p>line-height and explicit font sizes, so the client does not impose its own scale</p>
          <p className="text-cyan-j">Check: {result.stats.characters.toLocaleString()} characters, {result.stats.lines} lines, zero images.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Some clients still reformat whatever they are given — corporate Outlook templates and dark-mode inversions are the usual offenders. Send yourself a test message and
          check it on a phone before rolling it out.
        </p>
      </Panel>
    </ToolShell>
  );
}