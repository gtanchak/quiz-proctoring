import { PreflightController } from "@proctoring/proctoring-sdk";
import { DEFAULT_PROCTORING_REQUIREMENTS } from "@proctoring/shared";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreTestCheck } from "../src/preflight/PreTestCheck.js";

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

/** A controller backed by a supported, permissive fake environment. */
function supportedController(reqs = DEFAULT_PROCTORING_REQUIREMENTS) {
  const getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  const getDisplayMedia = vi.fn().mockResolvedValue(fakeStream());
  return new PreflightController(reqs, {
    window: { isSecureContext: true } as unknown as Window,
    navigator: {
      mediaDevices: { getUserMedia, getDisplayMedia },
      userAgent: "Chrome/120",
    } as unknown as Navigator,
  });
}

describe("PreTestCheck", () => {
  it("keeps Start disabled until the required permissions are granted", async () => {
    const controller = supportedController();
    render(
      <PreTestCheck
        requirements={DEFAULT_PROCTORING_REQUIREMENTS}
        controller={controller}
        onReady={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Start test" })).toBeDisabled();

    await act(async () => {
      await controller.requestCamera();
      await controller.requestMicrophone();
    });

    expect(screen.getByRole("button", { name: "Start test" })).toBeEnabled();
  });

  it("grants a permission when its Grant button is clicked", async () => {
    const controller = supportedController();
    render(
      <PreTestCheck
        requirements={DEFAULT_PROCTORING_REQUIREMENTS}
        controller={controller}
        onReady={vi.fn()}
      />,
    );

    // Order matches PROCTORING_SIGNALS: camera, microphone, screen.
    const grantButtons = screen.getAllByRole("button", { name: "Grant" });
    fireEvent.click(grantButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    });
  });

  it("shows the unsupported screen when capture isn't available", () => {
    const controller = new PreflightController(DEFAULT_PROCTORING_REQUIREMENTS, {
      window: { isSecureContext: false } as unknown as Window,
      navigator: { userAgent: "x" } as unknown as Navigator,
    });
    render(
      <PreTestCheck
        requirements={DEFAULT_PROCTORING_REQUIREMENTS}
        controller={controller}
        onReady={vi.fn()}
      />,
    );

    expect(screen.getByText(/isn't supported/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start test" }),
    ).not.toBeInTheDocument();
  });
});
