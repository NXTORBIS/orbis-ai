import { useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Panel, useCopy } from './shared';
import ToolShell from './kit/ToolShell';

const GROUPS = ['Basics', 'Undo', 'Branching', 'Remote', 'Stash', 'History', 'Tags', 'Advanced'];

const COMMANDS = [
  ['Basics', 'git init', 'Start a new repository in this folder'],
  ['Basics', 'git clone <url>', 'Copy an existing repository to your machine'],
  ['Basics', 'git status', 'See what changed, what is staged and what is untracked'],
  ['Basics', 'git add .', 'Stage every change in the current folder'],
  ['Basics', 'git add -p', 'Stage parts of a file, hunk by hunk'],
  ['Basics', 'git commit -m "message"', 'Save staged changes with a message'],
  ['Basics', 'git commit --amend', 'Rewrite the last commit (message or contents)'],
  ['Basics', 'git diff', 'Show unstaged changes'],
  ['Basics', 'git diff --staged', 'Show what is staged for the next commit'],
  ['Basics', 'git restore <file>', 'Throw away changes in a working file'],
  ['Basics', 'git restore --staged <file>', 'Unstage a file, keeping its changes'],
  ['Undo', 'git reset --soft HEAD~1', 'Undo the last commit, keep changes staged'],
  ['Undo', 'git reset --mixed HEAD~1', 'Undo the last commit, keep changes unstaged'],
  ['Undo', 'git reset --hard HEAD~1', 'Delete the last commit and its changes — careful'],
  ['Undo', 'git revert <commit>', 'Create a new commit that undoes an old one (safe on shared branches)'],
  ['Undo', 'git checkout -- <file>', 'Restore a file from the last commit'],
  ['Undo', 'git reflog', 'Find any commit you thought you lost'],
  ['Undo', 'git clean -fd', 'Delete untracked files and folders'],
  ['Branching', 'git branch', 'List local branches'],
  ['Branching', 'git switch -c <name>', 'Create and switch to a new branch'],
  ['Branching', 'git switch <name>', 'Switch to an existing branch'],
  ['Branching', 'git branch -d <name>', 'Delete a merged branch'],
  ['Branching', 'git branch -D <name>', 'Force-delete a branch'],
  ['Branching', 'git merge <branch>', 'Merge another branch into the current one'],
  ['Branching', 'git merge --no-ff <branch>', 'Merge with an explicit merge commit'],
  ['Branching', 'git rebase <branch>', 'Replay your commits on top of another branch'],
  ['Branching', 'git rebase -i HEAD~3', 'Squash, reorder or edit the last three commits'],
  ['Branching', 'git cherry-pick <commit>', 'Copy one commit onto the current branch'],
  ['Remote', 'git remote -v', 'Show the remotes and their URLs'],
  ['Remote', 'git remote add origin <url>', 'Connect a local repo to a remote'],
  ['Remote', 'git fetch --all --prune', 'Download updates and drop deleted remote branches'],
  ['Remote', 'git pull --rebase', 'Fetch and replay your work on top of the latest'],
  ['Remote', 'git push -u origin <branch>', 'Push a branch and set its upstream'],
  ['Remote', 'git push --force-with-lease', 'Safer force push — fails if someone else pushed'],
  ['Remote', 'git push origin --delete <branch>', 'Delete a branch on the remote'],
  ['Stash', 'git stash push -m "wip"', 'Park your changes and get a clean tree'],
  ['Stash', 'git stash list', 'List everything you parked'],
  ['Stash', 'git stash pop', 'Re-apply the newest stash and remove it'],
  ['Stash', 'git stash apply stash@{2}', 'Re-apply a specific stash but keep it'],
  ['Stash', 'git stash drop stash@{0}', 'Delete a stash'],
  ['History', 'git log --oneline --graph --all', 'Compact visual history of every branch'],
  ['History', 'git log -p <file>', 'History with the actual changes to one file'],
  ['History', 'git log --author="name"', 'Commits by one author'],
  ['History', 'git blame <file>', 'Who last changed each line, and in which commit'],
  ['History', 'git show <commit>', 'Inspect one commit in full'],
  ['History', 'git shortlog -sn', 'Commit counts per author'],
  ['History', 'git log -S "text"', 'Find commits that added or removed a string'],
  ['Tags', 'git tag v1.0.0', 'Create a lightweight tag'],
  ['Tags', 'git tag -a v1.0.0 -m "release"', 'Create an annotated tag with a message'],
  ['Tags', 'git push origin v1.0.0', 'Push one tag to the remote'],
  ['Tags', 'git push --tags', 'Push all local tags'],
  ['Tags', 'git tag -d v1.0.0', 'Delete a local tag'],
  ['Advanced', 'git bisect start', 'Binary-search history to find the commit that broke things'],
  ['Advanced', 'git worktree add ../hotfix main', 'Check out another branch in a separate folder'],
  ['Advanced', 'git grep -n "todo"', 'Search tracked files with line numbers'],
  ['Advanced', 'git archive --format=zip HEAD -o src.zip', 'Export a clean copy of the repo without .git'],
  ['Advanced', 'git config --global alias.st status', 'Create your own shorthand commands'],
  ['Advanced', 'git commit --fixup <commit>', 'Mark a commit as a fixup for later autosquash'],
];

export default function GitCheatsheet() {
  const [group, setGroup] = useState('All');
  const [query, setQuery] = useState('');
  const { copied, copy } = useCopy();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter(([g, cmd, desc]) => (group === 'All' || g === group) && (!q || cmd.toLowerCase().includes(q) || desc.toLowerCase().includes(q)));
  }, [group, query]);

  return (
    <ToolShell
      toolId="git-cheatsheet"
      icon={GitBranch}
      title="Git Cheat Sheet"
      desc="The commands you actually reach for, grouped and searchable. Tap any row to copy it."
      state={{ group, query }}
      onRestore={(saved) => { setGroup(saved.group || 'All'); setQuery(saved.query || ''); }}
    >
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search commands — undo, rebase, stash…" />
      <div className="flex flex-wrap gap-1.5">
        {['All', ...GROUPS].map((g) => (
          <button key={g} onClick={() => setGroup(g)} className={`rounded-lg border px-2.5 py-1 text-xs transition ${group === g ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{g}</button>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">{filtered.length} commands</div>
      <Panel>
        <div className="divide-y divide-border/50">
          {filtered.map(([g, cmd, desc]) => (
            <button key={cmd} onClick={() => copy(cmd)} className="flex w-full items-start gap-3 py-2.5 text-left transition hover:bg-accent/40">
              <div className="min-w-0 flex-1">
                <div className="font-mono-j text-xs text-cyan-j">{cmd}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
              </div>
              <span className="shrink-0 pt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{copied === cmd ? 'copied' : g}</span>
            </button>
          ))}
        </div>
        {!filtered.length && <p className="py-4 text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
      </Panel>
    </ToolShell>
  );
}