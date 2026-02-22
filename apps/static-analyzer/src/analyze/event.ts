import ts from "typescript";
import { PEvent } from "../types/event";
import { locOf } from "../helper/locOf";
import { typeInfo } from "../helper/type";
import { symbolInfo } from "../helper/symbol";

/**
 * “フロー抽出”のコア:
 * - ブロック構造を blockEnter/blockExit で積む
 * - if/switch/loop/try/catch/finally/return/throw/await/call/new を events として保存
 */
export function extractEvents(checker: ts.TypeChecker, sf: ts.SourceFile, node: ts.Node, out: PEvent[], blockLabel?: string): PEvent[] {
  const eventBase = (n: ts.Node) => ({ loc: locOf(sf, n), syntax: n.getText(sf) });
  const pushRedirect = (n: ts.Node, via: "call" | "assign", api: string, targetNode?: ts.Node) => {
    let options: string | undefined;
    let headerKeys: string[] | undefined;
    if (ts.isCallExpression(n) && n.arguments[1]) {
      options = n.arguments[1].getText(sf);
      const opt = n.arguments[1];
      if (ts.isObjectLiteralExpression(opt)) {
        const headersProp = opt.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) &&
            ((ts.isIdentifier(p.name) && p.name.text === "headers") ||
              (ts.isStringLiteralLike(p.name) && p.name.text === "headers"))
        );
        if (headersProp && ts.isObjectLiteralExpression(headersProp.initializer)) {
          headerKeys = headersProp.initializer.properties
            .map((p) => {
              if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) return undefined;
              const name = p.name;
              if (!name) return undefined;
              if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
              return name.getText(sf);
            })
            .filter((x): x is string => !!x);
        }
      }
    }
    out.push({
      kind: "redirect",
      ...eventBase(n),
      via,
      api,
      target: targetNode?.getText(sf),
      targetType: targetNode ? typeInfo(checker, targetNode) : undefined,
      options,
      headerKeys: headerKeys?.length ? headerKeys : undefined,
    });
  };

  const redirectCallInfo = (
    n: ts.CallExpression
  ): { api: string; targetNode?: ts.Expression } | undefined => {
    const callee = n.expression.getText(sf);

    // React Router / Remix / Next.js / SPA router 系の代表的な redirect API を対象にする。
    const directNames = new Set(["redirect", "permanentRedirect", "navigate"]);
    const memberNames = new Set([
      "router.push",
      "router.replace",
      "router.navigate",
      "history.push",
      "history.replace",
      "window.location.assign",
      "window.location.replace",
      "location.assign",
      "location.replace",
      "document.location.assign",
      "document.location.replace",
      "Response.redirect",
      "NextResponse.redirect",
    ]);

    if (directNames.has(callee) || memberNames.has(callee) || callee.endsWith(".redirect")) {
      return { api: callee, targetNode: n.arguments[0] };
    }
    return undefined;
  };

  const redirectAssignInfo = (
    n: ts.BinaryExpression
  ): { api: string; targetNode?: ts.Expression } | undefined => {
    if (n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
    const left = n.left.getText(sf);
    const redirectAssignTargets = new Set([
      "location.href",
      "window.location.href",
      "document.location.href",
      "location",
      "window.location",
      "document.location",
    ]);
    if (!redirectAssignTargets.has(left)) return undefined;
    return { api: left, targetNode: n.right };
  };

  const urlParamSetInfo = (
    n: ts.CallExpression
  ): { urlExpr: string; keyArg: ts.Expression; valueArg?: ts.Expression } | undefined => {
    if (!ts.isPropertyAccessExpression(n.expression)) return undefined;
    const inner = n.expression.expression;
    if (!ts.isPropertyAccessExpression(inner)) return undefined;
    if (inner.name.text !== "searchParams") return undefined;
    if (n.expression.name.text !== "set") return undefined;
    if (!n.arguments[0]) return undefined;
    return {
      urlExpr: inner.expression.getText(sf),
      keyArg: n.arguments[0],
      valueArg: n.arguments[1],
    };
  };

  // blockEnter/blockExit を必ず対で積むため、push 処理を小関数化しておく。
  // こうしておくとイベント構造の変更時に loc/label の作り方を一箇所で直せる。
  const pushEnter = (label: string, n: ts.Node) => out.push({ kind: "blockEnter", ...eventBase(n), label });
  const pushExit = (label: string, n: ts.Node) => out.push({ kind: "blockExit", ...eventBase(n), label });

  const visit = (n: ts.Node) => {
    // 各種文に対応

    // if 文
    if (ts.isIfStatement(n)) {
      out.push({
        kind: "if",
        ...eventBase(n),
        test: n.expression.getText(sf),
        testType: typeInfo(checker, n.expression),
      });
      // then/else は構造イベントとして明示的に囲む。
      // 後段で「どの call が then 側にあるか」を追いやすくするため。
      pushEnter("then", n.thenStatement);
      ts.forEachChild(n.thenStatement, visit);
      pushExit("then", n.thenStatement);

      if (n.elseStatement) {
        pushEnter("else", n.elseStatement);
        ts.forEachChild(n.elseStatement, visit);
        pushExit("else", n.elseStatement);
      }
      return;
    }

    // switch 文
    if (ts.isSwitchStatement(n)) {
      out.push({
        kind: "switch",
        ...eventBase(n),
        expr: n.expression.getText(sf),
        exprType: typeInfo(checker, n.expression),
      });
      pushEnter("switch", n.caseBlock);
      ts.forEachChild(n.caseBlock, visit);
      pushExit("switch", n.caseBlock);
      return;
    }

    // loop文
    if (ts.isForStatement(n)) {
      // `header` は厳密構文解析ではなく可読性重視の文字列。
      // `{` 以降を落としておくとレポートが長くなり過ぎにくい。
      out.push({ kind: "loop", ...eventBase(n), loopKind: "for", header: n.getText(sf).split("{")[0] ?? "for" });
      pushEnter("for", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("for", n.statement);
      return;
    }

    // for-in, for-of, while, do-while
    if (ts.isForInStatement(n)) {
      out.push({ kind: "loop", ...eventBase(n), loopKind: "forIn", header: n.getText(sf).split("{")[0] ?? "for-in" });
      pushEnter("forIn", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("forIn", n.statement);
      return;
    }

    // for-of
    if (ts.isForOfStatement(n)) {
      out.push({ kind: "loop", ...eventBase(n), loopKind: "forOf", header: n.getText(sf).split("{")[0] ?? "for-of" });
      pushEnter("forOf", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("forOf", n.statement);
      return;
    }

    // while
    if (ts.isWhileStatement(n)) {
      out.push({ kind: "loop", ...eventBase(n), loopKind: "while", header: n.expression.getText(sf) });
      pushEnter("while", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("while", n.statement);
      return;
    }

    // do-while
    if (ts.isDoStatement(n)) {
      out.push({ kind: "loop", ...eventBase(n), loopKind: "do", header: n.expression.getText(sf) });
      pushEnter("do", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("do", n.statement);
      return;
    }

    // try-catch-finally
    if (ts.isTryStatement(n)) {
      out.push({ kind: "try", ...eventBase(n) });
      pushEnter("try", n.tryBlock);
      ts.forEachChild(n.tryBlock, visit);
      pushExit("try", n.tryBlock);

      if (n.catchClause) {
        // catch 変数 (`catch (e)`) は存在しない構文もあるため optional 扱い。
        const p = n.catchClause.variableDeclaration?.name.getText(sf);
        const pNode = n.catchClause.variableDeclaration?.name;
        out.push({
          kind: "catch",
          ...eventBase(n.catchClause),
          param: p,
          paramType: pNode ? typeInfo(checker, pNode) : undefined,
        });
        pushEnter("catch", n.catchClause.block);
        ts.forEachChild(n.catchClause.block, visit);
        pushExit("catch", n.catchClause.block);
      }
      if (n.finallyBlock) {
        out.push({ kind: "finally", ...eventBase(n.finallyBlock) });
        pushEnter("finally", n.finallyBlock);
        ts.forEachChild(n.finallyBlock, visit);
        pushExit("finally", n.finallyBlock);
      }
      return;
    }

    // return 文
    if (ts.isReturnStatement(n)) {
      out.push({
        kind: "return",
        ...eventBase(n),
        expr: n.expression?.getText(sf),
        exprType: n.expression ? typeInfo(checker, n.expression) : undefined,
      });
      return;
    }

    // throw 文
    if (ts.isThrowStatement(n)) {
      out.push({
        kind: "throw",
        ...eventBase(n),
        expr: n.expression.getText(sf),
        exprType: typeInfo(checker, n.expression),
      });
      return;
    }

    // await 式
    if (ts.isAwaitExpression(n)) {
      out.push({
        kind: "await",
        ...eventBase(n),
        expr: n.expression.getText(sf),
        // await 後の値型を見たいので、式本体ではなく await ノード全体の型を引く。
        exprType: typeInfo(checker, n),
      });
      // `await foo(bar())` のような式内 call/new も拾うため、子ノードは継続して走査する。
      ts.forEachChild(n, visit);
      return;
    }

    // 関数/メソッド/コンストラクタ呼び出し
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      out.push({
        kind: "call",
        ...eventBase(n),
        callee,
        calleeType: typeInfo(checker, n.expression),
        // symbol は解決できないケースもある (dynamic call / any / error state) ので optional。
        resolved: symbolInfo(checker, n.expression),
        args: n.arguments.map((a) => ({ text: a.getText(sf), type: typeInfo(checker, a) })),
      });
      ts.forEachChild(n, visit);
      return;
    }

    // クラス/コンストラクタ呼び出し
    if (ts.isNewExpression(n)) {
      const classExpr = n.expression.getText(sf);
      out.push({
        kind: "new",
        ...eventBase(n),
        classExpr,
        classType: typeInfo(checker, n.expression),
        resolved: symbolInfo(checker, n.expression),
        args: (n.arguments ?? []).map((a) => ({ text: a.getText(sf), type: typeInfo(checker, a) })),
      });
      ts.forEachChild(n, visit);
      return;
    }
    // 再帰的に子ノードを訪問
    ts.forEachChild(n, visit);
  };

  // ブロックラベルがあれば enter/exit を追加
  // 例: analyze.ts から関数 body を渡すとき `"body"` を指定し、イベント列の先頭/末尾を明示する。
  if (blockLabel) pushEnter(blockLabel, node);

  // ノードを訪問
  visit(node);

  // ブロックラベルがあれば exit を追加
  if (blockLabel) pushExit(blockLabel, node);

  return out;
}
