const LINE_API_BASE = "https://api.line.me";
const LINE_CONTENT_API_BASE = "https://api-data.line.me";

export interface RichMenuAction {
  type: "uri";
  label: string;
  uri: string;
}

export interface RichMenuDefinition {
  size: { width: 2500; height: 843 };
  selected: true;
  name: string;
  chatBarText: string;
  areas: Array<{
    bounds: { x: number; y: number; width: number; height: number };
    action: RichMenuAction;
  }>;
}

export function validateRichMenuConfig(config: { liffUrl?: string; accessToken?: string }) {
  if (!config.accessToken) throw new Error("LINE Rich Menu configuration is incomplete");
  validateLiffUrl(config.liffUrl);
  return { liffUrl: config.liffUrl as string, accessToken: config.accessToken };
}

export function createRichMenuDefinition(liffUrl: string): RichMenuDefinition {
  const baseUrl = validateLiffUrl(liffUrl);
  const action = (label: string, view: string): RichMenuAction => {
    const uri = new URL(baseUrl);
    uri.searchParams.set("view", view);
    return { type: "uri", label, uri: uri.toString() };
  };
  return {
    size: { width: 2500, height: 843 },
    selected: true,
    name: "LINE Slip Tracker",
    chatBarText: "เมนูหลัก",
    areas: [
      { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: action("เพิ่มสลิป", "upload") },
      { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: action("Dashboard", "dashboard") },
      { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: action("ประวัติรายการ", "history") },
    ],
  };
}

export class LineRichMenuClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = LINE_API_BASE,
    private readonly contentBaseUrl = LINE_CONTENT_API_BASE,
  ) {}

  async ensureDefault(definition: RichMenuDefinition, image: Buffer, imageType: "image/png" | "image/jpeg") {
    const existing = await this.list();
    const match = existing.find((menu) => menu.name === definition.name);
    const richMenuId = match?.richMenuId ?? await this.create(definition);
    await this.uploadImage(richMenuId, image, imageType);
    await this.setDefault(richMenuId);
    return richMenuId;
  }

  private async list(): Promise<Array<{ richMenuId: string; name: string }>> {
    const payload = await this.request("/v2/bot/richmenu/list");
    if (!isRecord(payload) || !Array.isArray(payload.richmenus)) return [];
    return payload.richmenus.filter(isRichMenuSummary);
  }

  private async create(definition: RichMenuDefinition) {
    const payload = await this.request("/v2/bot/richmenu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(definition),
    });
    if (!isRecord(payload) || typeof payload.richMenuId !== "string") throw new Error("LINE Rich Menu creation failed");
    return payload.richMenuId;
  }

  private async uploadImage(richMenuId: string, image: Buffer, imageType: "image/png" | "image/jpeg") {
    await this.request(`/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`, {
      method: "POST",
      headers: { "content-type": imageType },
      body: new Uint8Array(image),
    }, "content", this.contentBaseUrl);
  }

  private async setDefault(richMenuId: string) {
    await this.request(`/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`, { method: "POST" });
  }

  private async request(path: string, init: RequestInit = {}, mode: "json" | "content" = "json", baseUrl = this.baseUrl) {
    const response = await this.fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`LINE Rich Menu request failed (${response.status})`);
    if (mode === "content" || response.status === 204) return {};
    try { return await response.json() as unknown; } catch { return {}; }
  }
}

function validateLiffUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error("LINE Rich Menu LIFF URL must be HTTPS");
  }
}

function isRichMenuSummary(value: unknown): value is { richMenuId: string; name: string } {
  return isRecord(value) && typeof value.richMenuId === "string" && typeof value.name === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
