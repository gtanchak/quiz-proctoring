import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttemptReportView } from "../src/reports/AttemptReportView.js";
import { sampleEvidence, sampleReport } from "./fixtures.js";

describe("AttemptReportView", () => {
  it("renders the summary header: title, candidate, outcome, score", () => {
    render(<AttemptReportView report={sampleReport()} />);

    expect(screen.getByText("Algebra I")).toBeInTheDocument();
    expect(screen.getByText("candidate@example.com")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("7 / 10")).toBeInTheDocument();
  });

  it("shows the auto-termination reason for an expired attempt", () => {
    const report = sampleReport({
      attempt: {
        ...sampleReport().attempt,
        status: "expired",
        terminationReason: "deadline_reached",
      },
    });
    render(<AttemptReportView report={report} />);

    expect(screen.getByText("Auto-submitted — time expired")).toBeInTheDocument();
    expect(
      screen.getByText(/timer expired and the attempt was auto-submitted/i),
    ).toBeInTheDocument();
  });

  it("lists each violation and reveals detail when expanded", () => {
    render(<AttemptReportView report={sampleReport()} />);

    expect(screen.getByText("Tab switch")).toBeInTheDocument();
    expect(screen.getByText("Left fullscreen")).toBeInTheDocument();

    // Per-row detail (the "Ended" field) is hidden until the row is expanded.
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();

    const [firstToggle] = screen.getAllByRole("button", { name: /details for/i });
    fireEvent.click(firstToggle);
    expect(firstToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("renders the empty state when there are no violations", () => {
    const report = sampleReport({ timeline: [], violationCount: 0 });
    render(<AttemptReportView report={report} />);

    expect(
      screen.getByText(/No violations were recorded/i),
    ).toBeInTheDocument();
  });

  it("shows an evidence thumbnail for a violation's linked capture", () => {
    render(
      <AttemptReportView report={sampleReport()} evidence={sampleEvidence()} />,
    );

    // The first violation links the webcam snapshot; expand it.
    const [firstToggle] = screen.getAllByRole("button", { name: /details for/i });
    fireEvent.click(firstToggle);

    // The linked webcam image is rendered (there's one in the gallery too).
    expect(screen.getAllByAltText(/Webcam ·/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders the capture gallery and opens an image in the lightbox", () => {
    render(
      <AttemptReportView report={sampleReport()} evidence={sampleEvidence()} />,
    );

    expect(screen.getByText(/Captured evidence \(2\)/i)).toBeInTheDocument();
    // The audio clip is playable inline.
    expect(screen.getByTestId("evidence-audio")).toBeInTheDocument();

    // Clicking an image thumbnail opens the lightbox dialog.
    const [enlarge] = screen.getAllByRole("button", { name: /Enlarge snapshot/i });
    fireEvent.click(enlarge);
    const dialog = screen.getByRole("dialog", { name: /Evidence preview/i });
    expect(within(dialog).getByAltText(/Webcam ·/i)).toBeInTheDocument();

    // Escape closes it.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: /Evidence preview/i }),
    ).not.toBeInTheDocument();
  });

  it("runs the permanent-delete action when confirmed", async () => {
    const onDeleteEvidence = vi.fn().mockResolvedValue(undefined);
    render(
      <AttemptReportView
        report={sampleReport()}
        evidence={sampleEvidence()}
        onDeleteEvidence={onDeleteEvidence}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Delete all evidence/i }));
    // Two-step confirm guards the irreversible action.
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    expect(onDeleteEvidence).toHaveBeenCalledTimes(1);
    // Await the post-delete state reset so it settles inside act().
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^Confirm$/i }),
      ).not.toBeInTheDocument(),
    );
  });
});
