export type AuthzRequest = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method?: "S256" | "plain";
  scope?: string;
};

export function mustGetQuery(searchParams: URLSearchParams, key: string): string {
  const v = searchParams.get(key);
  if (!v) throw new Error(`missing query param: ${key}`);
  return v;
}

export function parseAuthzRequestFromLocation(search: string): AuthzRequest {
  const sp = new URLSearchParams(search);
  return {
    client_id: mustGetQuery(sp, "client_id"),
    redirect_uri: mustGetQuery(sp, "redirect_uri"),
    state: mustGetQuery(sp, "state"),
    code_challenge: mustGetQuery(sp, "code_challenge"),
    code_challenge_method: (sp.get("code_challenge_method") as any) ?? "S256",
    scope: sp.get("scope") ?? "openid profile",
  };
}

export function buildUrl(base: string, query: Record<string, string | undefined>) {
  const u = new URL(base, window.location.origin);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return u.toString();
}

export function randomString(len = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// PKCE helper (S256)
export async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
