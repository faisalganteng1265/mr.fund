import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@mrfund/agent", () => {
  it("loads", () => {
    expect(packageName).toBe("@mrfund/agent");
  });
});
