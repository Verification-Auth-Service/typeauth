import React from "react";
import { Link } from "react-router-dom";
import { clearToken, loadToken } from "../lib/storage";

export function Home() {
  const token = loadToken();

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <h1>typeauth split oauth min (React Router Data Router)</h1>
      <p>
        認可サーバー / リソースサーバー / クライアントを分離し、<b>React Router の loader</b> で OAuth
        の状態遷移を表現した最小サンプル（Auth Code + PKCE）。
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <Link to="/auth/start"><button>Login (PKCE) via loader</button></Link>
        <Link to="/authed"><button>Go /authed (require TokenPresent)</button></Link>
        <button onClick={() => { clearToken(); window.location.reload(); }}>Clear token</button>
      </div>

      <div style={{ marginTop: 18 }}>
        <h3>Current token (sessionStorage)</h3>
        <pre style={{ background: "#f6f6f6", padding: 12, overflowX: "auto" }}>
          {token ?? "(none)"}
        </pre>
      </div>

      <div style={{ marginTop: 18, fontSize: 14, opacity: 0.9 }}>
        <p><b>Flow</b>: /auth/start (loader) → Auth Server → /auth/callback (loader) → /authed (loader)</p>
      </div>
    </div>
  );
}
