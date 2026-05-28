import type { ViolationEvent } from "@proctoring/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TabSwitchDetector } from "../src/detectors/tab-switch.js";
import type { TabSwitchConfig } from "../src/detectors/tab-switch.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";

let nowMs = 0;
const now = () => new Date(nowMs);

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function makeDetector(config: TabSwitchConfig = {}) {
  const events: ViolationEvent[] = [];
  const detector = new TabSwitchDetector(
    { attemptId: ATTEMPT, emit: (e) => events.push(e), now },
    config,
  );
  return { detector, events };
}

beforeEach(() => {
  nowMs = 1_000_000;
  setVisibility("visible");
});

afterEach(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("TabSwitchDetector", () => {
  it("detects a tab switch and reports the away duration", () => {
    const { detector, events } = makeDetector();
    detector.start();

    setVisibility("hidden");
    nowMs += 5_000;
    setVisibility("visible");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      attemptId: ATTEMPT,
      type: "tab_switch",
      severity: "medium",
      metadata: { durationMs: 5_000 },
    });
    expect(events[0].endedAt).toBeTruthy();
    detector.stop();
  });

  it("detects an app switch via blur/focus while the tab stays visible", () => {
    const { detector, events } = makeDetector();
    detector.start();

    window.dispatchEvent(new Event("blur"));
    nowMs += 1_000;
    window.dispatchEvent(new Event("focus"));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "window_blur",
      severity: "low",
      metadata: { durationMs: 1_000 },
    });
    detector.stop();
  });

  it("upgrades a blur that becomes a tab hide to tab_switch (no double count)", () => {
    const { detector, events } = makeDetector();
    detector.start();

    window.dispatchEvent(new Event("blur")); // app switch begins...
    setVisibility("hidden"); // ...but the tab is actually hidden
    nowMs += 4_000;
    setVisibility("visible");

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tab_switch");
    detector.stop();
  });

  it("ignores away-intervals shorter than minAwayMs", () => {
    const { detector, events } = makeDetector({ minAwayMs: 2_000 });
    detector.start();

    setVisibility("hidden");
    nowMs += 500;
    setVisibility("visible");

    expect(events).toHaveLength(0);
    detector.stop();
  });

  it("respects disabled signals", () => {
    const { detector, events } = makeDetector({ detectTabSwitch: false });
    detector.start();
    setVisibility("hidden");
    nowMs += 5_000;
    setVisibility("visible");
    expect(events).toHaveLength(0);
    detector.stop();
  });

  it("emits nothing after stop()", () => {
    const { detector, events } = makeDetector();
    detector.start();
    detector.stop();
    setVisibility("hidden");
    nowMs += 5_000;
    setVisibility("visible");
    expect(events).toHaveLength(0);
  });

  it("flags an extended desktop at start (best-effort)", () => {
    Object.defineProperty(window.screen, "isExtended", {
      configurable: true,
      value: true,
    });
    const { detector, events } = makeDetector();
    detector.start();
    expect(events.some((e) => e.type === "multiple_monitors")).toBe(true);
    detector.stop();
    Object.defineProperty(window.screen, "isExtended", {
      configurable: true,
      value: false,
    });
  });
});
