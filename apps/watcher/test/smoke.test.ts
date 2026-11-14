import { describe, expect, it } from "vitest";
import { packageName } from "../src/core/index";

describe("@mrfund/watcher", () => {
  it("loads", () => {
    expect(packageName).toBe("@mrfund/watcher");
  });
});
