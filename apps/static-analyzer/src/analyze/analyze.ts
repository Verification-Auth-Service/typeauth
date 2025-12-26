// メイン分析関数

import fs from "fs";
import path from "path";
import ts from "typescript";
import { extractEvents } from "./event";
import { AnalysisReport, FileReport, FunctionReport } from "./../types/report";
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
  const entryAbs = path.resolve(entryFile);
  if (!fs.existsSync(entryAbs)) errorMessageO(`File not found: ${entryAbs}`);
  if (!isTsLike(entryAbs)) errorMessageO(`Not a TS-like file: ${entryAbs}`);

  const cfg = readTsConfigNearest(entryAbs);

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

        const events: PEvent[] = [];

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
