import { describe, expect, it } from "vitest";
import { packageName } from "../src/index";

describe("@mrfund/rhea", () => {
  it("loads", () => {
    expect(packageName).toBe("@mrfund/rhea");
  });
});
