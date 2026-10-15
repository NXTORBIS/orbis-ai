import { useState } from 'react';
import { GitMerge, HardDrive, Play } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { CopyBtn, Panel, Seg, Stat } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { foldFrontier, hex, unhex, verifyIndex } from './merkleCore';

const SIZES = [
  { value: 33, label: '33 leaves' },
  { value: 257, label: '257 leaves' },
  { value: 1000, label: '1 000 leaves' },
];

const STORAGE_KEY = 'merkle-index-frontier';

export default function MerkleIndex() {
  const [leafCount, setLeafCount] = useState(257);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [stored, setStored] = useState('');
  const [storageCheck, setStorageCheck] = useState(null);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    setProgress({ phase: 'Hashing leaves' });
    try {
      const outcome = await verifyIndex({ leafCount, seed: Math.floor(Math.random() * 100000), onProgress: setProgress });
      setResult(outcome);
    } catch (thrown) {
      setError(thrown.message || 'The verification could not run.');
    }
    setBusy(false);
    setProgress(null);
  };

  const saveFrontier = () => {
    if (!result) return;
    const payload = { root: result.root, levels: result.roots.length, frontier: result.frontier.map(hex) };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setStored(`${payload.frontier.length} frontier node(s) and the root stored at size ${payload.levels}`);
      setStorageCheck(null);
    } catch (thrown) {
      setError(thrown.message);
    }
  };

  const reloadFrontier = async () => {
    try {
      const payload = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!payload) {
        setError('Nothing is stored yet — save the frontier first.');
        return;
      }
      const folded = hex(await foldFrontier(payload.frontier.map((text) => unhex(text))));
      setStorageCheck({ matches: folded === payload.root, folded, stored: payload.root });
    } catch (thrown) {
      setError(thrown.message);
    }
  };

  const storage = result?.store;

  return (
    <ToolShell
      toolId="merkle-index"
      icon={GitMerge}
      title="Persistent Merkle Index Engine"
      desc="An append-only authenticated log built to RFC 6962 with a content-addressed block store: incremental roots from a frontier stack, inclusion and consistency proofs, deduplication, and tamper detection."
      state={{ leafCount }}
      onRestore={(state) => { if (state?.leafCount) setLeafCount(state.leafCount); }}
      exportText={result ? [
        `leaves ${result.leafCount}`,
        `root ${result.root}`,
        ...result.consistency.map((entry) => `consistency ${entry.m}:${entry.n} — ${entry.proofNodes} node(s), ${entry.verified ? 'verified' : 'failed'}`),
      ].join('\n') : ''}
      exportName="merkle-roots.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={leafCount} onChange={(value) => { setLeafCount(value); setResult(null); }} options={SIZES} />
        <Button size="sm" onClick={run} disabled={busy} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Run verification</Button>
        <Button size="sm" variant="outline" onClick={saveFrontier} disabled={!result}>Save frontier</Button>
        <Button size="sm" variant="outline" onClick={reloadFrontier}>Reload and fold</Button>
      </div>

      <EngineProgress busy={busy} phase={progress?.phase} done={progress?.done} total={progress?.total} />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}
      {stored && <div className="rounded-lg border border-border/60 px-3 py-2 font-mono-j text-[11px] text-muted-foreground">{stored}</div>}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
            <Hero
              label="Inclusion proofs verified"
              value={`${result.inclusion.pass}/${result.inclusion.size}`}
              tone={result.inclusion.fail === 0 ? 'emerald' : 'amber'}
              sub={`${result.consistency.length} consistency proofs, all ${result.consistency.every((entry) => entry.verified) ? 'verified' : 'not verified'}`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Root against the definition" value={result.incrementalMatchesDefinition ? 'identical' : `${result.rootMismatches} mismatches`} sub={`checked at every size from 1 to ${result.leafCount}`} mono />
              <Stat label="Frontier" value={`${result.frontierNodes} node(s)`} sub={result.resumedFromFrontierMatches ? 'resumes to the same root' : 'resume mismatch'} mono />
            </div>
          </div>

          <Panel>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Root</span>
              <CopyBtn value={result.root} />
            </div>
            <p className="break-all font-mono-j text-[11px] text-cyan-j">{result.root}</p>
            <div className="mt-2 max-h-40 space-y-1 overflow-auto scrollbar-thin">
              {result.roots
                .map((root, index) => ({ root, size: index + 1 }))
                .filter((entry) => entry.size % Math.max(1, Math.floor(result.roots.length / 24)) === 0 || entry.size === result.roots.length)
                .map((entry) => (
                  <div key={entry.root} className="flex items-center justify-between gap-2 font-mono-j text-[10px] text-muted-foreground">
                    <span>size {entry.size}</span>
                    <span className="truncate">{entry.root.slice(0, 24)}…</span>
                  </div>
                ))}
            </div>
            {storageCheck && (
              <p className={`mt-2 font-mono-j text-[11px] ${storageCheck.matches ? 'text-emerald-400' : 'text-amber-400'}`}>
                {storageCheck.matches ? 'The reloaded frontier folds back to the stored root.' : `Reloaded frontier folds to ${storageCheck.folded.slice(0, 16)}…, not ${storageCheck.stored.slice(0, 16)}…`}
              </p>
            )}
          </Panel>

          <div className="grid gap-3 md:grid-cols-2">
            <Panel>
              <div className="mb-2 text-xs font-semibold">Consistency proofs</div>
              <div className="space-y-1.5">
                {result.consistency.map((entry) => (
                  <div key={`${entry.m}-${entry.n}`} className="flex items-center justify-between rounded-lg border border-border/50 px-2.5 py-1.5 font-mono-j text-[11px]">
                    <span>{entry.m} → {entry.n}</span>
                    <span className="text-muted-foreground">{entry.proofNodes} node(s)</span>
                    <span className={entry.verified ? 'text-emerald-400' : 'text-amber-400'}>{entry.verified ? 'verified' : 'failed'}</span>
                    <span className="text-muted-foreground">{entry.wrongSizeRejected && entry.swappedRootsRejected && entry.tamperedProofRejected ? 'negatives rejected' : 'negative accepted'}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><HardDrive className="h-3.5 w-3.5" /> Content store</div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Blocks written</span><span className="font-mono-j">{storage.totalBytes.toLocaleString()} B</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Stored once</span><span className="font-mono-j text-cyan-j">{storage.uniqueBytes.toLocaleString()} B</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Saved by deduplication</span><span className="font-mono-j">{storage.sharedBytes.toLocaleString()} B</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Shared blocks</span><span className="font-mono-j">{storage.duplicateRefs}</span></div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">A block's name is the hash of its bytes, so identical content occupies one entry no matter how many files reference it.</p>
            </Panel>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-semibold">Proof size against tree size</div>
            <Bars data={result.consistency.map((entry) => ({ label: `${entry.m}→${entry.n}`, value: entry.proofNodes }))} />
          </Panel>

          <Pills items={[
            { label: 'leaves', value: result.leafCount },
            { label: 'frontier', value: `${result.frontierNodes} hashes` },
            { label: 'inclusion proofs', value: result.inclusion.pass },
            { label: 'proof nodes', value: result.consistency.reduce((sum, entry) => sum + entry.proofNodes, 0) },
          ]} />

          <VerifyPanel
            items={[
              { label: 'Incremental root equals the recursive definition', ok: result.incrementalMatchesDefinition, detail: `${result.rootMismatches} mismatches across ${result.sizesChecked} sizes checked` },
              { label: 'Every inclusion proof verifies', ok: result.inclusion.fail === 0, detail: `${result.inclusion.pass} checked` },
              { label: 'Wrong leaves and wrong indices are rejected', ok: result.inclusion.wrongLeafRejected === result.inclusion.size && result.inclusion.wrongIndexRejected === result.inclusion.size, detail: `${result.inclusion.wrongLeafRejected} leaves, ${result.inclusion.wrongIndexRejected} indices` },
              { label: 'Consistency proofs verify and their negatives fail', ok: result.consistency.every((entry) => entry.verified && entry.wrongSizeRejected && entry.swappedRootsRejected && entry.tamperedProofRejected), detail: `${result.consistency.length} pairs` },
              { label: 'The persisted frontier folds back to its root', ok: result.persistedFrontierMatches, detail: result.resumedFromFrontierMatches ? 'and resuming from it reproduces the full root' : 'resume mismatch' },
              { label: 'Store reads clean, detects tampering, then reads clean again', ok: storage.cleanRead && storage.tamperDetected && storage.restoredClean, detail: storage.tamperDetected ? 'a flipped byte was caught by the block name' : 'tampering was not caught' },
            ]}
            note="Consistency is checked against the direct question — is the older root a prefix of the newer tree — as well as by proof, and the same proofs are re-run with a wrong size, swapped roots and a flipped hash to confirm the verifier is not simply accepting everything."
          />
        </>
      )}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Leaves hash as SHA-256(0x00 ‖ data) and internal nodes as SHA-256(0x01 ‖ left ‖ right), so a leaf can never be mistaken for an interior node.</p>
          <p>· The frontier keeps one hash per level: appending a leaf merges it with the stored subtrees of equal level, and the root is the fold of what remains. That is why reloading a saved frontier reproduces the same root without the leaves.</p>
          <p>· Proofs are verified by replaying the path, with the left/right choice derived from the leaf index — which is what makes a proof for the wrong position fail rather than pass.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}