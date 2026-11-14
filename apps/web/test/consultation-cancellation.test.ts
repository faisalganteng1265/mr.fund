import { afterEach, expect, it, vi } from "vitest";
import { createDemoSource } from "../src/play/source/demoSource";

afterEach(() => vi.useRealTimers());
it.each(["connect", "refresh", "execute"] as const)(
  "releases the %s delay immediately on abort",
  async (action) => {
    vi.useFakeTimers();
    const source = createDemoSource();
    const controller = new AbortController();
    const pending =
      action === "connect"
        ? source.session.connect(controller.signal)
        : action === "refresh"
          ? source.position.refresh(controller.signal)
          : source.execution
              .execute(source.execution.prepareRepay("100")?.id ?? "", "success", controller.signal)
              [Symbol.asyncIterator]()
              .next();
    const failure = expect(pending).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    await failure;
    expect(source.position.getSnapshot().debt).toBe(1_800_000_000n);
    expect(source.session.getSnapshot().walletBalance).toBe(1_000_000_000n);
  },
);
