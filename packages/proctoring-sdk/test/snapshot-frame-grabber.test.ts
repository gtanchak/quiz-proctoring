import { describe, expect, it } from "vitest";
import { createCanvasFrameGrabber } from "../src/capture/frame-grabber.js";

const OPTIONS = {
  maxDimension: 1280,
  imageQuality: 0.7,
  format: "image/jpeg" as const,
};

describe("createCanvasFrameGrabber", () => {
  it("returns null when the stream has no video track", async () => {
    const grab = createCanvasFrameGrabber();
    const stream = { getVideoTracks: () => [] } as unknown as MediaStream;
    expect(await grab(stream, OPTIONS)).toBeNull();
  });

  it("returns null when the video track has ended", async () => {
    const grab = createCanvasFrameGrabber();
    const stream = {
      getVideoTracks: () => [{ readyState: "ended" }],
    } as unknown as MediaStream;
    expect(await grab(stream, OPTIONS)).toBeNull();
  });
});
