// A MaxMind DB reader.
//
// MMDB is the format GeoLite2 and DB-IP both publish: a binary search tree
// over IP bits, then a typed data section. It is read here rather than
// through a package for the same reason SigV4 and the web-push encryption
// are written here — this repository has two runtime dependencies and the
// format is a published specification, not a moving target.
//
// WHY A FILE AT ALL, rather than a lookup service. A security screen exists
// to answer "was that you?", and asking a third party where somebody is
// resolves that question by telling somebody else where they are. Every IP
// this product sees would leave the deployment. A file read in process keeps
// "your data, your server" literally true, works offline and self-hosted, and
// costs nothing per lookup.
//
// WHAT IT DOES NOT DO: no network, no cache warming, no fallback provider.
// If the file is absent or unreadable the product shows no location, which is
// the honest degradation — see resolve.ts.
//
// The format, briefly, because the offsets below are otherwise unreadable:
//
//   [ search tree ][ 16 zero bytes ][ data section ][ metadata marker + metadata ]
//
// The tree has `node_count` nodes of two records each, `record_size` bits per
// record. Walking an address means taking bit N of it to choose the left or
// right record of the current node. A record below node_count is another
// node; equal to it means "not in the database"; above it is a pointer into
// the data section.
import { readFileSync } from 'node:fs';

const METADATA_MARKER = Buffer.from('\xab\xcd\xefMaxMind.com', 'binary');

/** How far back from the end of the file the marker may be. The spec's own
 *  bound: metadata is at most 128 KiB. */
const METADATA_MAX_BYTES = 128 * 1024;

export type MmdbMetadata = {
  readonly nodeCount: number;
  readonly recordSize: 24 | 28 | 32;
  readonly ipVersion: 4 | 6;
  readonly databaseType: string;
  readonly buildEpoch: number;
};

type Decoded = { value: unknown; next: number };

export class Mmdb {
  private readonly buffer: Buffer;
  readonly metadata: MmdbMetadata;
  private readonly treeBytes: number;
  /** Where the data section begins: the tree, then sixteen zero bytes. */
  private readonly dataStart: number;
  /** The node an IPv4 lookup starts at in an IPv6 tree, found once. */
  private readonly ipv4Start: number;

  private constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.metadata = this.readMetadata();
    this.treeBytes = (this.metadata.nodeCount * this.metadata.recordSize * 2) / 8;
    this.dataStart = this.treeBytes + 16;
    this.ipv4Start = this.metadata.ipVersion === 4 ? 0 : this.findIpv4Start();
  }

  static open(path: string): Mmdb {
    return new Mmdb(readFileSync(path));
  }

  /** For tests, and for anything that already holds the bytes. */
  static fromBuffer(buffer: Buffer): Mmdb {
    return new Mmdb(buffer);
  }

  private readMetadata(): MmdbMetadata {
    const from = Math.max(0, this.buffer.length - METADATA_MAX_BYTES);
    const at = this.buffer.lastIndexOf(METADATA_MARKER, this.buffer.length, 'binary');
    if (at === -1 || at < from) throw new Error('not a MaxMind database: the metadata marker is not there');
    // The metadata is a map, encoded exactly like anything in the data
    // section — so it decodes with the same decoder, offset from the marker
    // rather than from the data section.
    const decoded = this.decode(at + METADATA_MARKER.length, at + METADATA_MARKER.length);
    const map = decoded.value as Record<string, unknown>;
    const recordSize = Number(map['record_size']);
    if (recordSize !== 24 && recordSize !== 28 && recordSize !== 32) {
      throw new Error(`unsupported record size ${recordSize}`);
    }
    const ipVersion = Number(map['ip_version']);
    if (ipVersion !== 4 && ipVersion !== 6) throw new Error(`unsupported ip version ${ipVersion}`);
    return {
      nodeCount: Number(map['node_count']),
      recordSize,
      ipVersion,
      databaseType: String(map['database_type'] ?? 'unknown'),
      buildEpoch: Number(map['build_epoch'] ?? 0),
    };
  }

  /**
   * Walk 96 zero bits once and remember where that lands.
   *
   * An IPv6 database stores IPv4 as ::/96-mapped addresses, so every v4
   * lookup would otherwise re-walk the same 96 nodes. Doing it at open time
   * is the difference between a lookup being a dozen steps and a hundred.
   */
  private findIpv4Start(): number {
    let node = 0;
    for (let bit = 0; bit < 96 && node < this.metadata.nodeCount; bit += 1) {
      node = this.readRecord(node, 0);
    }
    return node;
  }

  private readRecord(node: number, bit: 0 | 1): number {
    const base = node * ((this.metadata.recordSize * 2) / 8);
    if (this.metadata.recordSize === 24) {
      return this.buffer.readUIntBE(base + bit * 3, 3);
    }
    if (this.metadata.recordSize === 32) {
      return this.buffer.readUInt32BE(base + bit * 4);
    }
    // 28 bits: the middle byte's two nibbles are the HIGH bits of the two
    // records — high nibble for the left, low nibble for the right.
    const middle = this.buffer[base + 3]!;
    return bit === 0
      ? ((middle >> 4) << 24) | this.buffer.readUIntBE(base, 3)
      : ((middle & 0x0f) << 24) | this.buffer.readUIntBE(base + 4, 3);
  }

  /**
   * The record for an address, or null when the database has nothing for it.
   *
   * `address` is 4 or 16 bytes. A 4-byte address in a v6 database enters at
   * the cached ::/96 node; a 16-byte address in a v4-only database cannot be
   * answered and returns null rather than pretending.
   */
  lookup(address: Buffer): unknown {
    const v4 = address.length === 4;
    if (!v4 && this.metadata.ipVersion === 4) return null;
    let node = v4 ? this.ipv4Start : 0;
    const bits = address.length * 8;

    for (let bit = 0; bit < bits; bit += 1) {
      if (node >= this.metadata.nodeCount) break;
      const byte = address[bit >> 3]!;
      const side = ((byte >> (7 - (bit % 8))) & 1) as 0 | 1;
      node = this.readRecord(node, side);
    }
    // Exactly node_count is the format's "no data here".
    if (node === this.metadata.nodeCount) return null;
    if (node < this.metadata.nodeCount) return null;
    return this.decode(node - this.metadata.nodeCount + this.treeBytes, this.dataStart).value;
  }

  // ── the data decoder ─────────────────────────────────────────────────────
  //
  // `base` is where pointers are relative TO. It is the data section for
  // ordinary lookups and the metadata's own start when decoding metadata,
  // which is why it is a parameter rather than a field.

  private decode(at: number, base: number): Decoded {
    const control = this.buffer[at]!;
    let type = control >> 5;
    let next = at + 1;
    if (type === 0) {
      type = this.buffer[next]! + 7;
      next += 1;
    }

    if (type === 1) return this.decodePointer(control, next, base);

    let size = control & 0x1f;
    if (size === 29) { size = 29 + this.buffer[next]!; next += 1; }
    else if (size === 30) { size = 285 + this.buffer.readUInt16BE(next); next += 2; }
    else if (size === 31) { size = 65_821 + this.buffer.readUIntBE(next, 3); next += 3; }

    switch (type) {
      case 2: return { value: this.buffer.toString('utf8', next, next + size), next: next + size };
      case 3: return { value: this.buffer.readDoubleBE(next), next: next + 8 };
      case 4: return { value: this.buffer.subarray(next, next + size), next: next + size };
      case 5: case 6: case 9: case 10:
        return { value: size === 0 ? 0 : this.readUnsigned(next, size), next: next + size };
      case 7: return this.decodeMap(next, size, base);
      case 8: return { value: size === 0 ? 0 : this.buffer.readIntBE(next, size), next: next + size };
      case 11: return this.decodeArray(next, size, base);
      case 14: return { value: size === 1, next };
      case 15: return { value: this.buffer.readFloatBE(next), next: next + 4 };
      // 12 (container) and 13 (end marker) never appear in a well-formed
      // file's readable positions; anything else is a corrupt database and
      // saying so beats returning a plausible wrong answer.
      default: throw new Error(`unreadable MMDB type ${type} at ${at}`);
    }
  }

  private readUnsigned(at: number, size: number): number {
    // Up to 6 bytes goes through readUIntBE; a uint64/uint128 wider than that
    // is only ever a metadata field this reader does not use, and returning a
    // lossy Number for it is better than throwing on an otherwise good file.
    if (size <= 6) return this.buffer.readUIntBE(at, size);
    let value = 0;
    for (let index = 0; index < size; index += 1) value = value * 256 + this.buffer[at + index]!;
    return value;
  }

  private decodePointer(control: number, next: number, base: number): Decoded {
    const size = (control >> 3) & 0x3;
    const value = control & 0x7;
    if (size === 0) return { value: this.decode(base + ((value << 8) | this.buffer[next]!), base).value, next: next + 1 };
    if (size === 1) {
      return { value: this.decode(base + ((value << 16) | this.buffer.readUInt16BE(next)) + 2048, base).value, next: next + 2 };
    }
    if (size === 2) {
      return { value: this.decode(base + ((value << 24) | this.buffer.readUIntBE(next, 3)) + 526_336, base).value, next: next + 3 };
    }
    return { value: this.decode(base + this.buffer.readUInt32BE(next), base).value, next: next + 4 };
  }

  private decodeMap(at: number, pairs: number, base: number): Decoded {
    const map: Record<string, unknown> = {};
    let cursor = at;
    for (let pair = 0; pair < pairs; pair += 1) {
      const key = this.decode(cursor, base);
      const value = this.decode(key.next, base);
      map[String(key.value)] = value.value;
      cursor = value.next;
    }
    return { value: map, next: cursor };
  }

  private decodeArray(at: number, count: number, base: number): Decoded {
    const array: unknown[] = [];
    let cursor = at;
    for (let index = 0; index < count; index += 1) {
      const element = this.decode(cursor, base);
      array.push(element.value);
      cursor = element.next;
    }
    return { value: array, next: cursor };
  }
}
