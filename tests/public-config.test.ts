import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public demo config", () => {
  it("contains only a non-secret dummy identity placeholder", () => {
    const config = readFileSync(new URL("../public/config.js", import.meta.url), "utf8");

    expect(config).toContain("dummyUserId");
    expect(config).toContain("replace-with-local-dummy-user-id");
    expect(config).not.toMatch(/(TOKEN|KEY|SECRET|PASSWORD|API_KEY)/i);
  });
});
