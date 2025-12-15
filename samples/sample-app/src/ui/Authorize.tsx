import { useMemo } from "react";
  import { Link, useLocation, useNavigate } from "react-router-dom";
  import { parseAuthzRequestFromLocation, buildUrl } from "./shared";

  export function Authorize() {
    const loc = useLocation();
    const nav = useNavigate();

    const req = useMemo(() => {
      try {
        return parseAuthzRequestFromLocation(loc.search);
      } catch (e) {
        return null;
      }
    }, [loc.search]);

    if (!req) {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Authorize</h2>
          <p style={{ color: "crimson" }}>必要なクエリが足りません。Client Demo から入ってください。</p>
          <Link to="/client">→ Client Demo</Link>
        </div>
      );
    }

    const goLogin = () => {
      // 認可リクエストを login に引き回す（擬似）
      nav(buildUrl("/login", {
        client_id: req.client_id,
        redirect_uri: req.redirect_uri,
        state: req.state,
        code_challenge: req.code_challenge,
        code_challenge_method: req.code_challenge_method,
        scope: req.scope,
      }));
    };

    return (
      <div style={{ display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0 }}>/authorize</h2>
        <p>（擬似）認可リクエストを受信しました。ログイン画面へ進みます。</p>

        <pre style={{ padding: 12, background: "#f6f6f6", borderRadius: 8, overflowX: "auto" }}>
{JSON.stringify(req, null, 2)}
        </pre>

        <button onClick={goLogin} style={{ width: 220, padding: "8px 12px" }}>
          ログインへ
        </button>

        <p style={{ opacity: 0.7, fontSize: 12 }}>
          NOTE: ここではまだ state を検証しません（本来は client 側で検証）。このサンプルは、静的解析で「どこで何を検証すべきか」を見つける題材にしています。
        </p>
      </div>
    );
  }
