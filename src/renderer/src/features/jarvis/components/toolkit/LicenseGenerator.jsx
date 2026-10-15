import { useMemo, useState } from 'react';
import { Award } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat, downloadBlob } from './shared';

const LICENSES = [
  {
    id: 'mit', label: 'MIT', short: 'Permissive, one paragraph, most popular for libraries.',
    text: (year, author) => `MIT License

Copyright (c) ${year} ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
  {
    id: 'isc', label: 'ISC', short: 'Like MIT but shorter — common in npm packages.',
    text: (year, author) => `ISC License

Copyright (c) ${year} ${author}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
  },
  {
    id: 'bsd3', label: 'BSD 3-Clause', short: 'Permissive with a no-endorsement clause.',
    text: (year, author) => `BSD 3-Clause License

Copyright (c) ${year} ${author}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED.`,
  },
  {
    id: 'unlicense', label: 'Unlicense', short: 'Public domain dedication — no conditions at all.',
    text: (year, author) => `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognise copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

Copyright (c) ${year} ${author} (dedicated to the public domain)`,
  },
  {
    id: 'apache', label: 'Apache 2.0', short: 'Permissive plus an explicit patent grant.',
    header: 'Apache License 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    text: (year, author) => `Copyright ${year} ${author}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

# Paste the full licence text from https://www.apache.org/licenses/LICENSE-2.0
# as the LICENSE file — keep this notice near the top of the project.`,
  },
  {
    id: 'gpl3', label: 'GPL 3.0', short: 'Copyleft — derivatives must stay open under the same terms.',
    header: 'GNU General Public License v3.0',
    url: 'https://www.gnu.org/licenses/gpl-3.0.txt',
    text: (year, author) => `Copyright (C) ${year} ${author}

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with
this program. If not, see <https://www.gnu.org/licenses/>.

# Ship the full text from https://www.gnu.org/licenses/gpl-3.0.txt as LICENSE.`,
  },
  {
    id: 'agpl3', label: 'AGPL 3.0', short: 'Like GPL, but network use also counts as distribution.',
    header: 'GNU Affero General Public License v3.0',
    url: 'https://www.gnu.org/licenses/agpl-3.0.txt',
    text: (year, author) => `Copyright (C) ${year} ${author}

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

If you run a modified version on a server, you must offer the source to the
people using it. Full text: https://www.gnu.org/licenses/agpl-3.0.txt`,
  },
  {
    id: 'mpl2', label: 'MPL 2.0', short: 'File-level copyleft — modified files stay open, the rest is yours.',
    header: 'Mozilla Public License 2.0',
    url: 'https://www.mozilla.org/en-US/MPL/2.0/',
    text: (year, author) => `Copyright (c) ${year} ${author}

This Source Code Form is subject to the terms of the Mozilla Public License,
v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain
one at https://mozilla.org/MPL/2.0/.

# Ship the full text from https://www.mozilla.org/en-US/MPL/2.0/ as LICENSE.`,
  },
  {
    id: 'cc0', label: 'CC0 1.0', short: 'Waives rights as far as possible — good for data and docs.',
    header: 'CC0 1.0 Universal',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
    text: (year, author) => `${author} has dedicated this work to the public domain using CC0 1.0.

To the extent possible under law, ${author} has waived all copyright and related
or neighbouring rights to this work. You can copy, modify, distribute and
perform the work, even for commercial purposes, all without asking permission.

Full legal text: https://creativecommons.org/publicdomain/zero/1.0/legalcode`,
  },
  {
    id: 'proprietary', label: 'All rights reserved', short: 'No permission granted — for closed source projects.',
    text: (year, author) => `Copyright (c) ${year} ${author}. All rights reserved.

This software and its source code are proprietary and confidential. No part of
it may be reproduced, distributed, modified, or used to create derivative works
without the prior written permission of the copyright holder.

No licence, express or implied, is granted by making this repository available.`,
  },
];

export default function LicenseGenerator() {
  const [id, setId] = useState('mit');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [author, setAuthor] = useState('');
  const [project, setProject] = useState('');

  const license = LICENSES.find((l) => l.id === id) || LICENSES[0];
  const name = author.trim() || '[your name]';
  const text = license.text(year, name);
  const file = `${text}\n`;

  const badges = useMemo(() => [
    { label: 'Commercial use', value: ['mit', 'isc', 'bsd3', 'apache', 'mpl2', 'cc0', 'unlicense'].includes(id) },
    { label: 'Derivatives must stay open', value: ['gpl3', 'agpl3', 'mpl2'].includes(id) },
    { label: 'Patent grant included', value: ['apache', 'gpl3', 'agpl3', 'mpl2'].includes(id) },
    { label: 'Network use counts as distribution', value: id === 'agpl3' },
  ], [id]);

  const packageJson = `"license": "${id === 'mit' ? 'MIT' : id === 'apache' ? 'Apache-2.0' : id === 'bsd3' ? 'BSD-3-Clause' : id === 'unlicense' ? 'Unlicense' : id === 'cc0' ? 'CC0-1.0' : id.toUpperCase()}"`;

  return (
    <ToolShell
      toolId="license"
      icon={Award}
      title="License Generator"
      desc="Pick a licence, fill in two fields, and get the notice to drop in — plus a plain-English note on what it actually lets people do."
      state={{ id, year, author, project }}
      onRestore={(restored) => {
        if (restored.id) setId(restored.id);
        if (restored.year !== undefined) setYear(String(restored.year));
        if (typeof restored.author === 'string') setAuthor(restored.author);
        if (typeof restored.project === 'string') setProject(restored.project);
      }}
      exportText={file}
      exportName="LICENSE"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([file], { type: 'text/plain' }), 'LICENSE')}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          Download LICENSE
        </button>
        <CopyBtn value={file} label="Copy licence" />
        {license.url && (
          <a
            href={license.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
          >
            Official full text
          </a>
        )}
      </div>

      <Field label="Licence">
        <div className="flex flex-wrap gap-1.5">
          {LICENSES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setId(option.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                id === option.id ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      <p className="text-[11px] text-muted-foreground">{license.short}</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Year">
          <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Copyright holder">
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name or company" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label="Project (optional)">
          <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project name" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What this licence means</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {badges.map((badge) => (
            <div key={badge.label} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${badge.value ? 'border-cyan-j/40 bg-cyan-j/5 text-cyan-j' : 'border-border/50 bg-card/40 text-muted-foreground'}`}>
              <span className="font-mono-j">{badge.value ? 'yes' : 'no'}</span>
              <span>{badge.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5">
          <span className="font-mono-j text-[11px] text-muted-foreground">{packageJson}</span>
          <CopyBtn value={packageJson} label="Copy" />
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">LICENSE file</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{file.split('\n').length} lines</span>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{file}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Licence" value={license.label} />
        <Stat label="Holder" value={name} />
        <Stat label="Length" value={`${file.length} chars`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Short licences like MIT and ISC are reproduced in full here for convenience. For Apache, GPL, AGPL and MPL the canonical document is long
          and must be reproduced verbatim, so this gives you the correct notice plus the exact link to paste in. None of this is legal advice — if
          money or patents are involved, have a lawyer glance at it.
        </p>
      </Panel>
    </ToolShell>
  );
}