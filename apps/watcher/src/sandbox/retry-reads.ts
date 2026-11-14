/** Only for sandbox RPC reads made before signing; never wraps a transaction or broadcast. */
export async function retrySandboxRead<T>(
  read: () => Promise<T>,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 500)),
): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await read();
    } catch {
      if (attempt === 5) throw new Error("Sandbox read unavailable");
      await wait();
    }
  }
  throw new Error("Sandbox read unavailable");
}
