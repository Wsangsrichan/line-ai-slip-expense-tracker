import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public LIFF configuration", () => {
  it("contains the production LIFF ID and no dummy identity", () => {
    const config = readFileSync(new URL("../public/config.js", import.meta.url), "utf8");

    expect(config).toContain('liffId: "2011459743-AVxRSBMO"');
    expect(config).not.toContain("dummyUserId");
    expect(config).not.toContain("replace-with-local-dummy-user-id");
    expect(config).not.toMatch(/(TOKEN|KEY|SECRET|PASSWORD|API_KEY)/i);
  });

  it("does not send a dummy identity from the LIFF frontend", () => {
    const frontend = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

    expect(frontend).not.toContain("dummyUserId");
    expect(frontend).not.toContain("x-line-user-id");
    expect(frontend).toContain("window.liff.init({ liffId: config.liffId })");
  });
});
