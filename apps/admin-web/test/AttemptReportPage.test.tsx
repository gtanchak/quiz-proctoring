import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttemptReportPage } from "../src/reports/AttemptReportPage.js";
import { sampleEvidence, sampleReport } from "./fixtures.js";

const ATTEMPT = "22222222-2222-2222-2222-222222222222";

describe("AttemptReportPage", () => {
  it("shows a loading state, then renders the report and its evidence", async () => {
    const load = vi.fn().mockResolvedValue(sampleReport());
    const loadEvidence = vi.fn().mockResolvedValue(sampleEvidence());
    render(
      <AttemptReportPage
        attemptId={ATTEMPT}
        load={load}
        loadEvidence={loadEvidence}
      />,
    );

    expect(screen.getByText(/Loading report/i)).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText("Algebra I")).toBeInTheDocument(),
    );
    expect(load).toHaveBeenCalledWith(ATTEMPT);
    expect(loadEvidence).toHaveBeenCalledWith(ATTEMPT);
    expect(screen.getByText(/Captured evidence \(2\)/i)).toBeInTheDocument();
  });

  it("still renders the report when evidence fails to load", async () => {
    const load = vi.fn().mockResolvedValue(sampleReport());
    const loadEvidence = vi.fn().mockRejectedValue(new Error("gone"));
    render(
      <AttemptReportPage
        attemptId={ATTEMPT}
        load={load}
        loadEvidence={loadEvidence}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("Algebra I")).toBeInTheDocument(),
    );
    // No gallery (no evidence), but the report itself is intact.
    expect(screen.queryByText(/Captured evidence/i)).not.toBeInTheDocument();
  });

  it("shows an error state when the report fails to load", async () => {
    const load = vi.fn().mockRejectedValue(new Error("Report not found"));
    const loadEvidence = vi.fn().mockResolvedValue([]);
    render(
      <AttemptReportPage
        attemptId={ATTEMPT}
        load={load}
        loadEvidence={loadEvidence}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load this report/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Report not found")).toBeInTheDocument();
  });

  it("deletes evidence and refreshes the gallery", async () => {
    const load = vi.fn().mockResolvedValue(sampleReport());
    const loadEvidence = vi
      .fn()
      .mockResolvedValueOnce(sampleEvidence())
      .mockResolvedValueOnce([]);
    const deleteEvidence = vi.fn().mockResolvedValue(2);
    render(
      <AttemptReportPage
        attemptId={ATTEMPT}
        load={load}
        loadEvidence={loadEvidence}
        deleteEvidence={deleteEvidence}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Captured evidence \(2\)/i)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Delete all evidence/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/i }));

    await waitFor(() => expect(deleteEvidence).toHaveBeenCalledWith(ATTEMPT));
    await waitFor(() =>
      expect(screen.queryByText(/Captured evidence/i)).not.toBeInTheDocument(),
    );
  });
});
