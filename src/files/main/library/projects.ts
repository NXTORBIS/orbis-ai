import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Project detection from well-known marker files. A folder is reported as a
 * project only when a recognised marker is present (package.json, Cargo.toml,
 * go.mod, pyproject.toml, …); a folder that merely contains source code is not
 * assumed to be one. Users can still define a plain folder project explicitly.
 */

export interface DetectedProject {
  kind: string;
  name: string;
  markers: string[];
}

const MARKERS: Array<{ file: string | RegExp; kind: string; name?: (text: string) => string | undefined }> = [
  { file: 'package.json', kind: 'Node.js', name: (t) => (JSON.parse(t) as { name?: string }).name },
  { file: 'Cargo.toml', kind: 'Rust', name: (t) => /\[package\][^[]*?name\s*=\s*"([^"]+)"/.exec(t)?.[1] },
  { file: 'go.mod', kind: 'Go', name: (t) => /^module\s+(\S+)/m.exec(t)?.[1]?.split('/').pop() },
  { file: 'pyproject.toml', kind: 'Python', name: (t) => /\[(?:project|tool\.poetry)\][^[]*?name\s*=\s*"([^"]+)"/.exec(t)?.[1] },
  { file: 'setup.py', kind: 'Python' },
  { file: 'requirements.txt', kind: 'Python' },
  { file: 'pom.xml', kind: 'Java (Maven)', name: (t) => /<artifactId>([^<]+)<\/artifactId>/.exec(t)?.[1] },
  { file: 'build.gradle', kind: 'Java/Kotlin (Gradle)' },
  { file: 'build.gradle.kts', kind: 'Kotlin (Gradle)' },
  { file: /\.sln$/i, kind: '.NET solution' },
  { file: /\.csproj$/i, kind: '.NET' },
  { file: 'CMakeLists.txt', kind: 'C/C++ (CMake)', name: (t) => /project\s*\(\s*([\w.-]+)/i.exec(t)?.[1] },
  { file: 'Makefile', kind: 'Make' },
  { file: 'Gemfile', kind: 'Ruby' },
  { file: 'composer.json', kind: 'PHP', name: (t) => (JSON.parse(t) as { name?: string }).name },
  { file: 'pubspec.yaml', kind: 'Dart/Flutter', name: (t) => /^name:\s*(\S+)/m.exec(t)?.[1] },
  { file: 'Package.swift', kind: 'Swift' },
  { file: /\.xcodeproj$/i, kind: 'Xcode' },
  { file: 'deno.json', kind: 'Deno' },
  { file: '.git', kind: 'Git repository' },
];

export async function detectProject(dir: string): Promise<DetectedProject | undefined> {
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  const found: Array<{ kind: string; marker: string; name?: string }> = [];
  for (const m of MARKERS) {
    const hit = typeof m.file === 'string' ? (names.includes(m.file) ? m.file : undefined) : names.find((n) => (m.file as RegExp).test(n));
    if (!hit) continue;
    let name: string | undefined;
    if (m.name) {
      try {
        const st = await fsp.stat(path.join(dir, hit));
        if (st.isFile() && st.size < 1024 * 1024) name = m.name(await fsp.readFile(path.join(dir, hit), 'utf8'))?.trim() || undefined;
      } catch {
        /* unreadable or malformed marker: still a marker */
      }
    }
    found.push({ kind: m.kind, marker: hit, name });
  }
  if (!found.length) return undefined;
  // The most specific marker decides the kind; Git alone only says "repository".
  const primary = found.find((f) => f.kind !== 'Git repository' && f.kind !== 'Make') ?? found[0]!;
  return { kind: primary.kind, name: found.find((f) => f.name)?.name ?? path.basename(dir), markers: found.map((f) => f.marker) };
}

/** Walk up from `p` to find the nearest folder that is a project (stops at `stopAt` or the root). */
export async function nearestProject(p: string, stopAt?: string): Promise<{ root: string; project: DetectedProject } | undefined> {
  let dir = p;
  const st = await fsp.stat(p).catch(() => undefined);
  if (!st?.isDirectory()) dir = path.dirname(p);
  for (let i = 0; i < 64; i++) {
    const proj = await detectProject(dir);
    if (proj) return { root: dir, project: proj };
    const parent = path.dirname(dir);
    if (parent === dir || (stopAt && dir === stopAt)) return undefined;
    dir = parent;
  }
  return undefined;
}
