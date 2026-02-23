// メイン分析関数

import fs from "fs";
import path from "path";
import ts from "typescript";
import { extractEvents } from "./event";
import { AnalysisReport, FileReport, FunctionReport, ImportReport } from "./../types/report";
import { locOf } from "../helper/locOf";
import { functionKind, functionName } from "../helper/function";
import { errorMessageO } from "../helper/errorMessage";
import { signatureOf } from "../helper/signature";
import { readTsConfigNearest } from "../readTsConfig";
import { PEvent } from "../types/event";
import { isTsLike } from "../helper/regular";

/**
 * エントリファイルから始めて静的解析を行い、AnalysisReport を生成する
 */

export function analyze(entryFile: string): AnalysisReport {
  // 呼び出し元が相対パスを渡しても、以降の比較・出力を安定させるため絶対パス化する。
  const entryAbs = path.resolve(entryFile);
  if (!fs.existsSync(entryAbs)) errorMessageO(`File not found: ${entryAbs}`);
  if (!isTsLike(entryAbs)) errorMessageO(`Not a TS-like file: ${entryAbs}`);

  // 近傍 tsconfig を採用して Program/TypeChecker の精度を上げる
  // (paths/JSX/moduleResolution などの差分が解析結果に直結するため)。
  const cfg = readTsConfigNearest(entryAbs);

  // `tsconfig.json` の include 対象に entry が入っていないケースでも、
  // 解析要求されたファイル自体は必ず Program に入れる。
  // 例: route file 単体を指定したが tsconfig の include が `src/**/*.ts` のみ、など。
  const rootNames = cfg.fileNames?.includes(entryAbs) ? cfg.fileNames : [entryAbs, ...(cfg.fileNames ?? [])];

  // TypeScript 標準の CompilerHost を使う。今回は AST/型解析が目的なので emit はしない。
  const host = ts.createCompilerHost(cfg.options, true);
  const program = ts.createProgram({
    rootNames,
    options: cfg.options,
    host,
  });

  // event 抽出時に条件式/引数/呼び出し先の型を引くため TypeChecker を保持する。
  const checker = program.getTypeChecker();

  const reports: FileReport[] = [];

  const entryDir = path.dirname(entryAbs);

  // Program には lib.d.ts / node_modules / 依存パッケージのソースが含まれうる。
  // レポートを見やすくするため、まずは entry と同じディレクトリ配下へ絞る。
  const sfs = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile)
    .filter((sf) => path.resolve(sf.fileName).startsWith(entryDir));

  for (const sf of sfs) {
    const functions: FunctionReport[] = [];
    const imports: ImportReport[] = sf.statements
      .filter(ts.isImportDeclaration)
      .map((d) => ({
        source: ts.isStringLiteral(d.moduleSpecifier) ? d.moduleSpecifier.text : d.moduleSpecifier.getText(sf),
        syntax: d.getText(sf),
      }));

    const visitTop = (n: ts.Node) => {
      // 「関数としてレポートする対象」かどうかを先に判定する。
      // 実際の body 解析とは分けておくことで、命名戦略や対象種類の拡張をしやすくする。
      const fk = functionKind(n);
      if (fk) {
        const name = functionName(n);
        // ノードの pos/end を使って、同名関数があっても一意識別できるIDを作る。
        const id = `${path.resolve(sf.fileName)}:${n.pos}:${n.end}`;
        const loc = locOf(sf, n);

        const events: PEvent[] = [];

        // ここで body を取り出してフローイベントを抽出する。
        // arrow function / function expression も対象に含めることで、
        // React Router Framework の `export const loader = async () => {}` 形式も拾える。
        if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
          const body = n.body;
          if (body) extractEvents(checker, sf, body, events, "body");
        }

        // シグネチャ文字列はレポート閲覧用の補助情報。
        // 型エラーや未解決参照があっても解析を止めないよう helper 側で失敗吸収する。
        const sig =
          ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
            ? signatureOf(checker, n)
            : undefined;

        functions.push({ id, name, kind: fk, loc, signature: sig, events });
      }
      ts.forEachChild(n, visitTop);
    };

    visitTop(sf);

    // 関数が1つもないファイルはノイズになりやすいのでレポートから除外する。
    if (functions.length) reports.push({ file: path.resolve(sf.fileName), imports: imports.length ? imports : undefined, functions });
  }

  return {
    entry: entryAbs,
    tsconfigUsed: cfg.configPath,
    files: reports,
  };
}
