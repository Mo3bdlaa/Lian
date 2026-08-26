// The one command.
//
//   npm run up
//
// Reads .env, brings the database up, starts the server, and starts the
// external ticker beside it — the two processes a real deployment runs.
// Running the ticker locally matters: the schedule is the product's
// defining behaviour, and a local setup without it looks like a chat app.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;

/** .env, parsed here rather than with a dependency. Existing environment
 *  variables win, so `DATABASE_URL=... npm run up` behaves as expected. */
function loadDotEnv(): void {
  const path = `${ROOT}.env`;
  if (!existsSync(path)) {
    console.log('no .env — using the environment as it is (see .env.example)');
    return;
  }
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const value = match[2]!.trim().replace(/^["'](.*)["']$/, '$1');
    if (process.env[match[1]!] === undefined && value !== '') process.env[match[1]!] = value;
  }
}

function run(label: string, script: string): ChildProcess {
  const child = spawn(process.execPath, [`${ROOT}${script}`], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (stream: NodeJS.ReadableStream, to: NodeJS.WriteStream) => {
    stream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line !== '') to.write(`[${label}] ${line}\n`);
    });
  };
  prefix(child.stdout!, process.stdout);
  prefix(child.stderr!, process.stderr);
  return child;
}

loadDotEnv();

// Migrations first, in this process, so a schema problem stops everything
// before two servers start against a database that cannot serve them.
const { execPath } = process;
const { status } = (await import('node:child_process')).spawnSync(execPath, [`${ROOT}tools/db/up.ts`], { env: process.env, stdio: 'inherit' });
if (status !== 0) process.exit(status ?? 1);

const children = [run('server', 'apps/server/src/main.ts'), run('ticker', 'apps/server/src/ticker.ts')];

// If either dies, take the other with it: half of this is not a running
// product, and a ticker talking to nothing fills a log with 500s.
for (const child of children) {
  child.on('exit', (code) => {
    for (const other of children) if (other !== child) other.kill('SIGTERM');
    process.exit(code ?? 1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { for (const child of children) child.kill(signal); });
}
