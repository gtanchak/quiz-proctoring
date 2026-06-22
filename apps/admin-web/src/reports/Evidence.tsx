import type { EvidenceItem } from "@proctoring/shared";
import { Button } from "@proctoring/ui-components";
import { useEffect, useState } from "react";
import { formatClock } from "./violation-display.js";

/**
 * Evidence viewer (PRO-27): thumbnails, a click-to-enlarge lightbox, and inline
 * audio playback. Evidence is served only via the signed, expiring URLs carried
 * on each {@link EvidenceItem} (CLAUDE.md §5) — these components just render
 * those URLs; they never construct one.
 */

const isAudio = (contentType: string): boolean =>
  contentType.startsWith("audio/");

function captionFor(item: EvidenceItem): string {
  const kind = item.kind === "screen" ? "Screen" : "Webcam";
  return `${kind} · ${formatClock(item.capturedAt)}`;
}

/** One evidence item: an image thumbnail (opens the lightbox) or an audio clip. */
export function EvidenceThumbnail({
  item,
  onOpen,
}: {
  item: EvidenceItem;
  onOpen: (item: EvidenceItem) => void;
}): JSX.Element {
  if (isAudio(item.contentType)) {
    return (
      <figure className="flex flex-col gap-1">
        {/* preload=none: don't fetch (and burn the signed URL) until played. */}
        <audio
          controls
          preload="none"
          src={item.url}
          className="h-8 w-44"
          data-testid="evidence-audio"
        />
        <figcaption className="text-xs text-muted-foreground">
          {captionFor(item)}
        </figcaption>
      </figure>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group relative overflow-hidden rounded border bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={`Enlarge snapshot — ${captionFor(item)}`}
    >
      <img
        src={item.url}
        alt={captionFor(item)}
        loading="lazy"
        className="h-16 w-16 object-cover transition group-hover:opacity-90"
      />
    </button>
  );
}

/** Modal preview of a single evidence item. Esc or backdrop click closes it. */
export function EvidenceLightbox({
  item,
  onClose,
}: {
  item: EvidenceItem | null;
  onClose: () => void;
}): JSX.Element | null {
  useEffect(() => {
    if (!item) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Evidence preview"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-full max-w-3xl overflow-auto rounded-lg bg-background p-3 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {isAudio(item.contentType) ? (
          <audio controls autoPlay src={item.url} className="w-full" />
        ) : (
          <img
            src={item.url}
            alt={captionFor(item)}
            className="max-h-[80vh] w-auto rounded"
          />
        )}
        <div className="mt-2 flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>{captionFor(item)}</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The full capture gallery for an attempt — every snapshot/clip, including
 * periodic captures not tied to a specific violation. Includes the per-attempt
 * permanent-delete action (the actual erasure happens server-side; the broader
 * retention flow is PRO-41).
 */
export function EvidenceGallery({
  items,
  onOpen,
  onDeleteAll,
}: {
  items: EvidenceItem[];
  onOpen: (item: EvidenceItem) => void;
  /** When provided, renders a permanent "delete all evidence" action. */
  onDeleteAll?: () => Promise<void>;
}): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Captured evidence ({items.length})
        </h2>
        {onDeleteAll ? <DeleteEvidenceButton onConfirm={onDeleteAll} /> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        {items.map((item) => (
          <EvidenceThumbnail key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

/** Two-step, in-place confirm for the irreversible delete (no modal dependency). */
function DeleteEvidenceButton({
  onConfirm,
}: {
  onConfirm: () => Promise<void>;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!confirming) {
    return (
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        Delete all evidence
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Permanently delete?</span>
      <Button
        variant="destructive"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setConfirming(false);
          }
        }}
      >
        {busy ? "Deleting…" : "Confirm"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
