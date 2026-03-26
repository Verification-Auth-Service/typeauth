import { Location, TypeInfo, SymbolInfo } from "./tree";

type PEventCommon = {
  loc: Location;
  // 該当イベントに対応する元の構文文字列 (`node.getText()` ベース)
  syntax?: string;
};

/**
 * 静的解析で抽出する「プログラムイベント」の列。
 *
 * 目的:
 * - 関数本体を AST 走査して、制御構文/呼び出し/return などを時系列っぽく並べる
 * - 後段で「どこで何をしているか」を JSON として読みやすくする
 *
 * 注意:
 * - これは AST の完全な再表現ではなく、分析用に要約したイベントモデル
 * - `*Type` / `resolved` は型解決できたときだけ入る (optional)
 */
export type PEvent = (
  | {
      // `if (...) { ... }`
      kind: "if";
      // 条件式のソース文字列 (例: `x > 0`)
      test: string;
      // 条件式の型情報 (取得できる場合)
      testType?: TypeInfo;
    }
  | {
      // `switch (expr) { ... }`
      kind: "switch";
      // switch の判定対象式 (例: `status`)
      expr: string;
      exprType?: TypeInfo;
    }
  | {
      // `for / for-in / for-of / while / do-while`
      kind: "loop";
      // ループの種類
      loopKind: "for" | "forIn" | "forOf" | "while" | "do";
      /**
       * ループの「見出し」に相当する文字列。
       *
       * 用途:
       * - JSON レポートで、ループの条件や反復対象をざっと読めるようにする
       * - 厳密な構文情報ではなく、人間向けの要約文字列
       *
       * 例:
       * - `for (let i = 0; i < 5; i++) { ... }`
       *    -> `for (let i = 0; i < 5; i++) `
       * - `for (const x of items) { ... }`
       *    -> `for (const x of items) `
       * - `while (ready) { ... }`
       *    -> `ready`   (while/do は条件式だけを入れている)
       */
      header: string;
    }
  | { kind: "try" }
  | {
      // `catch (e) { ... }`
      kind: "catch";
      // catch 変数名。`catch {}` の場合は undefined
      param?: string;
      paramType?: TypeInfo;
    }
  | { kind: "finally" }
  | {
      kind: "return";
      // `return;` のような式なし return のときは undefined
      expr?: string;
      exprType?: TypeInfo;
    }
  | {
      kind: "throw";
      // 例: `new Error("x")`
      expr: string;
      exprType?: TypeInfo;
    }
  | {
      kind: "await";
      // await している式本体 (例: `fetch(url)`)
      expr: string;
      // await 後の型 (実装側では await 式ノード全体の型を入れる)
      exprType?: TypeInfo;
    }
  | {
      // Auth アプリで頻出のリダイレクト操作
      // 例:
      // - `return redirect("/login")`
      // - `navigate("/callback")`
      // - `router.push("/home")`
      // - `window.location.href = "/login"`
      kind: "redirect";
      // どの形でリダイレクトしたか
      via: "call" | "assign";
      // API / 左辺の識別子 (例: `redirect`, `router.push`, `window.location.href`)
      api: string;
      // 遷移先っぽい式。特定できた場合のみ
      target?: string;
      targetType?: TypeInfo;
      // `redirect(url, options)` の第2引数など、付随オプションの元構文
      options?: string;
      // `headers: { ... }` があればキー一覧を抽出 (例: ["Set-Cookie"])
      headerKeys?: string[];
    }
  | {
      // `url.searchParams.set("k", v)` のような URL クエリ構築
      // OAuth/OIDC の authorize URL 組み立てで頻出。
      kind: "urlParamSet";
      // ベース URL オブジェクトの式 (例: `authorizeUrl`)
      urlExpr: string;
      // 第1引数 (キー)
      key: string;
      keyType?: TypeInfo;
      // 第2引数 (値)
      value?: string;
      valueType?: TypeInfo;
    }
  | {
      // セッションへの入出力操作
      // 例:
      // - `session.set("oauth:state", state)`
      // - `session.get("oauth:state")`
      // - `await getSession(request)`
      // - `await commitSession(session)`
      kind: "sessionOp";
      operation: "load" | "commit" | "destroy" | "get" | "set" | "unset" | "flash" | "has";
      // 検出した API (例: `session.set`, `getSession`)
      api: string;
      // メソッド呼び出し時のセッション式 (例: `session`)
      sessionExpr?: string;
      key?: string;
      keyType?: TypeInfo;
      value?: string;
      valueType?: TypeInfo;
    }
  | {
      // DB アクセス操作 (Prisma / db client / repository などの呼び出し)
      // 例:
      // - `prisma.user.findUnique(...)`
      // - `prisma.oAuthAccount.upsert(...)`
      kind: "dbOp";
      operation: "read" | "write" | "other";
      // 検出した API (例: `prisma.user.findUnique`)
      api: string;
      method: string;
      // DB クライアント側の式 (例: `prisma.user`)
      clientExpr: string;
      // Prisma 形式で model 名が取れる場合のみ
      model?: string;
      args: { text: string; type?: TypeInfo }[];
    }
  | {
      // フォーム入出力操作
      // 例:
      // - `await request.formData()`
      // - `formData.get("client_id")`
      kind: "formOp";
      operation: "load" | "get" | "getAll" | "set" | "append" | "has" | "delete";
      // 検出した API (例: `request.formData`, `formData.get`)
      api: string;
      formExpr?: string;
      field?: string;
      fieldType?: TypeInfo;
      value?: string;
      valueType?: TypeInfo;
    }
  | {
      // 関数/メソッド/コンストラクタ呼び出し
      kind: "call";
      // 呼び出し先のソース文字列 (例: `console.log`, `service.run`)
      callee: string;
      calleeType?: TypeInfo;
      resolved?: SymbolInfo; // 可能なら呼び出し先シンボル
      // 引数の文字列と型情報を並べる。順序は呼び出し時の順序を維持する。
      args: { text: string; type?: TypeInfo }[];
    }
  | {
      // クラス/コンストラクタ呼び出し
      kind: "new";
      // `new` の直後にある式 (例: `Error`, `MyClass`)
      classExpr: string;
      classType?: TypeInfo;
      resolved?: SymbolInfo;
      args: { text: string; type?: TypeInfo }[];
    }
  | {
      // 構造イベント: ブロック開始
      // 例: `then`, `else`, `for`, `try`, `body`
      kind: "blockEnter";
      label: string;
    }
  | {
      // 構造イベント: ブロック終了
      kind: "blockExit";
      label: string;
    }
) &
  PEventCommon;
