import { afterEach, describe, expect, it, vi } from "vitest";
import { LineApiIdentityVerifier } from "../src/services/identity.js";

describe("LINE identity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("verifies the token then resolves the LINE profile user id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ client_id: "placeholder" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: "line-user" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new LineApiIdentityVerifier().verify({ token: "Bearer placeholder-token" }))
      .resolves.toBe("line-user");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
