import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@mrfund/guardian-client", () => {
  it("loads", () => {
    expect(packageName).toBe("@mrfund/guardian-client");
  });
});
