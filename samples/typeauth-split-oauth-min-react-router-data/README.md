# typeauth-split-oauth-min

認可サーバー / リソースサーバー / クライアント を分離した最小サンプル（Authorization Code + PKCE）。

**注意:** これは学習・検証用の最小構成です。鍵管理・セキュリティ要件・クライアント登録・ログインUI等は本番相当ではありません。

## 構成

- `apps/auth-server` : Authorization Server
  - `GET /oauth/authorize` (code発行して redirect_uri に返す)
  - `POST /oauth/token` (code -> access_token, PKCE検証)
- `apps/resource-server` : Resource Server
  - `GET /api/me` (Bearer JWT を検証してユーザ情報を返す)
- `apps/client` : React + Vite + React Router
  - ログイン開始 -> callback -> token交換 -> API呼び出し

共有値（issuer/secret等）は `packages/shared` に置いています。

## 起動

```bash
pnpm install
pnpm dev
```

- Client: http://localhost:5173
- Auth Server: http://localhost:8787
- Resource Server: http://localhost:8788

## 動作

1. Clientで **Login (PKCE)** を押す
2. Auth Server にリダイレクト → code をつけて callback に戻る
3. Client が Token Endpoint で code を交換して access_token を取得
4. **Call /api/me** を押すと Resource Server が JWT を検証してレスポンス

## ポート変更

各アプリの `.env` で可能（既定値が入っています）。
