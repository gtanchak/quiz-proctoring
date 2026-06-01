import type { CapturedFrame, FrameGrabber, FrameGrabOptions } from "./types.js";

/**
 * The default {@link FrameGrabber}: draws the current video frame to a canvas,
 * downscales to the configured longest edge, and encodes to a compressed Blob.
 *
 * Why canvas-from-`<video>` rather than `ImageCapture.grabFrame()`? `ImageCapture`
 * is still unavailable in Safari and Firefox; the video→canvas path works across
 * every browser we target (CLAUDE.md §8). `OffscreenCanvas` is used when present
 * to keep the encode off the main thread, with a DOM-canvas fallback.
 *
 * Best-effort: any failure (no video track, not yet decodable, encode error)
 * resolves to `null` so the scheduler simply skips that capture.
 */
export function createCanvasFrameGrabber(context: {
  document?: Document;
  window?: Window;
} = {}): FrameGrabber {
  const doc =
    context.document ?? (typeof document !== "undefined" ? document : undefined);
  const win =
    context.window ?? (typeof window !== "undefined" ? window : undefined);

  return async (stream, options): Promise<CapturedFrame | null> => {
    if (!doc) return null;
    const [track] = stream.getVideoTracks();
    if (!track || track.readyState === "ended") return null;

    const video = doc.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    try {
      await playAndWait(video);
      const srcW = video.videoWidth || track.getSettings().width || 0;
      const srcH = video.videoHeight || track.getSettings().height || 0;
      if (!srcW || !srcH) return null;

      const { width, height } = fitWithin(srcW, srcH, options.maxDimension);
      const blob = await encode(video, width, height, options, win);
      if (!blob) return null;
      return { blob, width, height };
    } catch {
      return null;
    } finally {
      video.pause();
      video.srcObject = null;
    }
  };
}

/** Resolves once the video has a decodable current frame (or rejects/times out). */
function playAndWait(video: HTMLVideoElement): Promise<void> {
  const ready = (): boolean =>
    video.readyState >= 2 /* HAVE_CURRENT_DATA */ && video.videoWidth > 0;
  // play() may reject in some autoplay policies; the frame can still decode.
  void video.play?.().catch(() => undefined);
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("video failed to load"));
    };
    const cleanup = (): void => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/** Scales (w,h) so the longest edge is at most `max`, never upscaling. */
function fitWithin(
  w: number,
  h: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { width: w, height: h };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

async function encode(
  video: HTMLVideoElement,
  width: number,
  height: number,
  options: FrameGrabOptions,
  win: Window | undefined,
): Promise<Blob | null> {
  const OffscreenCanvasCtor = (win as unknown as { OffscreenCanvas?: typeof OffscreenCanvas })
    ?.OffscreenCanvas;
  if (typeof OffscreenCanvasCtor === "function") {
    const canvas = new OffscreenCanvasCtor(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.convertToBlob({
      type: options.format,
      quality: options.imageQuality,
    });
  }

  const canvas = video.ownerDocument.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      options.format,
      options.imageQuality,
    );
  });
}
