// The suite, inside the arm64 image, against an arm64 database.
//
//   npm run docker:test
//
// WHY THIS EXISTS RATHER THAN A README LINE. "It builds for arm64" and "it
// works on arm64" are different claims, and only the second one matters. A
// cross-compiled image proves the Dockerfile parses; running the tests inside
// it proves the product does what it does on the machine it will run on.
//
// It found two real things the first time it ran, neither of them
// architectural: the test stage was missing `COPY docs` (accounts.test.ts
// reads ACCOUNTS.md), and a test that needs a local postmaster skips rather
// than passing vacuously. Both are the kind of thing that would have surfaced
// as a mysterious failure on the box.
//
// WHAT IT NEEDS: Docker, and qemu registered for arm64 —
//   docker run --privileged --rm tonistiigi/binfmt --install arm64
// On an actual Ampere A1 none of that applies: the image IS native and this
// runs without emulation, several times faster.
import { spawn } from 'node:child_process';

const PLATFORM = process.env['LIAN_TEST_PLATFORM'] ?? 'linux/arm64';
const NETWORK = 'lian-arm-test';
const DB = 'lian-arm-test-db';
const IMAGE = 'lian:arm64-test';

function sh(command: string, args: string[], options: { quiet?: boolean } = {}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: options.quiet === true ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    let out = '';
    child.stdout?.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { out += c.toString(); });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
    child.on('error', () => resolve({ code: 127, out: `${command} is not installed` }));
  });
}

const docker = (args: string[], quiet = false): Promise<{ code: number; out: string }> => sh('docker', args, { quiet });

async function main(): Promise<void> {
  const daemon = await docker(['info'], true);
  if (daemon.code !== 0) {
    console.error('\n  Docker is not running.\n');
    process.exit(78);
  }

  // Emulation, checked rather than assumed. Without it the build succeeds and
  // `docker run` fails with "exec format error", which reads like a corrupt
  // image rather than a missing binfmt handler.
  if (PLATFORM !== 'linux/amd64') {
    const probe = await docker(['run', '--rm', '--platform', PLATFORM, 'alpine', 'true'], true);
    if (probe.code !== 0) {
      console.error(`\n  Cannot run ${PLATFORM} images here — ${probe.out.trim().split('\n').pop()}`);
      console.error('  Register the emulator first:');
      console.error('    docker run --privileged --rm tonistiigi/binfmt --install arm64\n');
      process.exit(78);
    }
  }

  // The CA, only when this machine has one. A build behind a TLS-intercepting
  // proxy needs it; everywhere else the argument is absent entirely.
  const ca = process.env['LIAN_BUILD_CA'] ?? '/root/.ccr/ca-bundle.crt';
  const secret = (await sh('test', ['-s', ca], { quiet: true })).code === 0
    ? ['--secret', `id=proxy_ca,src=${ca}`]
    : [];

  console.log(`\n── building ${IMAGE} for ${PLATFORM} ──`);
  const built = await docker(['build', '--platform', PLATFORM, ...secret, '--target', 'test', '-t', IMAGE, '.']);
  if (built.code !== 0) process.exit(built.code);

  console.log('\n── an arm64 database ──');
  await docker(['network', 'create', NETWORK], true);
  await docker(['rm', '-f', DB], true);
  const started = await docker([
    'run', '-d', '--name', DB, '--platform', PLATFORM, '--network', NETWORK,
    '-e', 'POSTGRES_USER=lian', '-e', 'POSTGRES_PASSWORD=lian', '-e', 'POSTGRES_DB=lian_dev',
    'pgvector/pgvector:pg16',
  ], true);
  if (started.code !== 0) { console.error(started.out); process.exit(started.code); }

  // Emulated Postgres takes a while to come up, and a suite started against a
  // database that is still initialising fails in a way that has nothing to do
  // with the code.
  process.stdout.write('  waiting');
  let ready = false;
  for (let i = 0; i < 90 && !ready; i += 1) {
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    ready = (await docker(['exec', DB, 'pg_isready', '-U', 'lian', '-d', 'lian_dev'], true)).code === 0;
  }
  console.log(ready ? ' ready' : ' NOT READY');
  if (!ready) { await cleanup(); process.exit(1); }

  console.log('\n── the suite, inside the image ──');
  const suite = await docker([
    'run', '--rm', '--platform', PLATFORM, '--network', NETWORK,
    '-e', `DATABASE_URL=postgres://lian:lian@${DB}:5432/lian_dev`,
    IMAGE, 'npm', 'run', 'test:ci',
  ]);

  await cleanup();
  if (suite.code === 0) console.log(`\n  the product runs on ${PLATFORM}.\n`);
  process.exit(suite.code);
}

async function cleanup(): Promise<void> {
  await docker(['rm', '-f', DB], true);
  await docker(['network', 'rm', NETWORK], true);
}

await main();
