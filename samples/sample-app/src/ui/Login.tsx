import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { parseAuthzRequestFromLocation, buildUrl } from "./shared";

export function Login() {
  const loc = useLocation();
  const nav = useNavigate();
  const [username, setUsername] = useState("alice");

  const req = useMemo(() => {
    try {
      return parseAuthzRequestFromLocation(loc.search);
    } catch {
      return null;
    }
  }, [loc.search]);

  if (!req) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>/login</h2>
        <p style={{ color: "crimson" }}>クエリが足りません。</p>
        <Link to="/client">→ Client Demo</Link>
      </div>
    );
  }

  const submitLogin = () => {
    // 本物ならセッション確立など。ここでは username を query に載せて続行（擬似）
    nav(buildUrl("/consent", {
      ...req,
      username,
    }));
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>/login</h2>
      <label style={{ display: "grid", gap: 6, maxWidth: 360 }}>
        Username（擬似）
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <button onClick={submitLogin} style={{ width: 220, padding: "8px 12px" }}>
        ログイン（擬似）
      </button>

      <p style={{ opacity: 0.7, fontSize: 12 }}>
        NOTE: ここでは password 等は扱いません。認可フローの構造が見えるように単純化しています。
      </p>
    </div>
  );
}
