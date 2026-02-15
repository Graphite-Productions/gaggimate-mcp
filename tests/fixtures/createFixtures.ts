/**
 * Helper functions to create binary test fixtures for parsers.
 * These mirror the C structs defined in shot_log_format.h.
 */

const INDEX_HEADER_SIZE = 32;
const INDEX_ENTRY_SIZE = 128;
const INDEX_MAGIC = 0x58444953; // 'SIDX'
const SHOT_MAGIC = 0x544f4853; // 'SHOT'

function writeCString(buffer: Buffer, offset: number, str: string, maxLen: number): void {
  for (let i = 0; i < maxLen; i++) {
    buffer[offset + i] = i < str.length ? str.charCodeAt(i) : 0;
  }
}

/**
 * Create a valid index.bin buffer with the given entries.
 */
export function createIndexBuffer(entries: Array<{
  id: number;
  timestamp: number;
  duration: number;
  volume: number; // raw scaled value (multiply grams by 10)
  rating: number;
  flags: number;
  profileId: string;
  profileName: string;
}>): Buffer {
  const totalSize = INDEX_HEADER_SIZE + entries.length * INDEX_ENTRY_SIZE;
  const buffer = Buffer.alloc(totalSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Write header
  view.setUint32(0, INDEX_MAGIC, true); // magic
  view.setUint16(4, 1, true); // version
  view.setUint16(6, INDEX_ENTRY_SIZE, true); // entrySize
  view.setUint32(8, entries.length, true); // entryCount
  view.setUint32(12, entries.length + 1, true); // nextId

  // Write entries
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const base = INDEX_HEADER_SIZE + i * INDEX_ENTRY_SIZE;

    view.setUint32(base + 0, e.id, true);
    view.setUint32(base + 4, e.timestamp, true);
    view.setUint32(base + 8, e.duration, true);
    view.setUint16(base + 12, e.volume, true);
    view.setUint8(base + 14, e.rating);
    view.setUint8(base + 15, e.flags);
    writeCString(buffer, base + 16, e.profileId, 32);
    writeCString(buffer, base + 48, e.profileName, 48);
  }

  return buffer;
}

/**
 * Create a minimal valid .slog shot buffer (v4 format).
 * Fields mask bits: T=0, TT=1, CT=2, TP=3, CP=4, FL=5
 */
export function createShotBuffer(options: {
  id?: string;
  version?: number;
  sampleInterval?: number;
  fieldsMask?: number;
  sampleCount?: number;
  duration?: number;
  timestamp?: number;
  profileId?: string;
  profileName?: string;
  weight?: number; // raw scaled (grams * 10)
  samples?: number[][]; // each inner array has one value per set bit in fieldsMask
}): Buffer {
  const version = options.version ?? 4;
  const headerSize = version >= 5 ? 512 : 128;
  const fieldsMask = options.fieldsMask ?? 0b111111; // T, TT, CT, TP, CP, FL
  const sampleInterval = options.sampleInterval ?? 100;

  // Count fields
  let fieldCount = 0;
  for (let bit = 0; bit <= 12; bit++) {
    if (fieldsMask & (1 << bit)) fieldCount++;
  }

  const sampleCount = options.sampleCount ?? (options.samples?.length ?? 0);
  const sampleDataSize = fieldCount * 2;
  const totalSize = headerSize + sampleCount * sampleDataSize;
  const buffer = Buffer.alloc(totalSize);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Header
  view.setUint32(0, SHOT_MAGIC, true);
  view.setUint8(4, version);
  view.setUint8(5, 0); // reserved
  view.setUint16(6, headerSize, true);
  view.setUint16(8, sampleInterval, true);
  view.setUint16(10, 0, true); // reserved
  view.setUint32(12, fieldsMask, true);
  view.setUint32(16, sampleCount, true);
  view.setUint32(20, options.duration ?? 30000, true);
  view.setUint32(24, options.timestamp ?? Math.floor(Date.now() / 1000), true);
  writeCString(buffer, 28, options.profileId ?? "test-profile-id", 32);
  writeCString(buffer, 60, options.profileName ?? "Test Profile", 48);
  view.setUint16(108, options.weight ?? 0, true);

  // Samples
  if (options.samples) {
    for (let i = 0; i < options.samples.length; i++) {
      const sampleOffset = headerSize + i * sampleDataSize;
      const sampleValues = options.samples[i];
      for (let j = 0; j < sampleValues.length && j < fieldCount; j++) {
        view.setUint16(sampleOffset + j * 2, sampleValues[j], true);
      }
    }
  }

  return buffer;
}
