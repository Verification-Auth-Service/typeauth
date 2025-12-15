import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { parseAuthzRequestFromLocation, buildUrl, mustGetQuery } from "./shared";

type IssueCodeResponse = { code: string };

export function Consent() {
  const loc = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const req = useMemo(() => {
    try {
      return parseAuthzRequestFromLocation(loc.search);
    } catch {
      return null;
    }
  }, [loc.search]);

  const username = useMemo(() => {
    const sp = new URLSearchParams(loc.search);
    try {
      return mustGetQuery(sp, "username");
    } catch {
      return null;
    }
  }, [loc.search]);

  if (!req || !username) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0 }}>/consent</h2>
        <p style={{ color: "crimson" }}>クエリが足りません。</p>
        <Link to="/client">→ Client Demo</Link>
      </div>
    );
  }

  async function approveAndRedirect() {
    setBusy(true);
    setError(null);
    try {
      // code を発行（サーバ側に保存）
      const resp = await fetch("/api/issue-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: req.client_id,
          redirect_uri: req.redirect_uri,
          username,
          scope: req.scope,
          code_challenge: req.code_challenge,
          code_challenge_method: req.code_challenge_method ?? "S256",
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`issue-code failed: ${resp.status} ${t}`);
      }
      const data = (await resp.json()) as IssueCodeResponse;

      // ここが「認可サーバー→クライアント」への redirect（擬似）
      // code と state を redirect_uri に付けて返す
      const redirectTo = buildUrl(req.redirect_uri, {
        code: data.code,
        state: req.state,
      });

      window.location.assign(redirectTo);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>/consent</h2>
      <p>
        ユーザー <b>{username}</b> として、クライアント <code>{req.client_id}</code> に
        <code>{req.scope}</code> を許可しますか？
      </p>

      <div style={{ display: "flex", gap: 10 }}>
        <button disabled={busy} onClick={approveAndRedirect} style={{ width: 220, padding: "8px 12px" }}>
          {busy ? "処理中…" : "許可してリダイレクト"}
        </button>
        <Link to="/client">キャンセル</Link>
      </div>

      {error && <div style={{ color: "crimson" }}>{error}</div>}

      <p style={{ opacity: 0.7, fontSize: 12 }}>
        NOTE: 本来の実装では redirect_uri の厳密な検証などが必要。静的解析のルールとして追加しやすいポイントです。
      </p>
    </div>
  );
}
