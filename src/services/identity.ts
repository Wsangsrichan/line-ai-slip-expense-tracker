export interface LineIdentityVerifier {
  verify(request: { token?: string; dummyUserId?: string }): Promise<string | null>;
}

export class DummyIdentityVerifier implements LineIdentityVerifier {
  async verify(request: { token?: string; dummyUserId?: string }) {
    return request.dummyUserId?.trim() || null;
  }
}

export class LineApiIdentityVerifier implements LineIdentityVerifier {
  async verify(request: { token?: string }) {
    if (!request.token) return null;
    const token = request.token.replace(/^Bearer /i, "");
    const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: token }),
    });
    if (!response.ok) return null;
    const profile = await fetch("https://api.line.me/v2/profile", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!profile.ok) return null;
    const payload = await profile.json() as { userId?: string };
    return payload.userId ?? null;
  }
}

export async function getLineUserId(
  verifier: LineIdentityVerifier,
  request: { token?: string; dummyUserId?: string },
) {
  return verifier.verify(request);
}
