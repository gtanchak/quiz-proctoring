import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttemptReportView } from "../src/reports/AttemptReportView.js";
import { sampleReport } from "./fixtures.js";

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

    // Detail is hidden until the row is expanded.
    expect(screen.queryByText(/viewer arrives in V1/i)).not.toBeInTheDocument();

    const [firstToggle] = screen.getAllByRole("button", { name: /details for/i });
    fireEvent.click(firstToggle);

    expect(firstToggle).toHaveAttribute("aria-expanded", "true");
    // The first violation carries one evidence id.
    expect(screen.getByText(/1 item\(s\) — viewer arrives in V1/i)).toBeInTheDocument();
  });

  it("renders the empty state when there are no violations", () => {
    const report = sampleReport({ timeline: [], violationCount: 0 });
    render(<AttemptReportView report={report} />);

    expect(
      screen.getByText(/No violations were recorded/i),
    ).toBeInTheDocument();
  });
});
