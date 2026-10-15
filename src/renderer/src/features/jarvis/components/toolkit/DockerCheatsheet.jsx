import { Container } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import CheatsheetBoard, { CopyAll } from './CheatsheetBoard';

const GROUPS = [
  {
    id: 'images', label: 'Images', note: 'build, ship, run',
    items: [
      { cmd: 'docker build -t app:1.0 .', what: 'Build an image from the Dockerfile in this folder' },
      { cmd: 'docker run -d -p 8080:80 --name web app:1.0', what: 'Run detached, map host 8080 to container 80' },
      { cmd: 'docker run -it --rm ubuntu bash', what: 'Throwaway interactive shell in a container' },
      { cmd: 'docker run -v "$PWD":/work -w /work node:20 npm test', what: 'Mount the current folder and run tests' },
      { cmd: 'docker ps -a', what: 'Every container, running or stopped' },
      { cmd: 'docker images', what: 'Images on this machine with sizes' },
      { cmd: 'docker logs -f --tail 100 web', what: 'Follow the last 100 log lines' },
      { cmd: 'docker exec -it web sh', what: 'Shell into a running container' },
      { cmd: 'docker stop web && docker rm web', what: 'Stop and remove a container' },
      { cmd: 'docker rmi app:1.0', what: 'Delete an image' },
    ],
  },
  {
    id: 'cleanup', label: 'Cleanup', note: 'reclaim disk',
    items: [
      { cmd: 'docker system df', what: 'How much disk images, containers and volumes use' },
      { cmd: 'docker system prune -a --volumes', what: 'Remove everything unused — careful, volumes go too' },
      { cmd: 'docker container prune', what: 'Remove all stopped containers' },
      { cmd: 'docker image prune -a', what: 'Remove images with no container using them' },
      { cmd: 'docker volume ls && docker volume rm name', what: 'List and delete a volume' },
      { cmd: 'docker builder prune', what: 'Drop the build cache' },
    ],
  },
  {
    id: 'inspect', label: 'Inspect & debug', note: 'when it breaks',
    items: [
      { cmd: 'docker inspect web', what: 'Full JSON config: IP, mounts, env, health' },
      { cmd: 'docker stats', what: 'Live CPU, memory and network per container' },
      { cmd: 'docker top web', what: 'Processes running inside a container' },
      { cmd: 'docker diff web', what: 'Files changed inside a container' },
      { cmd: 'docker cp web:/app/log.txt .', what: 'Copy a file out of a container' },
      { cmd: 'docker events --since 10m', what: 'What the daemon has been doing' },
    ],
  },
  {
    id: 'compose', label: 'Compose', note: 'docker compose',
    items: [
      { cmd: 'docker compose up -d --build', what: 'Start the stack in the background, rebuilding images' },
      { cmd: 'docker compose down -v', what: 'Stop everything and remove volumes' },
      { cmd: 'docker compose logs -f api', what: 'Follow one service log' },
      { cmd: 'docker compose exec api sh', what: 'Shell into a service container' },
      { cmd: 'docker compose ps', what: 'Service status for this project' },
      { cmd: 'docker compose restart api', what: 'Restart a single service' },
      { cmd: 'docker compose config', what: 'Validate and print the resolved file' },
      { cmd: 'docker compose pull && docker compose up -d', what: 'Update to newer image tags' },
      { cmd: 'docker compose run --rm api npm run migrate', what: 'One-off command in a service' },
    ],
  },
  {
    id: 'registry', label: 'Registry & volumes', note: 'shipping data',
    items: [
      { cmd: 'docker login', what: 'Authenticate to a registry' },
      { cmd: 'docker tag app:1.0 user/app:1.0', what: 'Add a registry-qualified tag' },
      { cmd: 'docker push user/app:1.0', what: 'Upload the image' },
      { cmd: 'docker pull postgres:16', what: 'Download an image' },
      { cmd: 'docker save app:1.0 | gzip > app.tgz', what: 'Export an image to a file' },
      { cmd: 'docker load < app.tgz', what: 'Import an image file' },
      { cmd: 'docker network ls', what: 'List networks' },
      { cmd: 'docker volume create data', what: 'Create a named volume' },
    ],
  },
];

const FOOTER = 'Handy mental model: an image is the recipe, a container is the cooked dish, a volume is the tupperware and a network is the table they all sit at. Add --rm to any throwaway container so you never collect clutter by accident.';

export default function DockerCheatsheet() {
  return (
    <ToolShell
      toolId="docker-cheatsheet"
      icon={Container}
      title="Docker & Compose Cheat Sheet"
      desc="The commands you actually reach for while building images, reading logs and bringing a stack up — searchable, with one-tap copy."
      exportText={GROUPS.map((g) => `# ${g.label}\n${g.items.map((i) => `${i.cmd}\t# ${i.what}`).join('\n')}`).join('\n\n')}
      exportName="docker-cheatsheet.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyAll groups={GROUPS} label="Copy full sheet" />
        <span className="text-[11px] text-muted-foreground">Click any command to copy it on its own.</span>
      </div>
      <CheatsheetBoard groups={GROUPS} placeholder="Search commands — prune, compose, exec, logs…" footer={FOOTER} />
    </ToolShell>
  );
}