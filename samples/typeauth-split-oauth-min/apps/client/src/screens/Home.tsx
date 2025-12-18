import React, { useMemo, useState } from "react";
import { startLogin } from "../lib/oauth";
import { clearToken, loadToken } from "../lib/storage";
import { fetchMe } from "../lib/resource";

export function Home() {
  const [me, setMe] = useState<any>(null);
  const token = useMemo(() => loadToken(), []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <h1>typeauth split oauth min</h1>
      <p>Authorization Server / Resource Server / Client を分離した最小サンプル。</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button onClick={() => startLogin()}>Login (PKCE)</button>
        <button
          onClick={async () => {
            const t = loadToken();
            if (!t) return alert("No token. Login first.");
            const r = await fetchMe(t);
            setMe(r);
          }}
        >
          Call /api/me
        </button>
        <button
          onClick={() => {
            clearToken();
            setMe(null);
            window.location.reload();
          }}
        >
          Clear token
        </button>
      </div>

      <div style={{ marginTop: 18 }}>
        <h3>Current token</h3>
        <pre style={{ background: "#f6f6f6", padding: 12, overflowX: "auto" }}>
          {token ?? "(none)"}
        </pre>
      </div>

      <div style={{ marginTop: 18 }}>
        <h3>Response</h3>
        <pre style={{ background: "#f6f6f6", padding: 12, overflowX: "auto" }}>
          {me ? JSON.stringify(me, null, 2) : "(none)"}
        </pre>
      </div>
    </div>
  );
}
