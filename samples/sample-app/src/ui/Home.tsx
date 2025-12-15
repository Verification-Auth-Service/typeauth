import { Link } from "react-router-dom";

export function Home() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p>
        これは <b>OAuth2 Authorization Code + PKCE</b> っぽい流れを、React Router の画面遷移で擬似再現するサンプルです。
        静的解析・テスト生成の “対象プログラム” として使えるように、わざと分かりやすい関数名で実装しています。
      </p>

      <ul style={{ lineHeight: 1.8 }}>
        <li>
          認可開始: <code>/authorize</code>（クエリで <code>client_id</code>, <code>redirect_uri</code>, <code>state</code>, <code>code_challenge</code> を受け取る）
        </li>
        <li>
          ログイン: <code>/login</code>
        </li>
        <li>
          同意: <code>/consent</code>（ここで code を発行して redirect）
        </li>
        <li>
          トークン交換: <code>POST /api/token</code>（Node側。PKCE verifier を検証）
        </li>
      </ul>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link to="/client">→ Client Demo を開く</Link>
        <Link to="/debug">→ Debug を開く</Link>
      </div>
    </div>
  );
}
