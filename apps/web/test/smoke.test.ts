import { describe, expect, it } from "vitest";
import { appName } from "../src/app/version";

describe("@mrfund/web", () => {
  it("loads", () => {
    expect(appName).toBe("@mrfund/web");
  });
});
