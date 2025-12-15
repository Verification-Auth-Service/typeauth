# React Router 認可サーバー（擬似）サンプル

OAuth2 Authorization Code + PKCE っぽいフローを、React Router の画面遷移で擬似再現する教材です。
静的解析（フロー抽出 / ルールチェック / テスト生成）の **対象プログラム** として使えるよう、意図的に分かりやすい関数名・構造にしています。

## 起動

```bash
npm i
npm run dev
```

- Client (Vite): http://localhost:5173
- API (Node): http://localhost:4000

Vite 側で `/api/*` を `localhost:4000` に proxy しています。

## 触り方

1. `http://localhost:5173/client` を開く
2. 「認可開始（/authorizeへ）」を押す
3. login → consent → redirect で `/callback` に戻る
4. `/api/token` に code_verifier を渡して access_token を取得

## ルート/エンドポイント

- `/authorize` (React Router page)
- `/login` (React Router page)
- `/consent` (React Router page)
- `/callback` (React Router page; **state 検証 → token exchange**)
- `POST /api/issue-code` (Node)
- `POST /api/token` (Node; **PKCE 検証**)

## 静的解析で狙えるチェック例

- `/callback` で `verifyState()` の呼び出しが `fetch("/api/token")` より前にあるか
- `redirect_uri` の一致検証が token endpoint にあるか
- PKCE S256 の検証があるか
- `state` を生成して保存しているか（`sessionStorage.setItem("demo_state", ...)`）

---
このサンプルは「分かりやすさ優先」なので、本番実装のセキュリティ要件をすべて満たすわけではありません。
