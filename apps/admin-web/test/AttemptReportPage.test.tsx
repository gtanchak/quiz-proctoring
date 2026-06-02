import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttemptReportPage } from "../src/reports/AttemptReportPage.js";
import { sampleReport } from "./fixtures.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";

describe("AttemptReportPage", () => {
  it("shows a loading state, then renders the report", async () => {
    const load = vi.fn().mockResolvedValue(sampleReport());
    render(<AttemptReportPage attemptId={ATTEMPT} load={load} />);

    expect(screen.getByText(/Loading report/i)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("Algebra I")).toBeInTheDocument(),
    );
    expect(load).toHaveBeenCalledWith(ATTEMPT);
  });

  it("shows an error state when loading fails", async () => {
    const load = vi.fn().mockRejectedValue(new Error("Report not found"));
    render(<AttemptReportPage attemptId={ATTEMPT} load={load} />);

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load this report/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Report not found")).toBeInTheDocument();
  });
});
