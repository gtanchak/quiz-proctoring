import {
  DEFAULT_PROCTORING_REQUIREMENTS,
  type ProctoringRequirements,
} from "@proctoring/shared";
import { describe, expect, it, vi } from "vitest";
import { PreflightController } from "../src/preflight/controller.js";
import type { PreflightContext } from "../src/preflight/types.js";

interface FakeStream {
  getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }>;
}

function fakeStream(): FakeStream {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track] };
}

/** Builds a controller whose navigator.mediaDevices is the given mock. */
function controller(
  mediaDevices: Partial<MediaDevices>,
  requirements: ProctoringRequirements = DEFAULT_PROCTORING_REQUIREMENTS,
) {
  const context: PreflightContext = {
    window: { isSecureContext: true } as unknown as Window,
    navigator: { mediaDevices, userAgent: "Chrome/120" } as unknown as Navigator,
  };
  return new PreflightController(requirements, context);
}

describe("PreflightController", () => {
  it("becomes ready once required camera + mic are granted (screen optional)", async () => {
    const cam = fakeStream();
    const mic = fakeStream();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(cam)
      .mockResolvedValueOnce(mic);
    const c = controller({ getUserMedia } as unknown as MediaDevices);

    expect(c.isReady()).toBe(false);

    await c.requestCamera();
    expect(c.getState().signals.camera.status).toBe("granted");
    expect(c.isReady()).toBe(false); // microphone still pending

    await c.requestMicrophone();
    expect(c.getState().signals.microphone.status).toBe("granted");
    expect(c.isReady()).toBe(true); // screen is optional, so not required

    expect(c.getStreams().camera).toBe(cam);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, { video: true });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
  });

  it("maps a blocked permission to denied + a recovery hint, and allows retry", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const c = controller({ getUserMedia } as unknown as MediaDevices);

    await c.requestCamera();
    let cam = c.getState().signals.camera;
    expect(cam.status).toBe("denied");
    expect(cam.recovery).toBe("allow-in-browser");
    expect(c.isReady()).toBe(false);

    // Candidate fixes the setting and retries → granted.
    getUserMedia.mockResolvedValueOnce(fakeStream());
    await c.requestCamera();
    cam = c.getState().signals.camera;
    expect(cam.status).toBe("granted");
  });

  it("maps a missing device to unavailable", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException("no cam", "NotFoundError"));
    const c = controller({ getUserMedia } as unknown as MediaDevices);
    await c.requestCamera();
    expect(c.getState().signals.camera.status).toBe("unavailable");
    expect(c.getState().signals.camera.recovery).toBe("connect-device");
  });

  it("notifies subscribers on each state change", async () => {
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const c = controller({ getUserMedia } as unknown as MediaDevices);
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.signals.camera.status));
    await c.requestCamera();
    // immediate(idle) → prompting → granted
    expect(seen).toContain("prompting");
    expect(seen.at(-1)).toBe("granted");
  });

  it("stop() stops every acquired track", async () => {
    const cam = fakeStream();
    const mic = fakeStream();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(cam)
      .mockResolvedValueOnce(mic);
    const c = controller({ getUserMedia } as unknown as MediaDevices);
    await c.requestCamera();
    await c.requestMicrophone();

    c.stop();
    expect(cam.getTracks()[0].stop).toHaveBeenCalled();
    expect(mic.getTracks()[0].stop).toHaveBeenCalled();
    expect(c.getStreams().camera).toBeNull();
    expect(c.isReady()).toBe(false);
  });

  it("treats screen as required when configured and gates on it", async () => {
    const stream = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    const c = controller(
      { getUserMedia, getDisplayMedia } as unknown as MediaDevices,
      { camera: false, microphone: false, screen: true },
    );
    expect(c.isReady()).toBe(false);
    await c.requestScreen();
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true });
    expect(c.isReady()).toBe(true);
  });

  it("reports unavailable when mediaDevices is absent", async () => {
    const c = new PreflightController(DEFAULT_PROCTORING_REQUIREMENTS, {
      window: { isSecureContext: true } as unknown as Window,
      navigator: { userAgent: "x" } as unknown as Navigator,
    });
    await c.requestCamera();
    expect(c.getState().signals.camera.status).toBe("unavailable");
  });
});
