import type { ViolationEvent } from "@proctoring/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FullscreenController } from "../src/detectors/fullscreen.js";
import type { FullscreenConfig } from "../src/detectors/fullscreen.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";

let fsElement: Element | null = null;

/** Installs a minimal Fullscreen API on the jsdom document (jsdom lacks it). */
function mockFullscreenApi(): void {
  fsElement = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fsElement,
  });
  document.documentElement.requestFullscreen = async () => {
    fsElement = document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
  };
  document.exitFullscreen = async () => {
    fsElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  };
}

function simulateUserExit(): void {
  fsElement = null;
  document.dispatchEvent(new Event("fullscreenchange"));
}

function make(config: FullscreenConfig = {}) {
  const events: ViolationEvent[] = [];
  const controller = new FullscreenController(
    { attemptId: ATTEMPT, emit: (e) => events.push(e) },
    config,
  );
  return { controller, events };
}

beforeEach(() => {
  mockFullscreenApi();
});

describe("FullscreenController", () => {
  it("enters fullscreen and fires onEnter", async () => {
    const onEnter = vi.fn();
    const { controller } = make({ onEnter });
    controller.start();
    await controller.enter();
    expect(controller.isFullscreen()).toBe(true);
    expect(onEnter).toHaveBeenCalled();
    controller.stop();
  });

  it("logs a fullscreen_exit with a timestamp and fires onExit", async () => {
    const onExit = vi.fn();
    const { controller, events } = make({ onExit });
    controller.start();
    await controller.enter();
    simulateUserExit();

    expect(onExit).toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      attemptId: ATTEMPT,
      type: "fullscreen_exit",
      severity: "high",
    });
    expect(events[0].startedAt).toBeTruthy();
    controller.stop();
  });

  it("supports re-entry after an exit", async () => {
    const onEnter = vi.fn();
    const { controller } = make({ onEnter });
    controller.start();
    await controller.enter();
    simulateUserExit();
    await controller.enter();
    expect(controller.isFullscreen()).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("does not log exits when fullscreen is not required", async () => {
    const onExit = vi.fn();
    const { controller, events } = make({ required: false, onExit });
    controller.start();
    await controller.enter();
    simulateUserExit();
    expect(events).toHaveLength(0);
    expect(onExit).not.toHaveBeenCalled();
    controller.stop();
  });

  it("stops detecting after stop()", async () => {
    const { controller, events } = make();
    controller.start();
    await controller.enter();
    controller.stop();
    simulateUserExit();
    expect(events).toHaveLength(0);
  });

  it("attaches evidence ids from the capture hook", async () => {
    const events: ViolationEvent[] = [];
    const controller = new FullscreenController(
      {
        attemptId: ATTEMPT,
        emit: (e) => events.push(e),
        captureEvidence: () => ["ev_fs_1"],
      },
      {},
    );
    controller.start();
    await controller.enter();
    simulateUserExit();
    expect(events[0].evidenceIds).toEqual(["ev_fs_1"]);
    controller.stop();
  });
});
