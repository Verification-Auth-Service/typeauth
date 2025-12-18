import express from "express";
import { jwtVerify } from "jose";
import { ISSUER, AUDIENCE, DEV_HS256_SECRET } from "@typeauth/shared";

const PORT = Number(process.env.PORT ?? 8788);
const app = express();

app.use(express.json());

// dev CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5173");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function getBearer(req: express.Request): string | null {
  const h = req.header("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1] ?? null;
}

app.get("/api/me", async (req, res) => {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: "missing_token" });

  try {
    const secret = new TextEncoder().encode(DEV_HS256_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    return res.json({
      sub: payload.sub,
      scope: payload.scope,
      iss: payload.iss,
      aud: payload.aud,
      iat: payload.iat,
      exp: payload.exp,
    });
  } catch (e) {
    return res.status(401).json({ error: "invalid_token" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Resource Server: http://localhost:${PORT}`);
  console.log(`  GET /api/me`);
});
