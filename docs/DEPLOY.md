# Deploying Lian

**This is the stack, and every number in it is free tier.**

| | | |
|---|---|---|
| app | Oracle Cloud Always Free | Ampere A1, **2 OCPU / 12 GB**, arm64 |
| database | Neon | managed Postgres with pgvector |
| storage | Cloudflare R2 | objects, and the backups |
| cron | cron-job.org | calls the signed tick endpoint |
| email | Resend | after the domain verifies |
| TLS | Caddy, on the box | obtains and renews by itself |

**The database is deliberately not on the box.** It holds other people's
memories, money and messages, and its durability should not depend on one free
VM that Oracle can reclaim. The local `docker-compose.yml` runs Postgres in a
container because there the data is disposable; `docker-compose.prod.yml` has
no database service at all.

**Oracle halved the free ARM allowance in June 2026**, from 4 OCPU / 24 GB to
2 OCPU / 12 GB, without announcing it. Everything here is sized for 2/12 and
the ceiling is treated as something that can move again — which is one more
reason the database is somewhere else.

Every step below is either **verifiable by a command** or marked
**CONSOLE** — something only a person clicking in a browser can do.

---

## Before you start: two Oracle facts that cost people days

**1. THE HOME REGION IS CHOSEN ONCE, AT SIGN-UP, AND CANNOT BE CHANGED.**
Always Free resources exist *only* in your home region. Pick it deliberately:

- **Dubai (`me-dubai-1`)** if it is offered — the first market is the UAE and
  it is roughly 130ms closer to Dubai than Frankfurt is.
- **Frankfurt (`eu-frankfurt-1`)** otherwise. It is large, so Ampere capacity
  is more often available, which matters more than the latency.

Getting this wrong means a new account, not a migration.

**2. "Out of host capacity" IS NORMAL.** Ampere A1 is the most requested free
resource Oracle has, and provisioning frequently answers:

> Out of host capacity.

That is not an error in what you did and retrying immediately does not help.
It means that shape has none free in that availability domain right now. What
works: try each availability domain in turn, try again at a different hour,
and keep trying over a day or two. People routinely get one within 48 hours.
It is the single most common place a deployment stalls, and it looks like a
failure rather than a queue.

---

## 1. The box — CONSOLE

Oracle Cloud → Compute → Instances → Create.

- **Image**: Canonical Ubuntu 24.04 (**aarch64**, not x86)
- **Shape**: `VM.Standard.A1.Flex`, **2 OCPU, 12 GB**
- **Boot volume**: 50 GB is plenty; the free allowance is 200 GB total
- **SSH key**: paste your public key — there is no password login

Then, still in the console: **VCN → Security List → add ingress for TCP 80 and
443** from `0.0.0.0/0`.

```sh
ssh ubuntu@<public-ip>          # verifies the box and the key
```

> **The security list is only half the firewall.** Oracle's Ubuntu image also
> ships **iptables rules that reject everything but SSH**. Opening the port in
> the console and not on the box gives a connection **timeout** rather than a
> refusal, which reads like DNS and sends people to the wrong place for hours.
> `tools/deploy.sh` opens them; if you are doing it by hand, that is step 3 of
> that script.

## 2. DNS — CONSOLE

Point an `A` record at the box's public IP. **Before** you run the deploy:
Caddy asks Let's Encrypt for a certificate on first start, and that requires
the name to already resolve here.

```sh
dig +short lian.example.com     # must print the box's IP
```

## 3. Neon — CONSOLE, then verifiable

Neon → new project → region **as close to the box as Neon offers**.

Take the connection string. Two things about it:

- it must end with **`?sslmode=require`** — Neon refuses plain connections;
- prefer the **pooled** endpoint (a `-pooler` hostname). The app opens ten
  connections, the ticker opens more, and your own `psql` opens another.

```sh
psql "$DATABASE_URL" -c "select version()"
psql "$DATABASE_URL" -c "create extension if not exists vector"
```

The second one is not optional and not automatic. Migration 0003 needs it, and
**a restore needs it too** — see §7.

> **Neon suspends an idle free database.** The first connection after that has
> to wake it. The app handles this: only connection *acquisition* is retried,
> never a query, because a connect-phase failure proves no statement ran. See
> `connectWithResume` in `packages/db/src/client.ts`.

## 4. R2 — CONSOLE, then verifiable

Cloudflare → R2 → create a bucket. Then an **API token** with **Object Read &
Write** on it.

Three things about R2 that are true of R2 and not of S3, each of which fails
in a way that looks like a wrong secret key:

- **region is the literal string `auto`**. A real AWS region name signs a
  request R2 rejects with `SignatureDoesNotMatch`.
- **path style**, not virtual host. Virtual-host style resolves to a hostname
  that does not exist, so the failure is DNS.
- **the token must be able to LIST**, not just read and write. Backups upload
  fine without it and retention silently never prunes.

`npm run preflight deploy` checks all three by name.

## 5. Keys that no console issues

```sh
npm run keys vapid      # web push identity
npm run keys tick       # the secret the cron signs with
npm run keys backup     # the key backups are encrypted with
```

> **`LIAN_BACKUP_KEY` has no recovery path.** R2 holds ciphertext it cannot
> read, which is the point — a bucket misconfiguration is not enough to read
> everybody's memories. Keep a copy somewhere that is neither this box nor
> that bucket, because those are the two things a disaster takes out together.

## 6. `.env`

```sh
cp .env.example .env && $EDITOR .env
```

Required, and `tools/deploy.sh` refuses to start without them:

```
DATABASE_URL=postgres://…neon.tech/lian?sslmode=require
LIAN_PUBLIC_URL=https://lian.example.com
LIAN_DOMAIN=lian.example.com
LIAN_TICK_SECRET=…
ANTHROPIC_API_KEY=…
LIAN_VAPID_PUBLIC_KEY=…
LIAN_VAPID_PRIVATE_KEY=…
```

`docs/ACCOUNTS.md` has the full list and what each one costs you if it is
absent. `tools/accounts.test.ts` asserts every variable named there is one the
config actually reads.

## 7. One command up

```sh
sudo sh tools/deploy.sh
```

System packages, the firewall, the image, migrations, the containers, TLS, and
then **a health check that fails loudly**: it polls `/health/ready` for two
minutes, and if the database is unreachable it prints the container logs and
exits non-zero rather than reporting a successful deploy because a container
happened to be running.

It is idempotent. Run it again after `git pull` and it updates.

The last step runs `preflight db`, which measures the vector index's real
recall and tells you to `REINDEX` if it is answering badly — see §9.

## 8. The cron — CONSOLE

cron-job.org → new job:

- **URL**: `https://lian.example.com/api/tick`
- **Method**: POST, every **5 minutes**

The endpoint requires an HMAC signature over the timestamp and body, so a
plain scheduled GET will 401. `tools/ticker.ts` runs in the compose file and
signs correctly; cron-job.org is the belt to that braces — if you use it
alone, it needs a request body and headers it can compute, which it cannot.

> **The ticker in `docker-compose.prod.yml` is the primary schedule.** It runs
> in-cluster, signs correctly, and talks to the server over the compose
> network rather than through DNS and TLS. cron-job.org is worth adding as an
> external heartbeat that will notice if the whole box is down — which the
> in-cluster ticker, by definition, cannot.

`npm run preflight deploy` calls the endpoint from outside with a real
signature and distinguishes *unreachable* from *reachable and refusing*.

## 9. Backups, and the restore

```sh
# In cron on the box, daily:
0 3 * * * cd /home/ubuntu/lian && docker run --rm --env-file .env lian:latest node tools/backup.ts dump
```

Dump → gzip → **AES-256-GCM** → R2, kept **14 days**.

**Restoring is the part that matters, and it has been run.** `tools/backup.test.ts`
does the whole round trip in the suite — dump a real database, encrypt, store,
restore into a *different* database, and compare row counts, a row by value,
and that pgvector survived.

```sh
node tools/backup.ts list
node tools/backup.ts restore backups/2026-08-30T03-00-00-000Z.sql.gz.enc "$TARGET_URL"
```

**Prepare the target first.** `CREATE EXTENSION` needs privileges the
application role usually lacks, and without it the restore stops three
quarters of the way through with everything before it already applied:

```sh
psql "$TARGET_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector'
```

Once the extension exists, the restore runs as the ordinary role —
`IF NOT EXISTS` skips the privilege check when it is already there. The tool
does this itself and says exactly this if it cannot.

**The index, which nothing else will tell you about.** An ivfflat index built
by a migration on an empty table has centroids from no data. pgvector warns at
build time and nothing in the product notices afterwards, because the failure
mode is *a memory stored twice* rather than an error:

```sh
psql "$DATABASE_URL" -c 'REINDEX INDEX CONCURRENTLY memories_embedding_idx'
npm run preflight db            # measures the real recall, fails under 80%
```

Run the reindex once there is a corpus, and after any bulk import or restore.

## 10. Check it from outside

```sh
npm run preflight               # every integration, each failure named
npm run preflight deploy        # R2, Neon, and the tick endpoint from outside
curl -sS https://lian.example.com/health/ready   # 404 — deliberately not public
```

Readiness is **not** exposed through Caddy: it names which dependency is
failing in the provider's own words, which is precisely what not to hand a
stranger. Ask the container on the loopback instead:

```sh
docker compose -f docker-compose.prod.yml exec server \
  node -e "fetch('http://127.0.0.1:8787/health/ready').then(r=>r.text()).then(console.log)"
```

---

## What the box can hold

`docs/MEMORY.md`, measured under concurrent streams.

**Memory is not the constraint.** Under a megabyte per additional stream, so
the 12 GB box is nowhere near binding. **The ten-connection database pool is**
(`max` in `packages/db/src/client.ts`), and the reason not to simply raise it
is Neon's own connection ceiling on the free tier — which is what the pooled
endpoint in §3 is for.

`NODE_OPTIONS=--max-old-space-size=1024` is set in the Dockerfile rather than
left to Node's default, which is derived from the machine and is a number
nobody decided.

## Troubleshooting, by symptom

| what you see | what it usually is |
|---|---|
| `Out of host capacity` | normal for Ampere. Try another availability domain, another hour, another day. |
| connection **times out** on 443 | the box's iptables. The console security list is a separate thing and both must allow it. |
| Caddy has no certificate | DNS was not pointing here when it first started, or 80 is blocked. `docker compose logs caddy`. |
| `SignatureDoesNotMatch` from R2 | region is not `auto`, or the clock is off. `npm run preflight storage` separates them. |
| DNS failure reaching the bucket | virtual-host style. R2 is path style. |
| tick endpoint answers 401 | reachable, wrong secret. Compare `LIAN_TICK_SECRET` on both sides. |
| deploy says NOT READY | `/health/ready` names the dependency. Fix that one. |
| she repeats a memory she already had | the vector index. `preflight db`, then `REINDEX`. |
| `permission denied to create extension` mid-restore | the target was not prepared. §9. |

## What is still not verified anywhere

- **No real Stripe call has ever been made.** Everything is tested against a
  fake and audited; the first checkout is the verification.
- **No real push has been received on a real device.** Every layer is tested;
  a sandbox cannot subscribe to a push service.
- **The arm64 image has been tested under emulation, not on an Ampere A1.**
  `npm run docker:test` runs the whole suite inside the image on `linux/arm64`
  via qemu — and on the actual box that runs natively and faster. What
  emulation cannot tell you is anything about the box's real IO or scheduler.
