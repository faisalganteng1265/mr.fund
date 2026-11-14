import type { Watcher } from "../core/loop";
import type { createRuntimeLog } from "./log";

interface Signals {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

/** Own one watcher and its heartbeat; SIGINT/SIGTERM stop timers, not transactions. */
export function runWatcher(
  watcher: Watcher,
  log: ReturnType<typeof createRuntimeLog>,
  signals: Signals = process,
  heartbeatMs = 30_000,
): () => void {
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0)
    throw new Error("Invalid heartbeat interval");
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = () => {
    try {
      log.heartbeat(watcher.status());
    } catch {
      /* Logging never changes request behavior. */
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    signals.removeListener("SIGINT", stop);
    signals.removeListener("SIGTERM", stop);
    watcher.stop();
    heartbeat();
  };
  signals.on("SIGINT", stop);
  signals.on("SIGTERM", stop);
  try {
    watcher.start();
    heartbeat();
    if (!stopped) timer = setInterval(heartbeat, heartbeatMs);
  } catch {
    stop();
    throw new Error("Watcher failed to start");
  }
  return stop;
}
