import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import { z } from "zod";
import { SignJWT } from "jose";
import {
  ISSUER,
  AUDIENCE,
  DEV_HS256_SECRET,
  REGISTERED_REDIRECT_URI,
} from "@typeauth/shared";

const PORT = Number(process.env.PORT ?? 8787);

/**
 * ===== Client Registry (最小) =====
 * 本来はDB/管理画面で client_id, redirect_uri, secret, allowed scopes を管理する。
 * DBまで作ってしまうと面倒なので、いったんべた書き
 */
type Client = {
  clientId: string;
  redirectUris: string[];
  allowedScopes: string[];
};

const clients: Record<string, Client> = {
  "demo-client": {
    clientId: "demo-client",
    redirectUris: [REGISTERED_REDIRECT_URI],
    allowedScopes: ["read", "write", "profile"],
  },
};

type AuthCodeRecord = {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string; // space-separated
  // PKCE
  codeChallenge: string;
  codeChallengeMethod: "S256";
  // user
  sub: string;
  expiresAt: number;
  used: boolean;
};

const authCodes = new Map<string, AuthCodeRecord>();

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  scope: z.string().optional().default(""),
  state: z.string().min(1),
  code_challenge: z.string().min(10),
  code_challenge_method: z.literal("S256"),
});

const tokenBodySchema = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
  code_verifier: z.string().min(10),
});

function nowMs() {
  return Date.now();
}
function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
function sha256Base64Url(input: string) {
  return crypto.createHash("sha256").update(input).digest("base64url");
}
function normalizeScope(scope: string) {
  return scope
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}
function intersectScopes(requested: string[], allowed: string[]) {
  const allowedSet = new Set(allowed);
  return requested.filter((s) => allowedSet.has(s));
}

async function signAccessToken(params: { sub: string; scope: string; aud: string }) {
  const secret = new TextEncoder().encode(DEV_HS256_SECRET);
  return new SignJWT({ scope: params.scope })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(params.aud)
    .setSubject(params.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// dev: allow client to call token endpoint cross-origin
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * GET /oauth/authorize
 * - response_type=code
 * - client_id, redirect_uri チェック
 * - state そのまま戻す
 * - PKCE (S256) を保存
 *
 * NOTE: 本来はここでログイン画面/同意画面。
 * ここでは「既にログイン済み」として固定ユーザ sub を使う。
 */
app.get("/oauth/authorize", (req, res) => {
  const parsed = authorizeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
  }
  const q = parsed.data;

  const client = clients[q.client_id];
  if (!client) return res.status(400).json({ error: "unauthorized_client" });
  if (!client.redirectUris.includes(q.redirect_uri)) {
    return res.status(400).json({ error: "invalid_redirect_uri" });
  }

  const requested = q.scope ? q.scope.split(/\s+/).filter(Boolean) : [];
  const granted = intersectScopes(requested, client.allowedScopes);
  const scope = normalizeScope(granted.join(" "));

  const sub = "user-123"; // demo user
  const code = randomBase64Url(32);
  authCodes.set(code, {
    code,
    clientId: q.client_id,
    redirectUri: q.redirect_uri,
    scope,
    codeChallenge: q.code_challenge,
    codeChallengeMethod: "S256",
    sub,
    expiresAt: nowMs() + 5 * 60 * 1000,
    used: false,
  });

  const redirect = new URL(q.redirect_uri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", q.state);

  return res.redirect(302, redirect.toString());
});

/**
 * POST /oauth/token
 * - grant_type=authorization_code
 * - code, redirect_uri, client_id
 * - PKCE verifier を S256 で検証
 * - JWT access_token 発行
 */
app.post("/oauth/token", async (req, res) => {
  const parsed = tokenBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request", details: parsed.error.flatten() });
  }
  const body = parsed.data;

  const client = clients[body.client_id];
  if (!client) return res.status(400).json({ error: "unauthorized_client" });

  const rec = authCodes.get(body.code);
  if (!rec) return res.status(400).json({ error: "invalid_grant", error_description: "Unknown code" });
  if (rec.used) return res.status(400).json({ error: "invalid_grant", error_description: "Code already used" });
  if (rec.expiresAt < nowMs()) return res.status(400).json({ error: "invalid_grant", error_description: "Code expired" });
  if (rec.clientId !== body.client_id) return res.status(400).json({ error: "invalid_grant", error_description: "Client mismatch" });
  if (rec.redirectUri !== body.redirect_uri) return res.status(400).json({ error: "invalid_grant", error_description: "Redirect URI mismatch" });

  const actualChallenge = sha256Base64Url(body.code_verifier);
  if (actualChallenge !== rec.codeChallenge) {
    return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
  }

  rec.used = true;
  authCodes.set(rec.code, rec);

  const accessToken = await signAccessToken({
    sub: rec.sub,
    scope: rec.scope,
    aud: AUDIENCE,
  });

  return res.json({
    token_type: "Bearer",
    access_token: accessToken,
    expires_in: 15 * 60,
    scope: rec.scope,
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Auth Server: http://localhost:${PORT}`);
  console.log(`  GET  /oauth/authorize`);
  console.log(`  POST /oauth/token`);
});
