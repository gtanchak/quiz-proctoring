import { describe, expect, it } from "vitest";
import { linkState } from "../src/lib/access.js";

describe("linkState", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const base = { availableFrom: null, availableUntil: null };

  it("is closed for an unpublished test regardless of window", () => {
    expect(linkState({ status: "draft", ...base }, now)).toBe("closed");
    expect(linkState({ status: "archived", ...base }, now)).toBe("closed");
  });

  it("is open for a published test with no window", () => {
    expect(linkState({ status: "published", ...base }, now)).toBe("open");
  });

  it("is not_yet_open before the window starts", () => {
    expect(
      linkState(
        {
          status: "published",
          availableFrom: new Date("2026-06-20T00:00:00.000Z"),
          availableUntil: null,
        },
        now,
      ),
    ).toBe("not_yet_open");
  });

  it("is closed after the window ends", () => {
    expect(
      linkState(
        {
          status: "published",
          availableFrom: null,
          availableUntil: new Date("2026-06-10T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe("closed");
  });

  it("is open inside the window", () => {
    expect(
      linkState(
        {
          status: "published",
          availableFrom: new Date("2026-06-10T00:00:00.000Z"),
          availableUntil: new Date("2026-06-20T00:00:00.000Z"),
        },
        now,
      ),
    ).toBe("open");
  });
});
