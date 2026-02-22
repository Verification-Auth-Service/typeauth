import { Location, TypeInfo, SymbolInfo } from "./tree";

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
export type PEvent =
  | {
      // `if (...) { ... }`
      kind: "if";
      loc: Location;
      // 条件式のソース文字列 (例: `x > 0`)
      test: string;
      // 条件式の型情報 (取得できる場合)
      testType?: TypeInfo;
    }
  | {
      // `switch (expr) { ... }`
      kind: "switch";
      loc: Location;
      // switch の判定対象式 (例: `status`)
      expr: string;
      exprType?: TypeInfo;
    }
  | {
      // `for / for-in / for-of / while / do-while`
      kind: "loop";
      loc: Location;
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
  | { kind: "try"; loc: Location }
  | {
      // `catch (e) { ... }`
      kind: "catch";
      loc: Location;
      // catch 変数名。`catch {}` の場合は undefined
      param?: string;
      paramType?: TypeInfo;
    }
  | { kind: "finally"; loc: Location }
  | {
      kind: "return";
      loc: Location;
      // `return;` のような式なし return のときは undefined
      expr?: string;
      exprType?: TypeInfo;
    }
  | {
      kind: "throw";
      loc: Location;
      // 例: `new Error("x")`
      expr: string;
      exprType?: TypeInfo;
    }
  | {
      kind: "await";
      loc: Location;
      // await している式本体 (例: `fetch(url)`)
      expr: string;
      // await 後の型 (実装側では await 式ノード全体の型を入れる)
      exprType?: TypeInfo;
    }
  | {
      // 関数/メソッド/コンストラクタ呼び出し
      kind: "call";
      loc: Location;
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
      loc: Location;
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
      loc: Location;
      label: string;
    }
  | {
      // 構造イベント: ブロック終了
      kind: "blockExit";
      loc: Location;
      label: string;
    };
