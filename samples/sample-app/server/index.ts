import http from "node:http";
import { randomUUID } from "node:crypto";

type IssueCodeBody = {
  client_id: string;
  redirect_uri: string;
  username: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: "S256" | "plain";
};

type TokenBody = {
  grant_type: "authorization_code";
  client_id: string;
  code: string;
  redirect_uri: string;
  code_verifier: string;
};

type CodeRecord = {
  client_id: string;
  redirect_uri: string;
  username: string;
  scope: string;
  code_challenge: string;
  code_challenge_method: "S256" | "plain";
  issued_at: number;
  used: boolean;
};

const codes = new Map<string, CodeRecord>();

function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function sendText(res: http.ServerResponse, status: number, text: string) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

async function readJson(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}

// --- PKCE S256 verify ---
async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function verifyPkceS256(codeVerifier: string, expectedChallenge: string) {
  const actual = await sha256Base64Url(codeVerifier);
  if (actual !== expectedChallenge) throw new Error("pkce mismatch");
}

const server = http.createServer(async (req, res) => {
  // very small router
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/issue-code") {
    const body = (await readJson(req)) as IssueCodeBody;

    // (Demo) minimal validation
    if (!body.client_id || !body.redirect_uri || !body.username) {
      sendText(res, 400, "missing fields");
      return;
    }

    const code = randomUUID().replace(/-/g, "");
    codes.set(code, {
      client_id: body.client_id,
      redirect_uri: body.redirect_uri,
      username: body.username,
      scope: body.scope ?? "openid profile",
      code_challenge: body.code_challenge,
      code_challenge_method: body.code_challenge_method ?? "S256",
      issued_at: Date.now(),
      used: false,
    });

    sendJson(res, 200, { code });
    return;
  }

  if (req.method === "POST" && pathname === "/api/token") {
    try {
      const body = (await readJson(req)) as TokenBody;

      if (body.grant_type !== "authorization_code") {
        sendText(res, 400, "unsupported grant_type");
        return;
      }

      const rec = codes.get(body.code);
      if (!rec) {
        sendText(res, 400, "invalid code");
        return;
      }
      if (rec.used) {
        sendText(res, 400, "code already used");
        return;
      }

      // redirect_uri / client_id matching
      if (rec.client_id !== body.client_id) {
        sendText(res, 400, "client_id mismatch");
        return;
      }
      if (rec.redirect_uri !== body.redirect_uri) {
        sendText(res, 400, "redirect_uri mismatch");
        return;
      }

      // PKCE verify
      if (rec.code_challenge_method === "S256") {
        await verifyPkceS256(body.code_verifier, rec.code_challenge);
      } else {
        if (body.code_verifier !== rec.code_challenge) throw new Error("pkce mismatch");
      }

      // consume code
      rec.used = true;
      codes.set(body.code, rec);

      // issue access token (demo)
      const access_token = "at_" + randomUUID().replace(/-/g, "");

      sendJson(res, 200, {
        access_token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: rec.scope,
      });
    } catch (e: any) {
      sendText(res, 400, String(e?.message ?? e));
    }
    return;
  }

  sendText(res, 404, "not found");
});

server.listen(4000, () => {
  console.log("[server] listening on http://localhost:4000");
});
