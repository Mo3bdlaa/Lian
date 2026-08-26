// The entry point.
//
//   node apps/server/src/main.ts
//
// No build step: Node 22 runs the TypeScript directly, which is why there is
// no dist/ anywhere in this repository and why a deployment is `node
// src/main.ts` rather than a pipeline.
import { migrate } from '@lian/db';
import { closeDb } from '@lian/db';
import { createApplication } from './app.ts';
import { fromProcess, ConfigError } from './config.ts';

async function main(): Promise<void> {
  const { config, degraded } = fromProcess();

  // Every degradation, once, at boot. A fallback nobody can see is a fallback
  // that becomes the production configuration by accident.
  for (const note of degraded) console.warn(`degraded: ${note}`);

  await migrate((line) => { console.log(line); });

  const { server } = createApplication(config);
  server.listen(config.port, () => {
    console.log(`lian listening on ${config.publicUrl} (${config.nodeEnv})`);
    if (config.tickSecret === null) console.warn('no LIAN_TICK_SECRET: nothing proactive will run — /api/tick refuses every call');
  });

  // A shutdown that drops an in-flight turn charges for a message nobody
  // received, so the socket closes first and the pool closes after.
  const shutdown = (signal: string) => {
    console.log(`${signal}: closing`);
    server.close(() => {
      void closeDb().then(() => process.exit(0));
    });
    // If something is wedged, do not hang the deployment forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(78); // EX_CONFIG
  }
  console.error(error);
  process.exit(1);
});
