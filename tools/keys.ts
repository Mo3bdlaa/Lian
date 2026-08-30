// Generate the credentials that are not issued by anybody.
//
//   node tools/keys.ts vapid   # the web-push identity keypair
//   node tools/keys.ts tick    # the shared secret the ticker signs with
//   node tools/keys.ts backup  # the key database backups are encrypted with
//
// Both are on the account setup list (docs/ACCOUNTS.md) and neither has a
// console to get them from: VAPID is a keypair YOU generate — nothing is
// registered with Apple or Google, and the "account" for web push is the
// keypair itself — and the tick secret is a random string the server and the
// ticker have to agree on.
//
// Written down because that is the part nobody expects. Every other line of
// the setup list is "sign in, copy a key"; these two are "run this, keep the
// output", and an operator looking for a Web Push console will not find one.
import { generateVapidKeys } from '@lian/push';
import { randomBytes } from 'node:crypto';

const what = process.argv[2] ?? '';

if (what === 'vapid') {
  const keys = generateVapidKeys();
  console.log('\n# Web push identity (P-256). Generate ONCE and keep it.');
  console.log('# Rotating these invalidates every existing subscription: the');
  console.log('# public key is baked into what each browser subscribed with,');
  console.log('# so a new pair silently stops delivering to everyone who');
  console.log('# already allowed notifications, and nothing reports an error.');
  console.log(`LIAN_VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`LIAN_VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log('# Who to contact about a misbehaving push. A real mailto: a push');
  console.log('# service may use it before it blocks you, and some reject a');
  console.log('# token whose subject is not a URL or a mailto.');
  console.log('LIAN_VAPID_SUBJECT=mailto:you@yourdomain\n');
} else if (what === 'tick') {
  console.log('\n# Shared secret for /api/tick. The SERVER and the TICKER both');
  console.log('# need this exact value; the server refuses a call it cannot');
  console.log('# verify, which is what stops anybody on the internet making');
  console.log('# her send outreach.');
  console.log(`LIAN_TICK_SECRET=${randomBytes(32).toString('base64url')}\n`);
} else if (what === 'backup') {
  console.log('\n# The key your database backups are encrypted with (AES-256-GCM).');
  console.log('# It is NOT the storage provider\'s key: R2 holds ciphertext it cannot');
  console.log('# read, so a bucket misconfiguration is not sufficient to read everybody\'s');
  console.log('# memories, money and messages.');
  console.log('#');
  console.log('# LOSING THIS LOSES THE BACKUPS. There is no recovery path and that is the');
  console.log('# point of it. Keep a copy somewhere that is not this box and not that');
  console.log('# bucket — the two things a disaster takes out together.');
  console.log(`LIAN_BACKUP_KEY=${randomBytes(32).toString('base64')}`);
  console.log('');
} else {
  console.error('usage: node tools/keys.ts vapid|tick|backup');
  process.exit(64);
}
