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
    const verifyRequest = fetchMock.mock.calls[0][0] as URL;
    expect(verifyRequest.href).toBe(
      "https://api.line.me/oauth2/v2.1/verify?access_token=placeholder-token",
    );
    expect(fetchMock.mock.calls[0][1]).toBeUndefined();
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.line.me/v2/profile");
    expect(fetchMock.mock.calls[1][1]).toEqual({
      headers: { authorization: "Bearer placeholder-token" },
    });
  });

  it("fails closed without calling LINE for a blank bearer token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(new LineApiIdentityVerifier().verify({ token: "Bearer   " }))
      .resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
