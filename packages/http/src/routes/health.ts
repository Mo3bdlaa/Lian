// Liveness and readiness, which are different questions.
//
// THE DISTINCTION IS THE WHOLE FILE, because getting it backwards is worse
// than having neither:
//
//   /health/live      Is this process wedged?
//                     Answered WITHOUT touching anything external. A liveness
//                     probe that checks the database restarts the app when
//                     the DATABASE is down — which fixes nothing, drops every
//                     in-flight stream, and turns a dependency's bad minute
//                     into a restart loop that outlasts it.
//
//   /health/ready     Should this process be sent traffic?
//                     Answered by asking each dependency SEPARATELY, so the
//                     answer names which one. "Not ready" is a fact about the
//                     deployment; "not ready: storage" is something somebody
//                     can act on at two in the morning.
//
// AND IT MUST FAIL LOUDLY. The failure mode this replaces is the one every
// health endpoint has by default: 200 OK while the database is unreachable,
// because the handler returns a literal. Every check here calls the thing it
// claims to check, and a check that cannot be performed reports as unknown
// rather than as healthy.
import type { Handler } from '../router.ts';

/**
 * One dependency's answer.
 *
 * `unknown` is a real state and is deliberately not `ok`: a deployment with
 * no storage configured is fine, and a deployment whose storage check could
 * not be run is not the same thing as one whose storage works.
 */
export type ProbeResult = {
  readonly name: string;
  readonly state: 'ok' | 'failing' | 'not_configured';
  /** Milliseconds the check took. A dependency that answers slowly is a
   *  dependency that is about to stop answering. */
  readonly ms: number;
  /** Present only when failing. The provider's own words, truncated. */
  readonly detail?: string;
};

export type HealthPorts = {
  /** One trivial round trip to Postgres. Not a count, not a join — the
   *  question is whether the connection works, and a heavy probe under load
   *  becomes part of the problem it is reporting. */
  probeDatabase(): Promise<void>;
  /** Null when this deployment has no store, which is a supported state. */
  probeStorage: (() => Promise<void>) | null;
  /**
   * The model provider. NOT a completion — that would cost money on every
   * probe and a readiness endpoint is polled. What is checked is that a key
   * exists and the pool has one that is not cooling down, which is the
   * difference between "she cannot answer" and "she is answering slowly".
   */
  probeModel: (() => Promise<void>) | null;
  now(): Date;
  /** Version and boot time, for the operator reading this at 2am. */
  startedAt: Date;
};

const LIMIT = 200;

async function probe(name: string, run: (() => Promise<void>) | null, now: () => Date): Promise<ProbeResult> {
  if (run === null) return { name, state: 'not_configured', ms: 0 };
  const began = now().getTime();
  try {
    await run();
    return { name, state: 'ok', ms: now().getTime() - began };
  } catch (error) {
    // The provider's OWN message, not a category. "no pg_hba.conf entry for
    // host" and "password authentication failed" are two different nights.
    const detail = error instanceof Error ? error.message : String(error);
    return { name, state: 'failing', ms: now().getTime() - began, detail: detail.slice(0, LIMIT) };
  }
}

export function healthRoutes(ports: HealthPorts): { method: 'GET'; pattern: string; handler: Handler }[] {
  return [
    {
      method: 'GET',
      pattern: '/health/live',
      handler: async () => ({
        // Deliberately trivial, and deliberately NOT checking anything
        // external. If this handler runs at all, the event loop is turning
        // and the process is worth keeping.
        status: 200,
        json: {
          live: true,
          uptimeSeconds: Math.floor((ports.now().getTime() - ports.startedAt.getTime()) / 1000),
        },
      }),
    },

    {
      method: 'GET',
      pattern: '/health/ready',
      handler: async () => {
        // In PARALLEL, and each one separately, so a slow database does not
        // hide a broken bucket behind it and the total is the slowest rather
        // than the sum.
        const checks = await Promise.all([
          probe('database', ports.probeDatabase, ports.now),
          probe('storage', ports.probeStorage, ports.now),
          probe('model', ports.probeModel, ports.now),
        ]);

        // THE DATABASE IS THE ONLY HARD REQUIREMENT. Without storage an
        // attachment refuses and she says so; without a model key a turn
        // degrades to her outage line. Neither is a reason to take the
        // process out of the load balancer — the app still serves, signs in,
        // and shows somebody their own history. Without the database it can
        // do none of that.
        const failing = checks.filter((c) => c.state === 'failing');
        const ready = checks.find((c) => c.name === 'database')!.state === 'ok';

        return {
          status: ready ? 200 : 503,
          json: {
            ready,
            // Named, always, so the answer is actionable rather than binary.
            failing: failing.map((c) => c.name),
            checks,
            at: ports.now().toISOString(),
          },
        };
      },
    },
  ];
}
