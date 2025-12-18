export const ISSUER = "http://localhost:8787";
export const AUDIENCE = "demo-client";

/**
 * 開発用の固定シークレット（HS256）。
 * 本番では絶対に固定せず、適切な鍵管理（KMS / JWKS / rotate）を行ってください。
 */
export const DEV_HS256_SECRET = "dev-secret-change-me-please-32bytes-min";

export const AUTH_SERVER_BASE = "http://localhost:8787";
export const RESOURCE_SERVER_BASE = "http://localhost:8788";

export const REGISTERED_REDIRECT_URI = "http://localhost:5173/auth/callback";
