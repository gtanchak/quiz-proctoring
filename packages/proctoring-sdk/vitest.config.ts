import { defineConfig } from "vitest/config";

export default defineConfig({
  // Detectors use browser DOM APIs (Page Visibility, blur/focus), so tests run
  // in a simulated DOM. Real cross-browser behaviour is verified separately.
  test: {
    environment: "jsdom",
  },
});
