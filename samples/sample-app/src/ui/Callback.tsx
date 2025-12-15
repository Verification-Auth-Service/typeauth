import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

function verifyState(received: string, expected: string) {
  if (received !== expected) throw new Error("state mismatch");
}

export function Callback() {
  const loc = useLocation();
  const sp = useMemo(() => new URLSearchParams(loc.search), [loc.search]);

  const code = sp.get("code") ?? "";
  const state = sp.get("state") ?? "";
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!code || !state) return;
      try {
        setStatus("idle");
        setError(null);

        // ---- (Client side) state validation ----
        const expected = sessionStorage.getItem("demo_state") ?? "";
        verifyState(state, expected);

        // ---- exchange code to access token (backchannel) ----
        const verifier = sessionStorage.getItem("demo_verifier") ?? "";
        const resp = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: "demo-client",
            code,
            redirect_uri: "/callback",
            code_verifier: verifier,
          }),
        });

        if (!resp.ok) {
          const t = await resp.text();
          throw new Error(`token failed: ${resp.status} ${t}`);
        }
        const token = (await resp.json()) as TokenResponse;

        sessionStorage.setItem("demo_access_token", token.access_token);
        sessionStorage.setItem("demo_scope", token.scope);

        setStatus("ok");
      } catch (e: any) {
        setStatus("error");
        setError(String(e?.message ?? e));
      }
    })();
  }, [code, state]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>/callback</h2>

      <div style={{ display: "grid", gap: 6 }}>
        <div>code: <code>{code || "(none)"}</code></div>
        <div>state: <code>{state || "(none)"}</code></div>
      </div>

      {status === "ok" && (
        <div style={{ padding: 12, background: "#eefcf0", borderRadius: 8 }}>
          ✅ トークン交換に成功しました
        </div>
      )}
      {status === "error" && (
        <div style={{ padding: 12, background: "#ffecec", borderRadius: 8 }}>
          ❌ 失敗: <span style={{ color: "crimson" }}>{error}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link to="/tokens">→ Tokens</Link>
        <Link to="/client">→ Client Demo</Link>
      </div>

      <p style={{ opacity: 0.7, fontSize: 12 }}>
        NOTE: ここは「state を検証してから token endpoint を呼ぶ」という安全な順序を持ちます。
        静的解析でこの依存を検出できるよう、関数名 <code>verifyState</code> を明示しています。
      </p>
    </div>
  );
}
