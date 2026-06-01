import { describe, expect, it } from "vitest";
import {
  DEFAULT_SNAPSHOT_CONFIG,
  SNAPSHOT_SCHEMA_VERSION,
  validateSnapshotCaptureConfig,
  validateSnapshotMetadata,
} from "../src/index.js";

const ID = "11111111-1111-1111-1111-111111111111";
const ATTEMPT = "22222222-2222-2222-2222-222222222222";

const validMetadata = {
  id: ID,
  attemptId: ATTEMPT,
  kind: "webcam",
  capturedAt: "2026-06-01T12:00:00.000Z",
  contentType: "image/jpeg",
  byteSize: 24_576,
  width: 1280,
  height: 720,
};

describe("validateSnapshotCaptureConfig", () => {
  it("fills defaults for an empty config", () => {
    const result = validateSnapshotCaptureConfig({ format: "image/jpeg" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toMatchObject(DEFAULT_SNAPSHOT_CONFIG);
    }
  });

  it("rejects a jitterRatio outside 0..1", () => {
    const result = validateSnapshotCaptureConfig({
      format: "image/jpeg",
      jitterRatio: 1.5,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an interval below the floor", () => {
    expect(
      validateSnapshotCaptureConfig({
        format: "image/jpeg",
        averageIntervalMs: 500,
      }).valid,
    ).toBe(false);
  });

  it("rejects an unknown image format", () => {
    expect(
      validateSnapshotCaptureConfig({ format: "image/gif" }).valid,
    ).toBe(false);
  });
});

describe("validateSnapshotMetadata", () => {
  it("accepts valid metadata and fills the schema version", () => {
    const result = validateSnapshotMetadata(validMetadata);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    }
  });

  it("rejects a non-uuid attempt id", () => {
    expect(
      validateSnapshotMetadata({ ...validMetadata, attemptId: "nope" }).valid,
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(
      validateSnapshotMetadata({ ...validMetadata, kind: "thermal" }).valid,
    ).toBe(false);
  });

  it("rejects a non-positive image dimension", () => {
    expect(
      validateSnapshotMetadata({ ...validMetadata, width: 0 }).valid,
    ).toBe(false);
  });
});
