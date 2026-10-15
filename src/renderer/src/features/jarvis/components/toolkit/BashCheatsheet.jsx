import { Terminal } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import CheatsheetBoard, { CopyAll } from './CheatsheetBoard';

const GROUPS = [
  {
    id: 'files', label: 'Files & folders', note: 'navigation and moving data',
    items: [
      { cmd: 'ls -lah', what: 'List everything with sizes, human readable' },
      { cmd: 'cd -', what: 'Jump back to the previous folder' },
      { cmd: 'find . -name "*.log" -mtime -7', what: 'Logs changed in the last week' },
      { cmd: 'find . -type f -size +100M', what: 'Anything over 100 MB' },
      { cmd: 'du -sh */ | sort -h', what: 'Which folders are eating the disk' },
      { cmd: 'cp -r src backup/', what: 'Copy a folder recursively' },
      { cmd: 'rsync -avz --delete src/ host:/srv/app/', what: 'Sync a folder, removing strays' },
      { cmd: 'tar -czf backup.tgz folder/', what: 'Compress a folder' },
      { cmd: 'tar -xzf backup.tgz', what: 'Extract a tarball' },
      { cmd: 'ln -s /srv/app/current /var/www', what: 'Symlink a release folder' },
      { cmd: 'chmod -R u+rwX,go-rwx secret/', what: 'Lock a folder to your user only' },
      { cmd: 'chown -R www-data:www-data /var/www', what: 'Hand ownership to the web server' },
    ],
  },
  {
    id: 'search', label: 'Search & inspect', note: 'grep, sed, awk',
    items: [
      { cmd: 'grep -rn "TODO" --include="*.js" .', what: 'Search recursively with line numbers' },
      { cmd: 'grep -v "^#" config | sort -u', what: 'Drop comments and duplicates' },
      { cmd: 'grep -oE "[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+" access.log | sort | uniq -c | sort -rn | head', what: 'Top IPs in a log' },
      { cmd: 'sed -n "10,40p" file.txt', what: 'Print lines 10 to 40' },
      { cmd: 'sed -i.bak "s/old/new/g" file.txt', what: 'Replace in place, keeping a backup' },
      { cmd: 'awk -F, "{print $1, $3}" data.csv', what: 'Print chosen CSV columns' },
      { cmd: 'awk "{sum+=$1} END {print sum}" numbers.txt', what: 'Sum the first column' },
      { cmd: 'wc -l file.txt', what: 'Count lines' },
      { cmd: 'tail -f app.log | grep -i error', what: 'Watch a log for errors live' },
      { cmd: 'jq ".items[] | .name" data.json', what: 'Pull fields out of JSON (if jq installed)' },
      { cmd: 'cut -d: -f1 /etc/passwd | sort', what: 'Usernames on this machine' },
      { cmd: 'diff -u old.conf new.conf', what: 'What changed between two files' },
    ],
  },
  {
    id: 'process', label: 'Processes & system', note: 'what is running',
    items: [
      { cmd: 'ps aux | grep node', what: 'Find a process by name' },
      { cmd: 'top -o %MEM', what: 'Live view sorted by memory' },
      { cmd: 'kill -15 <pid>', what: 'Ask a process to stop gracefully' },
      { cmd: 'kill -9 <pid>', what: 'Force kill — last resort' },
      { cmd: 'lsof -i :3000', what: 'What is using port 3000' },
      { cmd: 'kill $(lsof -t -i:3000)', what: 'Free that port' },
      { cmd: 'uptime && free -h && df -h', what: 'Load, memory and disk in three lines' },
      { cmd: 'systemctl status nginx', what: 'Service status' },
      { cmd: 'journalctl -u nginx -f --since "10 min ago"', what: 'Follow service logs' },
      { cmd: 'nohup node server.js > out.log 2>&1 &', what: 'Keep it running after you disconnect' },
      { cmd: 'crontab -l', what: 'Your scheduled jobs' },
    ],
  },
  {
    id: 'network', label: 'Network', note: 'reachability and transfer',
    items: [
      { cmd: 'curl -sSL -o file.tgz https://example.com/file.tgz', what: 'Download following redirects' },
      { cmd: 'curl -I https://example.com', what: 'Headers only — quick health check' },
      { cmd: 'curl -X POST -H "Content-Type: application/json" -d @body.json https://api.example.com', what: 'POST a JSON file' },
      { cmd: 'curl -u user:pass https://api.example.com', what: 'Basic auth request' },
      { cmd: 'ss -tulpn', what: 'Listening ports and who owns them' },
      { cmd: 'ping -c 4 1.1.1.1', what: 'Basic reachability' },
      { cmd: 'dig +short example.com MX', what: 'Mail records for a domain' },
      { cmd: 'traceroute example.com', what: 'Where the route slows down' },
      { cmd: 'scp -r ./dist user@host:/var/www', what: 'Copy a folder to a server' },
      { cmd: 'ssh -L 5432:localhost:5432 user@host', what: 'Tunnel a remote port locally' },
    ],
  },
  {
    id: 'shell', label: 'Shell craft', note: 'shortcuts and one-liners',
    items: [
      { cmd: 'history | grep docker', what: 'Find a command you ran before' },
      { cmd: '!$', what: 'Reuse the last argument of the previous command' },
      { cmd: 'command > out.txt 2>&1', what: 'Send stdout and stderr to one file' },
      { cmd: 'command | tee out.txt', what: 'Show output and save it at the same time' },
      { cmd: 'for f in *.png; do echo "$f"; done', what: 'Loop over files' },
      { cmd: 'xargs -n1 -P4', what: 'Run four jobs in parallel from stdin' },
      { cmd: 'Ctrl+R', what: 'Reverse search your history' },
      { cmd: 'Ctrl+Z then bg', what: 'Suspend a job, then run it in the background' },
      { cmd: 'alias gs="git status -sb"', what: 'A shortcut you will actually use' },
      { cmd: 'set -euo pipefail', what: 'Fail fast at the top of any script' },
    ],
  },
];

const FOOTER = 'Paste any command straight from here — each row copies on click. Two habits worth building: quote your variables ("$file") so spaces never bite you, and keep set -euo pipefail at the top of scripts so a failure stops the run instead of cascading.';

export default function BashCheatsheet() {
  return (
    <ToolShell
      toolId="bash-cheatsheet"
      icon={Terminal}
      title="Linux & Bash Cheat Sheet"
      desc="Files, search, processes, network and shell tricks in one searchable board — the commands that save you when you are on a server at midnight."
      exportText={GROUPS.map((g) => `# ${g.label}\n${g.items.map((i) => `${i.cmd}\t# ${i.what}`).join('\n')}`).join('\n\n')}
      exportName="bash-cheatsheet.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyAll groups={GROUPS} label="Copy full sheet" />
        <span className="text-[11px] text-muted-foreground">Click any line to copy just that command.</span>
      </div>
      <CheatsheetBoard groups={GROUPS} placeholder="Search — find, grep, lsof, curl, xargs…" footer={FOOTER} />
    </ToolShell>
  );
}