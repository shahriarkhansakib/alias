import { randomBytes } from 'node:crypto';

let lastTimestamp = -1;
let sequenceCounter = 0;

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Generates an RFC 9562 UUIDv7 identifier with a monotonic 12-bit sub-millisecond counter.
 */
export function generateId(): string {
  const random = randomBytes(10);
  const nowMs = Date.now();

  if (nowMs <= lastTimestamp) {
    sequenceCounter = (sequenceCounter + 1) & 0x0fff;
    if (sequenceCounter === 0) {
      lastTimestamp += 1;
    }
  } else {
    lastTimestamp = nowMs;
    const byte0 = random[0] ?? 0;
    const byte1 = random[1] ?? 0;
    sequenceCounter = ((byte0 & 0x0f) << 8) | byte1;
  }

  const bytes = new Uint8Array(16);
  let ts = BigInt(lastTimestamp);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(ts & 0xffn);
    ts >>= 8n;
  }

  // Version 7 in high nibble + upper 4 bits of monotonic counter
  bytes[6] = 0x70 | ((sequenceCounter >>> 8) & 0x0f);
  bytes[7] = sequenceCounter & 0xff;

  // RFC 9562 variant 0b10 + 6 random bits
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);

  for (let index = 9; index < 16; index += 1) {
    bytes[index] = random[index - 6] ?? 0;
  }

  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isUuidV7(value: string): boolean {
  return UUID_V7_REGEX.test(value);
}
