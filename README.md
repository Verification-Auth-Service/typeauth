# typeauth

## static-analyzer の実行方法

`apps/static-analyzer` は TypeScript/TSX の解析レポートを出力します。  
`-d` を付けるとディレクトリ形式で出力され、`model-checker/lispauth/*.lispauth` も生成されます。

### 役割別エントリ（client/resource）で実行

実入力例（現在使っているパス構成）:

```bash
pnpm --filter static-analyzer exec tsx src/index.ts -d \
  --client-entry {ディレクトリ}sample-auth-app/apps/auth-app/app/root.tsx \
  --resource-entry {ディレクトリ}sample-auth-app/apps/resource-server/app/routes.ts
```

### 一本道遷移の短縮出力オプション

- 既定（短縮あり）: `--compact-linear-transitions`
- 短縮なし（`event` を展開して出力）: `--no-compact-linear-transitions`

短縮なしの実行例:

```bash
pnpm --filter static-analyzer exec tsx src/index.ts -d --no-compact-linear-transitions \
  --client-entry {ディレクトリ}sample-auth-app/apps/auth-app/app/root.tsx \
  --resource-entry {ディレクトリ}sample-auth-app/apps/resource-server/app/routes.ts
```

### 出力先

出力先を省略した場合は `report/` が作成されます。  
任意ディレクトリを指定する場合はコマンド末尾に `[output]` を追加します。
