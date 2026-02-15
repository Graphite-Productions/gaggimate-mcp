import { describe, it, expect } from "vitest";
import { parseBinaryIndex, indexToShotList } from "../../src/parsers/binaryIndex.js";
import { createIndexBuffer } from "../fixtures/createFixtures.js";

describe("parseBinaryIndex", () => {
  it("parses a valid index with one entry", () => {
    const buffer = createIndexBuffer([
      {
        id: 1,
        timestamp: 1707900000,
        duration: 30000,
        volume: 380, // 38.0g
        rating: 4,
        flags: 0x01, // completed
        profileId: "profile-abc",
        profileName: "Classic 9-bar",
      },
    ]);

    const result = parseBinaryIndex(buffer);
    expect(result.header.magic).toBe(0x58444953);
    expect(result.header.entryCount).toBe(1);
    expect(result.entries).toHaveLength(1);

    const entry = result.entries[0];
    expect(entry.id).toBe(1);
    expect(entry.timestamp).toBe(1707900000);
    expect(entry.duration).toBe(30000);
    expect(entry.volume).toBeCloseTo(38.0, 1);
    expect(entry.rating).toBe(4);
    expect(entry.profileId).toBe("profile-abc");
    expect(entry.profileName).toBe("Classic 9-bar");
    expect(entry.completed).toBe(true);
    expect(entry.deleted).toBe(false);
    expect(entry.hasNotes).toBe(false);
  });

  it("parses multiple entries", () => {
    const buffer = createIndexBuffer([
      {
        id: 1,
        timestamp: 1707900000,
        duration: 28000,
        volume: 360,
        rating: 3,
        flags: 0x01,
        profileId: "p1",
        profileName: "Profile A",
      },
      {
        id: 2,
        timestamp: 1707900300,
        duration: 32000,
        volume: 400,
        rating: 5,
        flags: 0x05, // completed + has notes
        profileId: "p2",
        profileName: "Profile B",
      },
    ]);

    const result = parseBinaryIndex(buffer);
    expect(result.header.entryCount).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[1].hasNotes).toBe(true);
    expect(result.entries[1].completed).toBe(true);
  });

  it("handles deleted entries", () => {
    const buffer = createIndexBuffer([
      {
        id: 1,
        timestamp: 1707900000,
        duration: 30000,
        volume: 0,
        rating: 0,
        flags: 0x02, // deleted
        profileId: "p1",
        profileName: "Deleted Shot",
      },
    ]);

    const result = parseBinaryIndex(buffer);
    expect(result.entries[0].deleted).toBe(true);
    expect(result.entries[0].completed).toBe(false);
  });

  it("handles zero volume as null", () => {
    const buffer = createIndexBuffer([
      {
        id: 1,
        timestamp: 1707900000,
        duration: 30000,
        volume: 0,
        rating: 0,
        flags: 0x01,
        profileId: "p1",
        profileName: "No Scale",
      },
    ]);

    const result = parseBinaryIndex(buffer);
    expect(result.entries[0].volume).toBeNull();
  });

  it("throws on invalid magic number", () => {
    const buffer = Buffer.alloc(32);
    // Write wrong magic
    const view = new DataView(buffer.buffer);
    view.setUint32(0, 0xdeadbeef, true);

    expect(() => parseBinaryIndex(buffer)).toThrow("Invalid index magic");
  });

  it("throws on truncated file", () => {
    const buffer = Buffer.alloc(16); // too small for header
    expect(() => parseBinaryIndex(buffer)).toThrow("too small");
  });
});

describe("indexToShotList", () => {
  it("filters deleted entries and sorts by timestamp descending", () => {
    const buffer = createIndexBuffer([
      {
        id: 1,
        timestamp: 1707900000,
        duration: 28000,
        volume: 360,
        rating: 3,
        flags: 0x01, // completed
        profileId: "p1",
        profileName: "Early Shot",
      },
      {
        id: 2,
        timestamp: 1707900100,
        duration: 30000,
        volume: 0,
        rating: 0,
        flags: 0x02, // deleted
        profileId: "p2",
        profileName: "Deleted Shot",
      },
      {
        id: 3,
        timestamp: 1707900200,
        duration: 32000,
        volume: 400,
        rating: 5,
        flags: 0x01, // completed
        profileId: "p3",
        profileName: "Latest Shot",
      },
    ]);

    const indexData = parseBinaryIndex(buffer);
    const shotList = indexToShotList(indexData);

    // Should exclude deleted entry
    expect(shotList).toHaveLength(2);
    // Should be sorted most recent first
    expect(shotList[0].id).toBe("3");
    expect(shotList[1].id).toBe("1");
    // Should have correct profile
    expect(shotList[0].profile).toBe("Latest Shot");
  });

  it("converts rating 0 to null", () => {
    const buffer = createIndexBuffer([
      {
        id: 1,
        timestamp: 1707900000,
        duration: 30000,
        volume: 380,
        rating: 0,
        flags: 0x01,
        profileId: "p1",
        profileName: "Test",
      },
    ]);

    const indexData = parseBinaryIndex(buffer);
    const shotList = indexToShotList(indexData);
    expect(shotList[0].rating).toBeNull();
  });
});
