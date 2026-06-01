/**
 * @proctoring/ui-components — shared design system (shadcn/ui + Tailwind v4)
 * for the candidate and admin web apps.
 *
 * Components are consumed from `@proctoring/ui-components`; the Tailwind theme +
 * tokens ship as `@proctoring/ui-components/globals.css`, which an app imports
 * once (and adds an `@source` for this package's `src` so the utility classes
 * are detected).
 */

export const UI_COMPONENTS_VERSION = "0.1.0" as const;

export { cn } from "./lib/utils.js";
export * from "./components/ui/button.js";
export * from "./components/ui/card.js";
export * from "./components/ui/badge.js";
export * from "./components/ui/alert.js";
export * from "./components/ui/progress.js";
