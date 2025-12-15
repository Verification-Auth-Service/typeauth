import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { randomString, sha256Base64Url, buildUrl } from "./shared";

export function ClientDemo() {
  const [state, setState] = useState<string>("");
  const [verifier, setVerifier] = useState<string>("");
  const [challenge, setChallenge] = useState<string>("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const st = randomString(16);
      const v = randomString(48);
      const ch = await sha256Base64Url(v);
      setState(st);
      setVerifier(v);
      setChallenge(ch);

      // sessionStorage に保存（callback で state 検証に使う）
      sessionStorage.setItem("demo_state", st);
      sessionStorage.setItem("demo_verifier", v);
      setReady(true);
    })();
  }, []);

  const authorizeUrl = useMemo(() => {
    if (!ready) return "";
    return buildUrl("/authorize", {
      client_id: "demo-client",
      redirect_uri: "/callback",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "openid profile",
    });
  }, [ready, state, challenge]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Client Demo</h2>
      <p>
        ここは “クライアントアプリ” 側の擬似ページです。<code>/authorize</code> に飛ばして認可フローを開始します。
      </p>

      <div style={{ display: "grid", gap: 8 }}>
        <div><b>state</b>: <code>{state}</code></div>
        <div><b>code_verifier</b>: <code style={{ wordBreak: "break-all" }}>{verifier}</code></div>
        <div><b>code_challenge</b>: <code style={{ wordBreak: "break-all" }}>{challenge}</code></div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a href={authorizeUrl} style={{ pointerEvents: ready ? "auto" : "none", opacity: ready ? 1 : 0.5 }}>
          → 認可開始（/authorize へ）
        </a>
        <Link to="/tokens">→ Tokens</Link>
      </div>

      <p style={{ opacity: 0.7, fontSize: 12 }}>
        NOTE: callback で state を検証します。静的解析の教材として “state 検証がないと危険” を分かりやすくできます。
      </p>
    </div>
  );
}
