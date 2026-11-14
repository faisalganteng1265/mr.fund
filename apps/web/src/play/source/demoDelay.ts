/** Local adapter delays own their timer and abort listener until settlement. */
export function demoDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  // This workspace targets ES2022, before Promise.withResolvers.
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
