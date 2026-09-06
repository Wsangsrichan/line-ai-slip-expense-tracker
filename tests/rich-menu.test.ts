import { describe, expect, it, vi } from "vitest";
import { LineRichMenuClient, createRichMenuDefinition, validateRichMenuConfig } from "../src/services/rich-menu.js";

describe("LINE Rich Menu", () => {
  it("defines exactly three safe LIFF actions", () => {
    const menu = createRichMenuDefinition("https://liff.example/123?foo=bar");
    const actions = menu.areas.map((area) => area.action);

    expect(actions.map((action) => action.label)).toEqual(["เพิ่มสลิป", "Dashboard", "ประวัติรายการ"]);
    expect(actions.map((action) => action.uri)).toEqual([
      "https://liff.example/123?foo=bar&view=upload",
      "https://liff.example/123?foo=bar&view=dashboard",
      "https://liff.example/123?foo=bar&view=history",
    ]);
  });

  it("rejects non-HTTPS or missing LIFF configuration", () => {
    expect(() => validateRichMenuConfig({ liffUrl: "http://liff.example/123", accessToken: "token" })).toThrow();
    expect(() => validateRichMenuConfig({ liffUrl: "https://liff.example/123", accessToken: "" })).toThrow();
  });

  it("uses the LINE Rich Menu API without exposing the access token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ richmenus: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ richMenuId: "richmenu-id" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = new LineRichMenuClient("server-access-token", fetchMock);

    const result = await client.ensureDefault(createRichMenuDefinition("https://liff.example/123"), Buffer.from("png"), "image/png");

    expect(result).toBe("richmenu-id");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(fetchMock.mock.calls.slice(1).map((call) => call[1]?.body ?? null))).not.toContain("server-access-token");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer server-access-token");
    expect(fetchMock.mock.calls[2][0]).toBe("https://api-data.line.me/v2/bot/richmenu/richmenu-id/content");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.line.me/v2/bot/richmenu/list");
  });

  it("reuses a menu with the stable name instead of creating duplicates", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ richmenus: [{ richMenuId: "existing-id", name: "LINE Slip Tracker" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const id = await new LineRichMenuClient("server-access-token", fetchMock)
      .ensureDefault(createRichMenuDefinition("https://liff.example/123"), Buffer.from("png"), "image/png");

    expect(id).toBe("existing-id");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("/existing-id/content");
  });
});
