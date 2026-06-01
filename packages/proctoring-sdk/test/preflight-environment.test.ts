import { describe, expect, it } from "vitest";
import { checkEnvironment } from "../src/preflight/environment.js";

function ctx(opts: {
  secure?: boolean;
  getUserMedia?: boolean;
  getDisplayMedia?: boolean;
  fullscreen?: boolean;
  ua?: string;
}) {
  const mediaDevices: Record<string, unknown> = {};
  if (opts.getUserMedia) mediaDevices.getUserMedia = () => {};
  if (opts.getDisplayMedia) mediaDevices.getDisplayMedia = () => {};
  return {
    window: {
      isSecureContext: opts.secure ?? false,
      document: {
        documentElement: opts.fullscreen ? { requestFullscreen: () => {} } : {},
      },
    } as unknown as Window,
    navigator: {
      mediaDevices,
      userAgent: opts.ua ?? "",
    } as unknown as Navigator,
  };
}

describe("checkEnvironment", () => {
  it("is supported with a secure context and getUserMedia", () => {
    const env = checkEnvironment(
      ctx({
        secure: true,
        getUserMedia: true,
        getDisplayMedia: true,
        fullscreen: true,
        ua: "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36",
      }),
    );
    expect(env.isSupported).toBe(true);
    expect(env.getDisplayMedia).toBe(true);
    expect(env.fullscreen).toBe(true);
    expect(env.browser).toBe("Chrome");
    expect(env.version).toBe("120.0.0.0");
  });

  it("is unsupported without a secure context", () => {
    const env = checkEnvironment(ctx({ secure: false, getUserMedia: true }));
    expect(env.isSupported).toBe(false);
  });

  it("is unsupported when getUserMedia is missing", () => {
    const env = checkEnvironment(ctx({ secure: true, getUserMedia: false }));
    expect(env.getUserMedia).toBe(false);
    expect(env.isSupported).toBe(false);
  });

  it("identifies Edge ahead of Chrome in the UA", () => {
    const env = checkEnvironment(
      ctx({ secure: true, getUserMedia: true, ua: "Chrome/120.0.0.0 Edg/120.0.0.0" }),
    );
    expect(env.browser).toBe("Edge");
  });
});
