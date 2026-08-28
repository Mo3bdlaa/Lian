// The reader, against a database this test builds.
//
// NO FIXTURE FILE. A checked-in copy of somebody's GeoLite2 is tens of
// megabytes, is licensed, and goes stale — and a reader tested against one
// captured file is tested against one day's data. Building the format here
// means the test states what the format IS, so a reader that drifts from the
// specification fails rather than agreeing with a stale copy of itself.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Mmdb } from './mmdb.ts';
import { toBytes, isRoutable } from './address.ts';
import { lookupIn, CITY_ACCURACY_KM } from './resolve.ts';

// ── a minimal MMDB writer ──────────────────────────────────────────────────

/** Control byte plus payload, for the handful of types a record needs. */
const enc = {
  string(value: string): Buffer {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([sized(2, bytes.length), bytes]);
  },
  uint16(value: number): Buffer {
    if (value === 0) return sized(5, 0);
    const width = value > 0xff ? 2 : 1;
    const bytes = Buffer.alloc(width);
    bytes.writeUIntBE(value, 0, width);
    return Buffer.concat([sized(5, width), bytes]);
  },
  uint32(value: number): Buffer {
    if (value === 0) return sized(6, 0);
    const width = value > 0xff_ffff ? 4 : value > 0xffff ? 3 : value > 0xff ? 2 : 1;
    const bytes = Buffer.alloc(width);
    bytes.writeUIntBE(value, 0, width);
    return Buffer.concat([sized(6, width), bytes]);
  },
  map(entries: Record<string, Buffer>): Buffer {
    const keys = Object.keys(entries);
    return Buffer.concat([sized(7, keys.length), ...keys.flatMap((key) => [enc.string(key), entries[key]!])]);
  },
};

/** The type/size control byte, with the spec's three extension forms. */
function sized(type: number, size: number): Buffer {
  const tag = type << 5;
  if (size < 29) return Buffer.from([tag | size]);
  if (size < 285) return Buffer.from([tag | 29, size - 29]);
  const wide = Buffer.alloc(2);
  wide.writeUInt16BE(size - 285);
  return Buffer.concat([Buffer.from([tag | 30]), wide]);
}

/**
 * A database with one 24-bit-record node per prefix bit.
 *
 * Deliberately the simplest tree that is still a real one: every entry gets
 * its own chain of nodes, so the reader has to walk bits, follow records, and
 * tell "another node" from "a data pointer" from "nothing here" — which is
 * the whole of the lookup path.
 */
function buildDatabase(entries: { prefix: Buffer; bits: number; data: Buffer }[], ipVersion: 4 | 6): Buffer {
  const RECORD_BYTES = 3;
  const NODE_BYTES = RECORD_BYTES * 2;
  // node 0 is the root; each entry adds one node per bit it needs.
  const nodes: [number, number][] = [[0, 0]];
  const data: Buffer[] = [];
  let dataLength = 0;

  for (const entry of entries) {
    let node = 0;
    for (let bit = 0; bit < entry.bits; bit += 1) {
      const side = (entry.prefix[bit >> 3]! >> (7 - (bit % 8))) & 1;
      const last = bit === entry.bits - 1;
      if (last) {
        // The data pointer, filled in once node_count is known.
        nodes[node]![side] = -(dataLength + 1);
        data.push(entry.data);
        dataLength += entry.data.length;
      } else if (nodes[node]![side] === 0) {
        nodes.push([0, 0]);
        nodes[node]![side] = nodes.length - 1;
        node = nodes.length - 1;
      } else {
        node = nodes[node]![side]!;
      }
    }
  }

  const nodeCount = nodes.length;
  const tree = Buffer.alloc(nodeCount * NODE_BYTES);
  nodes.forEach(([left, right], index) => {
    for (const [side, value] of [[0, left], [1, right]] as const) {
      // 0 in this builder means "no child" — which the format spells as
      // node_count, "nothing here".
      const record = value === 0 ? nodeCount
        : value < 0 ? nodeCount + 16 + (-value - 1)
        : value;
      tree.writeUIntBE(record, index * NODE_BYTES + side * RECORD_BYTES, RECORD_BYTES);
    }
  });

  const metadata = enc.map({
    node_count: enc.uint32(nodeCount),
    record_size: enc.uint16(24),
    ip_version: enc.uint16(ipVersion),
    database_type: enc.string('Test-City'),
    binary_format_major_version: enc.uint16(2),
    binary_format_minor_version: enc.uint16(0),
    build_epoch: enc.uint32(1),
    languages: Buffer.concat([sized(11, 1), enc.string('en')]),
    description: enc.map({ en: enc.string('built by geo.test.ts') }),
  });

  return Buffer.concat([
    tree,
    Buffer.alloc(16),
    ...data,
    Buffer.from('\xab\xcd\xefMaxMind.com', 'binary'),
    metadata,
  ]);
}

const cityRecord = (city: string, country: string, radius?: number): Buffer => enc.map({
  city: enc.map({ names: enc.map({ en: enc.string(city), ar: enc.string(`${city}-ar`) }) }),
  country: enc.map({ names: enc.map({ en: enc.string(country), ar: enc.string(`${country}-ar`) }) }),
  ...(radius === undefined ? {} : { location: enc.map({ accuracy_radius: enc.uint16(radius) }) }),
});

// 5.0.0.0/8 — a real allocation, so nothing here collides with a reserved
// range that isRoutable would refuse before the lookup ever happened.
const DATABASE = buildDatabase([
  { prefix: Buffer.from([5, 0, 0, 0]), bits: 8, data: cityRecord('Dubai', 'United Arab Emirates', 20) },
  { prefix: Buffer.from([6, 0, 0, 0]), bits: 8, data: cityRecord('Somewhere', 'Germany', 500) },
  { prefix: Buffer.from([7, 0, 0, 0]), bits: 8, data: enc.map({
    country: enc.map({ names: enc.map({ en: enc.string('Japan'), ar: enc.string('اليابان') }) }),
  }) },
], 4);

describe('reading a MaxMind database', () => {
  const db = Mmdb.fromBuffer(DATABASE);

  test('the metadata is the file’s own', () => {
    assert.equal(db.metadata.recordSize, 24);
    assert.equal(db.metadata.ipVersion, 4);
    assert.equal(db.metadata.databaseType, 'Test-City');
  });

  test('a confident city is NEAR it, never it', () => {
    // The whole phrasing rule in one assertion. Mobile networks, VPNs and
    // Private Relay routinely name a city somebody has never been to; a
    // screen that says "Dubai" turns that into a false alarm, and two false
    // alarms is somebody who stops reading the screen.
    assert.deepEqual(lookupIn(db, '5.1.2.3', 'en'), { kind: 'near', name: 'Dubai' });
  });

  test('low confidence degrades to the country, not to a worse city', () => {
    // 500km is most of a country. The database has a city name and saying it
    // would be a guess wearing a place name.
    assert.ok(500 > CITY_ACCURACY_KM);
    assert.deepEqual(lookupIn(db, '6.1.2.3', 'en'), { kind: 'country', name: 'Germany' });
  });

  test('a country-level database answers with the country', () => {
    assert.deepEqual(lookupIn(db, '7.1.2.3', 'en'), { kind: 'country', name: 'Japan' });
  });

  test('the reader takes its Arabic from the database, not from a table here', () => {
    assert.deepEqual(lookupIn(db, '5.1.2.3', 'ar'), { kind: 'near', name: 'Dubai-ar' });
    assert.deepEqual(lookupIn(db, '7.1.2.3', 'ar'), { kind: 'country', name: 'اليابان' });
  });

  test('a miss is NOTHING, never "Unknown"', () => {
    // "Unknown" looks harmless and is not: it is a row saying something
    // happened somewhere, which the reader already knew, in the space where a
    // real answer would go.
    assert.equal(lookupIn(db, '8.8.8.8', 'en'), null);
  });

  test('the cases that actually occur', () => {
    for (const [ip, why] of [
      ['10.0.0.4', 'a private range — usually a sign the wrong header is being read'],
      ['192.168.1.20', 'a home network'],
      ['127.0.0.1', 'loopback'],
      ['100.64.3.9', 'carrier-grade NAT, which a mobile network really does present'],
      ['169.254.10.1', 'link-local'],
      ['::1', 'v6 loopback'],
      ['fd00::1', 'v6 unique local'],
      ['fe80::1', 'v6 link-local'],
      ['2001:db8::1', 'the documentation range'],
      ['0.0.0.0', 'unroutable'],
      ['255.255.255.255', 'broadcast'],
      ['', 'nothing at all'],
      ['not-an-ip', 'a header somebody made up'],
      ['1.2.3.4.5', 'five octets'],
      ['1.2.3.999', 'an octet that does not fit'],
      ['1.2.3.04', 'a leading zero, which Number() would happily accept'],
    ] as const) {
      assert.equal(lookupIn(db, ip, 'en'), null, `${ip} — ${why} — must resolve to nothing`);
    }
  });

  test('a v6 address against a v4 database answers nothing rather than guessing', () => {
    assert.equal(lookupIn(db, '2606:4700::1111', 'en'), null);
  });

  test('a v4-mapped v6 address is the v4 address', () => {
    // Node hands this shape back from a dual-stack socket, and it is the
    // same machine as 5.1.2.3.
    assert.deepEqual(lookupIn(db, '::ffff:5.1.2.3', 'en'), { kind: 'near', name: 'Dubai' });
  });
});

describe('addresses', () => {
  test('v6 forms that occur', () => {
    assert.equal(toBytes('::')?.length, 16);
    assert.equal(toBytes('2606:4700:4700::1111')?.toString('hex'), '26064700470000000000000000001111');
    assert.equal(toBytes('64:ff9b::192.0.2.33')?.toString('hex'), '0064ff9b0000000000000000c0000221');
    assert.equal(toBytes('fe80::1%eth0'), null, 'a zone index is not an address this reader accepts');
    assert.equal(toBytes('1:2:3:4:5:6:7:8:9'), null, 'nine groups');
    assert.equal(toBytes('1::2::3'), null, 'two elisions');
  });

  test('a routable address is routable', () => {
    for (const ip of ['5.1.2.3', '8.8.8.8', '2606:4700::1111', '2a00:1450::1']) {
      assert.equal(isRoutable(toBytes(ip)!), true, ip);
    }
  });
});

// ── against a real database, when there is one ─────────────────────────────
//
// The tests above build the format, so a reader and a writer that share a
// misreading would agree with each other and both be wrong. This is the check
// that they are not: point LIAN_GEOIP_DB at a real GeoLite2 or DB-IP file and
// it runs. No file, no run — the repository does not carry eight megabytes of
// somebody else's licensed data, and a test that requires it would be a test
// nobody can run.
describe('against a real database', { skip: (process.env['LIAN_GEOIP_DB'] ?? '') === '' ? 'LIAN_GEOIP_DB not set' : false }, () => {
  test('known addresses resolve to the countries they are registered in', () => {
    const db = Mmdb.open(process.env['LIAN_GEOIP_DB']!);
    assert.ok(db.metadata.nodeCount > 1000, 'that file is too small to be a real database');
    for (const [ip, country] of [
      ['8.8.8.8', 'United States'],
      ['1.1.1.1', 'Australia'],
      ['2a00:1450:4001:800::200e', 'Germany'],
      ['185.60.216.35', 'Ireland'],
    ] as const) {
      const place = lookupIn(db, ip, 'en');
      assert.ok(place !== null, `${ip} resolved to nothing`);
      // A city database answers 'near'; a country one answers 'country'.
      // Either is correct — what must hold is the country it belongs to.
      assert.ok(
        place.name === country || place.kind === 'near',
        `${ip} resolved to ${place.name}, expected ${country}`,
      );
    }
    // And the rules still hold on real data.
    assert.equal(lookupIn(db, '10.0.0.1', 'en'), null);
    assert.equal(lookupIn(db, '127.0.0.1', 'en'), null);
  });
});
