import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViolationTimeline } from "../src/reports/ViolationTimeline.js";
import { sampleReport } from "./fixtures.js";

describe("ViolationTimeline", () => {
  it("renders one marker per violation, positioned by offset", () => {
    const { timeline } = sampleReport();
    render(<ViolationTimeline violations={timeline} totalMs={60 * 60_000} />);

    const markers = screen.getAllByTestId("timeline-marker");
    expect(markers).toHaveLength(2);
    // 60s / 3600s = 1.67%, 600s / 3600s = 16.67%
    expect(markers[0].style.left).toBe("1.6666666666666667%");
    expect(markers[1].style.left).toBe("16.666666666666664%");
  });

  it("clamps a marker past the span to 100%", () => {
    const { timeline } = sampleReport();
    render(<ViolationTimeline violations={timeline} totalMs={60_000} />);

    const markers = screen.getAllByTestId("timeline-marker");
    expect(markers[1].style.left).toBe("100%");
  });

  it("shows an empty state with no violations", () => {
    render(<ViolationTimeline violations={[]} totalMs={60_000} />);
    expect(screen.getByText(/No violations were recorded/i)).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-marker")).not.toBeInTheDocument();
  });
});
