#!/usr/bin/env node
import ts from "typescript";
import path from "node:path";
import fs from "node:fs";

/**
 * 目的:
 * - 引数で与えられたTS/TSXファイルを起点に Program + TypeChecker を作る
 * - 関数/メソッド単位で、分岐/ループ/例外/return/await/call を「イベント」として抽出
 * - 重要: 各イベントに型情報(可能ならsymbol/decl)を付与
 */

type Location = {
  file: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
};

type TypeInfo = {
  text: string; // checker.typeToString
};

type SymbolInfo = {
  name: string;
  flags?: string;
  declarations?: Location[];
};

type Event =
  | { kind: "if"; loc: Location; test: string; testType?: TypeInfo }
  | { kind: "switch"; loc: Location; expr: string; exprType?: TypeInfo }
  | { kind: "loop"; loc: Location; loopKind: "for" | "forIn" | "forOf" | "while" | "do"; header: string }
  | { kind: "try"; loc: Location }
  | { kind: "catch"; loc: Location; param?: string; paramType?: TypeInfo }
  | { kind: "finally"; loc: Location }
  | { kind: "return"; loc: Location; expr?: string; exprType?: TypeInfo }
  | { kind: "throw"; loc: Location; expr: string; exprType?: TypeInfo }
  | { kind: "await"; loc: Location; expr: string; exprType?: TypeInfo }
  | {
      kind: "call";
      loc: Location;
      callee: string;
      calleeType?: TypeInfo;
      resolved?: SymbolInfo; // 可能なら呼び出し先シンボル
      args: { text: string; type?: TypeInfo }[];
    }
  | {
      kind: "new";
      loc: Location;
      classExpr: string;
      classType?: TypeInfo;
      resolved?: SymbolInfo;
      args: { text: string; type?: TypeInfo }[];
    }
  | { kind: "blockEnter"; loc: Location; label: string }
  | { kind: "blockExit"; loc: Location; label: string };

type FunctionReport = {
  id: string;
  name: string;
  kind: "function" | "method" | "arrow" | "constructor";
  loc: Location;
  signature?: string;
  events: Event[];
};

type FileReport = {
  file: string;
  functions: FunctionReport[];
};

type AnalysisReport = {
  entry: string;
  tsconfigUsed?: string;
  files: FileReport[];
};

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function isTsLike(p: string) {
  return /\.(tsx?|mts|cts)$/.test(p);
}

function readTsConfigNearest(entryAbs: string): { configPath?: string; options: ts.CompilerOptions; fileNames?: string[] } {
  // entryから上に向かって tsconfig.json 探す
  let dir = path.dirname(entryAbs);
  while (true) {
    const cand = path.join(dir, "tsconfig.json");
    if (fs.existsSync(cand)) {
      const read = ts.readConfigFile(cand, ts.sys.readFile);
      if (read.error) {
        const msg = ts.flattenDiagnosticMessageText(read.error.messageText, "\n");
        die(`Failed to read tsconfig: ${cand}\n${msg}`);
      }
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir);
      return { configPath: cand, options: parsed.options, fileNames: parsed.fileNames };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 見つからない場合のデフォルト
  return {
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      jsx: ts.JsxEmit.ReactJSX,
      skipLibCheck: true,
      allowJs: false,
    },
  };
}

function locOf(sf: ts.SourceFile, node: ts.Node): Location {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf, false));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: path.resolve(sf.fileName),
    start: { line: start.line + 1, character: start.character + 1 },
    end: { line: end.line + 1, character: end.character + 1 },
  };
}

function typeInfo(checker: ts.TypeChecker, node: ts.Node): TypeInfo | undefined {
  try {
    const t = checker.getTypeAtLocation(node);
    return { text: checker.typeToString(t, node, ts.TypeFormatFlags.NoTruncation) };
  } catch {
    return undefined;
  }
}

function symbolInfo(checker: ts.TypeChecker, node: ts.Node): SymbolInfo | undefined {
  const sym =
    checker.getSymbolAtLocation(node) ??
    (ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name) : undefined) ??
    (ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined);

  if (!sym) return undefined;

  const decls = (sym.declarations ?? []).map((d) => locOf(d.getSourceFile(), d));
  return {
    name: checker.symbolToString(sym),
    flags: ts.SymbolFlags[sym.flags] ?? String(sym.flags),
    declarations: decls.length ? decls : undefined,
  };
}

function signatureOf(checker: ts.TypeChecker, decl: ts.SignatureDeclaration): string | undefined {
  try {
    const sig = checker.getSignatureFromDeclaration(decl);
    if (!sig) return undefined;
    return checker.signatureToString(sig, decl, ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Call);
  } catch {
    return undefined;
  }
}

function functionKind(node: ts.Node): FunctionReport["kind"] | undefined {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isArrowFunction(node)) return "arrow";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isFunctionExpression(node)) return "function";
  return undefined;
}

function functionName(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? "<anonymous function>";
  if (ts.isMethodDeclaration(node)) {
    if (ts.isIdentifier(node.name)) return node.name.text;
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isArrowFunction(node)) return "<arrow>";
  if (ts.isFunctionExpression(node)) return node.name?.text ?? "<function expr>";
  return "<unknown>";
}

/**
 * “フロー抽出”のコア:
 * - ブロック構造を blockEnter/blockExit で積む
 * - if/switch/loop/try/catch/finally/return/throw/await/call/new を events として保存
 */
function extractEvents(checker: ts.TypeChecker, sf: ts.SourceFile, node: ts.Node, out: Event[], blockLabel?: string) {
  const pushEnter = (label: string, n: ts.Node) => out.push({ kind: "blockEnter", loc: locOf(sf, n), label });
  const pushExit = (label: string, n: ts.Node) => out.push({ kind: "blockExit", loc: locOf(sf, n), label });

  const visit = (n: ts.Node) => {
    // --- statements / blocks
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

    if (ts.isForStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "for", header: n.getText(sf).split("{")[0] ?? "for" });
      pushEnter("for", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("for", n.statement);
      return;
    }
    if (ts.isForInStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "forIn", header: n.getText(sf).split("{")[0] ?? "for-in" });
      pushEnter("forIn", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("forIn", n.statement);
      return;
    }
    if (ts.isForOfStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "forOf", header: n.getText(sf).split("{")[0] ?? "for-of" });
      pushEnter("forOf", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("forOf", n.statement);
      return;
    }
    if (ts.isWhileStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "while", header: n.expression.getText(sf) });
      pushEnter("while", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("while", n.statement);
      return;
    }
    if (ts.isDoStatement(n)) {
      out.push({ kind: "loop", loc: locOf(sf, n), loopKind: "do", header: n.expression.getText(sf) });
      pushEnter("do", n.statement);
      ts.forEachChild(n.statement, visit);
      pushExit("do", n.statement);
      return;
    }

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

    if (ts.isReturnStatement(n)) {
      out.push({
        kind: "return",
        loc: locOf(sf, n),
        expr: n.expression?.getText(sf),
        exprType: n.expression ? typeInfo(checker, n.expression) : undefined,
      });
      return;
    }

    if (ts.isThrowStatement(n)) {
      out.push({
        kind: "throw",
        loc: locOf(sf, n),
        expr: n.expression.getText(sf),
        exprType: typeInfo(checker, n.expression),
      });
      return;
    }

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

    // default: descend
    ts.forEachChild(n, visit);
  };

  if (blockLabel) pushEnter(blockLabel, node);
  visit(node);
  if (blockLabel) pushExit(blockLabel, node);
}

// メイン分析関数
function analyze(entryFile: string): AnalysisReport {
  const entryAbs = path.resolve(entryFile);
  if (!fs.existsSync(entryAbs)) die(`File not found: ${entryAbs}`);
  if (!isTsLike(entryAbs)) die(`Not a TS-like file: ${entryAbs}`);

  const cfg = readTsConfigNearest(entryAbs);

  // Program: tsconfig があればその fileNames 全体を含める方が型解決が強い
  // ただし、まずは entry を確実に含める
  const rootNames = cfg.fileNames?.includes(entryAbs) ? cfg.fileNames : [entryAbs, ...(cfg.fileNames ?? [])];

  const host = ts.createCompilerHost(cfg.options, true);
  const program = ts.createProgram({
    rootNames,
    options: cfg.options,
    host,
  });

  const checker = program.getTypeChecker();

  const reports: FileReport[] = [];

  const entryDir = path.dirname(entryAbs);

  const sfs = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile)
    .filter((sf) => path.resolve(sf.fileName).startsWith(entryDir));

  for (const sf of sfs) {
    const functions: FunctionReport[] = [];

    const visitTop = (n: ts.Node) => {
      const fk = functionKind(n);
      if (fk) {
        const name = functionName(n);
        const id = `${path.resolve(sf.fileName)}:${n.pos}:${n.end}`;
        const loc = locOf(sf, n);

        const events: Event[] = [];
        // 関数本体のBlock or 式本体に対して抽出
        if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
          const body = n.body;
          if (body) extractEvents(checker, sf, body, events, "body");
        }

        const sig =
          ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
            ? signatureOf(checker, n)
            : undefined;

        functions.push({ id, name, kind: fk, loc, signature: sig, events });
      }
      ts.forEachChild(n, visitTop);
    };

    visitTop(sf);

    // 関数が1つもないファイルは飛ばす
    if (functions.length) reports.push({ file: path.resolve(sf.fileName), functions });
  }

  return {
    entry: entryAbs,
    tsconfigUsed: cfg.configPath,
    files: reports,
  };
}

// ---- CLI
function main() {
  const entry = process.argv[2];
  if (!entry) {
    console.error("Usage: static-analyzer <entry-file.ts>");
    process.exit(2);
  }

  const report = analyze(entry);
  process.stdout.write(JSON.stringify(report, null, 2));
}

main();
