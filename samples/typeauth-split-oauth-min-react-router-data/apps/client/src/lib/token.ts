import { AUTH_SERVER_BASE, REGISTERED_REDIRECT_URI, AUDIENCE } from "@typeauth/shared";

export type TokenResponse =
  | { ok: true; access_token: string; token_type: string; expires_in: number; scope: string }
  | { ok: false; error: string; error_description?: string; raw?: unknown };

export async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", REGISTERED_REDIRECT_URI);
  body.set("client_id", AUDIENCE);
  body.set("code_verifier", codeVerifier);

  const res = await fetch(AUTH_SERVER_BASE + "/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: json?.error ?? "token_error", error_description: json?.error_description, raw: json };
  }
  return { ok: true, ...json };
}
