import { useMemo } from "react";
import { Link } from "react-router-dom";

export function Tokens() {
  const accessToken = useMemo(() => sessionStorage.getItem("demo_access_token") ?? "", []);
  const scope = useMemo(() => sessionStorage.getItem("demo_scope") ?? "", []);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Tokens</h2>
      <div>access_token: <code style={{ wordBreak: "break-all" }}>{accessToken || "(none)"}</code></div>
      <div>scope: <code>{scope || "(none)"}</code></div>

      <div style={{ display: "flex", gap: 12 }}>
        <Link to="/client">→ Client Demo</Link>
        <Link to="/debug">→ Debug</Link>
      </div>
    </div>
  );
}
