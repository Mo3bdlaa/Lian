// An address as bytes, and whether it is worth looking up at all.
//
// Both halves matter for the same reason: a security screen that says
// "Near Frankfurt" because somebody is on a VPN, or that resolves a private
// range to a datacentre, produces the false alarm the screen exists to
// prevent. Somebody who gets two of those stops reading it, which is worse
// than no line at all.

/** 4 bytes for v4, 16 for v6, or null when it is not an address. */
export function toBytes(ip: string): Buffer | null {
  const value = ip.trim();
  if (value === '') return null;
  // Node reports v4-mapped v6 for a dual-stack socket. The v4 form is what
  // the database is organised around, so unwrap rather than walking ::/96.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped !== null) return v4Bytes(mapped[1]!);
  if (value.includes(':')) return v6Bytes(value);
  return v4Bytes(value);
}

function v4Bytes(ip: string): Buffer | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = Buffer.alloc(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index]!;
    // Rejected rather than coerced: '1.2.3.04' and '1.2.3.+4' both parse as 4
    // with Number(), and an address the product invented is worse than none.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    bytes[index] = octet;
  }
  return bytes;
}

function v6Bytes(ip: string): Buffer | null {
  const [head, tail, ...rest] = ip.split('::');
  if (rest.length > 0) return null;
  const parse = (group: string | undefined): string[] => (group === undefined || group === '' ? [] : group.split(':'));
  let left = parse(head);
  let right = tail === undefined ? [] : parse(tail);

  // A trailing v4 form — ::ffff:192.0.2.1, 64:ff9b::192.0.2.1 — is legal and
  // occurs. Expand it into two groups rather than failing the whole address.
  const last = (right.length > 0 ? right : left).at(-1);
  if (last !== undefined && last.includes('.')) {
    const four = v4Bytes(last);
    if (four === null) return null;
    const groups = [four.readUInt16BE(0).toString(16), four.readUInt16BE(2).toString(16)];
    if (right.length > 0) right = [...right.slice(0, -1), ...groups];
    else left = [...left.slice(0, -1), ...groups];
  }

  const missing = 8 - (left.length + right.length);
  if (tail === undefined ? missing !== 0 : missing < 0) return null;
  const groups = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...right];
  if (groups.length !== 8) return null;

  const bytes = Buffer.alloc(16);
  for (let index = 0; index < 8; index += 1) {
    const group = groups[index]!;
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    bytes.writeUInt16BE(Number.parseInt(group, 16), index * 2);
  }
  return bytes;
}

/**
 * Addresses no database can place, and which must never be looked up.
 *
 * Not an optimisation. A private or reserved address in a lookup is a sign
 * the deployment is reading the wrong header — and the answer that comes back
 * for one is either nothing or, worse, whatever the database happens to hold
 * for a range nobody routes. Both belong here rather than in a result.
 */
export function isRoutable(bytes: Buffer): boolean {
  if (bytes.length === 4) {
    const [a, b] = [bytes[0]!, bytes[1]!];
    if (a === 0) return false;                                  // 0.0.0.0/8
    if (a === 10) return false;                                 // private
    if (a === 127) return false;                                // loopback
    if (a === 100 && b >= 64 && b <= 127) return false;         // CGNAT 100.64/10
    if (a === 169 && b === 254) return false;                   // link-local
    if (a === 172 && b >= 16 && b <= 31) return false;          // private
    if (a === 192 && b === 168) return false;                   // private
    if (a === 192 && b === 0) return false;                     // 192.0.0/24, 192.0.2/24
    if (a === 198 && (b === 18 || b === 19)) return false;       // benchmarking
    if (a === 198 && b === 51) return false;                    // TEST-NET-2
    if (a === 203 && b === 0) return false;                     // TEST-NET-3
    if (a >= 224) return false;                                 // multicast, reserved, broadcast
    return true;
  }
  if (bytes.every((byte) => byte === 0)) return false;                          // ::
  if (bytes.subarray(0, 15).every((b) => b === 0) && bytes[15] === 1) return false; // ::1
  const first = bytes[0]!;
  if ((first & 0xfe) === 0xfc) return false;                    // fc00::/7 unique local
  if (first === 0xfe && (bytes[1]! & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (first === 0xff) return false;                             // multicast
  // 2001:db8::/32 documentation
  if (bytes.readUInt32BE(0) === 0x2001_0db8) return false;
  return true;
}
