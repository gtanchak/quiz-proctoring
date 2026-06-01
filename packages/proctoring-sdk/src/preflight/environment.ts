import type { EnvironmentReport, PreflightContext } from "./types.js";

/**
 * Feature-detects whether the current browser can support proctoring capture.
 * Pure and synchronous; safe to call before any permission request.
 */
export function checkEnvironment(ctx: PreflightContext = {}): EnvironmentReport {
  const win =
    ctx.window ?? (typeof window !== "undefined" ? window : undefined);
  const nav =
    ctx.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);

  const secureContext = win?.isSecureContext ?? false;
  const media = nav?.mediaDevices as MediaDevices | undefined;
  const getUserMedia = typeof media?.getUserMedia === "function";
  const getDisplayMedia = typeof media?.getDisplayMedia === "function";
  const fullscreen =
    typeof win?.document?.documentElement?.requestFullscreen === "function";

  const { browser, version } = parseUserAgent(nav?.userAgent ?? "");

  return {
    secureContext,
    getUserMedia,
    getDisplayMedia,
    fullscreen,
    browser,
    version,
    // Camera/mic capture is the floor; screen-share is optional in MVP.
    isSupported: secureContext && getUserMedia,
  };
}

/**
 * Coarse, best-effort UA parse — for a friendly "you're on Chrome 120" message
 * and unsupported hints only, never for gating logic (which uses feature
 * detection above). Order matters: Edge and Chrome UAs both contain "Chrome".
 */
function parseUserAgent(ua: string): { browser: string; version: string } {
  const matchers: ReadonlyArray<readonly [string, RegExp]> = [
    ["Edge", /Edg\/([\d.]+)/],
    ["Chrome", /Chrome\/([\d.]+)/],
    ["Firefox", /Firefox\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, re] of matchers) {
    const m = ua.match(re);
    if (m) {
      return { browser: name, version: m[1] };
    }
  }
  return { browser: "Unknown", version: "" };
}
