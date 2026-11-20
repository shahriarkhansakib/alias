import { describe, expect, it } from 'vitest';
import { generateId, isUuidV7 } from './id.js';

describe('UUIDv7 generator', () => {
  it('generates valid RFC 9562 UUIDv7 identifiers with current timestamp', () => {
    const beforeMs = Date.now();
    const id = generateId();
    const afterMs = Date.now();

    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);

    const hexTimestamp = id.replace(/-/g, '').slice(0, 12);
    const embeddedMs = Number.parseInt(hexTimestamp, 16);
    expect(embeddedMs).toBeGreaterThanOrEqual(beforeMs - 5);
    expect(embeddedMs).toBeLessThanOrEqual(afterMs + 50);
  });

  it('produces strictly monotonic, unique IDs across rapid bursts', () => {
    const count = 2000;
    const generated: string[] = [];
    for (let index = 0; index < count; index += 1) {
      generated.push(generateId());
    }

    expect(new Set(generated).size).toBe(count);

    for (let index = 1; index < generated.length; index += 1) {
      const prev = generated[index - 1] ?? '';
      const curr = generated[index] ?? '';
      expect(curr > prev).toBe(true);
    }
  });
});
