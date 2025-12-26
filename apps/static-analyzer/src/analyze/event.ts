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
export function extractEvents(checker: ts.TypeChecker, sf: ts.SourceFile, node: ts.Node, out: PEvent[], blockLabel?: string) {
  const pushEnter = (label: string, n: ts.Node) => out.push({ kind: "blockEnter", loc: locOf(sf, n), label });
  const pushExit = (label: string, n: ts.Node) => out.push({ kind: "blockExit", loc: locOf(sf, n), label });

  const visit = (n: ts.Node) => {
    // 各種文に対応

    // if 文
    if (ts.isIfStatement(n)) {
      out.push({
        kind: "if",
        loc: locOf(sf, n),
        test: n.expression.getText(sf),
        testType: typeInfo(checker, n.expression),
      });
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
        loc: locOf(sf, n),
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
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "for", header: n.getText(sf).split("{")[0] ?? "for" });
      pushEnter("for", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("for", n.statement);
      return;
    }

    // for-in, for-of, while, do-while
    if (ts.isForInStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "forIn", header: n.getText(sf).split("{")[0] ?? "for-in" });
      pushEnter("forIn", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("forIn", n.statement);
      return;
    }

    // for-of
    if (ts.isForOfStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "forOf", header: n.getText(sf).split("{")[0] ?? "for-of" });
      pushEnter("forOf", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("forOf", n.statement);
      return;
    }

    // while
    if (ts.isWhileStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "while", header: n.expression.getText(sf) });
      pushEnter("while", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("while", n.statement);
      return;
    }

    // do-while
    if (ts.isDoStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "do", header: n.expression.getText(sf) });
      pushEnter("do", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("do", n.statement);
      return;
    }

    // try-catch-finally
    if (ts.isTryStatement(n)) {
      out.push({ kind: "try", loc: locOf(sf, n) });
      pushEnter("try", n.tryBlock);
      ts.forEachChild(n.tryBlock, visit);
      pushExit("try", n.tryBlock);

      if (n.catchClause) {
        const p = n.catchClause.variableDeclaration?.name.getText(sf);
        const pNode = n.catchClause.variableDeclaration?.name;
        out.push({
          kind: "catch",
          loc: locOf(sf, n.catchClause),
          param: p,
          paramType: pNode ? typeInfo(checker, pNode) : undefined,
        });
        pushEnter("catch", n.catchClause.block);
        ts.forEachChild(n.catchClause.block, visit);
        pushExit("catch", n.catchClause.block);
      }
      if (n.finallyBlock) {
        out.push({ kind: "finally", loc: locOf(sf, n.finallyBlock) });
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
        loc: locOf(sf, n),
        expr: n.expression?.getText(sf),
        exprType: n.expression ? typeInfo(checker, n.expression) : undefined,
      });
      return;
    }

    // throw 文
    if (ts.isThrowStatement(n)) {
      out.push({
        kind: "throw",
        loc: locOf(sf, n),
        expr: n.expression.getText(sf),
        exprType: typeInfo(checker, n.expression),
      });
      return;
    }

    // await 式
    if (ts.isAwaitExpression(n)) {
      out.push({
        kind: "await",
        loc: locOf(sf, n),
        expr: n.expression.getText(sf),
        exprType: typeInfo(checker, n),
      });
      ts.forEachChild(n, visit);
      return;
    }

    // 関数/メソッド/コンストラクタ呼び出し
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      out.push({
        kind: "call",
        loc: locOf(sf, n),
        callee,
        calleeType: typeInfo(checker, n.expression),
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
        loc: locOf(sf, n),
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
  if (blockLabel) pushEnter(blockLabel, node);

  // ノードを訪問
  visit(node);

  // ブロックラベルがあれば exit を追加
  if (blockLabel) pushExit(blockLabel, node);
}
