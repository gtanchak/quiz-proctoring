/**
 * A deterministic stand-in for `window` for the capture tests: full control over
 * online/offline state, the `online` event, and scheduled timers (no real
 * clock). Lets us exercise backoff/reconnect without flakiness.
 */
export interface FakeWindow {
  win: Window;
  setOnline(online: boolean): void;
  fire(type: string): void;
  /** Runs every currently-pending timer callback (FIFO), once. */
  runTimers(): void;
  pendingTimers(): number;
}

export function makeFakeWindow(): FakeWindow {
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, () => void>();
  let online = true;
  let nextId = 1;

  const win = {
    navigator: {
      get onLine(): boolean {
        return online;
      },
    },
    addEventListener(type: string, cb: () => void): void {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(cb);
    },
    removeEventListener(type: string, cb: () => void): void {
      listeners.get(type)?.delete(cb);
    },
    setTimeout(cb: () => void): number {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clearTimeout(id: number): void {
      timers.delete(id);
    },
  };

  return {
    win: win as unknown as Window,
    setOnline(value: boolean): void {
      online = value;
    },
    fire(type: string): void {
      listeners.get(type)?.forEach((cb) => cb());
    },
    runTimers(): void {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((cb) => cb());
    },
    pendingTimers(): number {
      return timers.size;
    },
  };
}

/** Flushes pending microtasks (the queue's async upload chain). */
export const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));
