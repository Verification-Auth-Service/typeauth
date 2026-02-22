import ts from "typescript";
import path from "node:path";
import fs from "node:fs";
import { errorMessageO } from "./helper/errorMessage";

export function readTsConfigNearest(entryAbs: string): { configPath?: string; options: ts.CompilerOptions; fileNames?: string[] } {
  // entry から親ディレクトリ方向へたどって、最も近い `tsconfig.json` を探す。
  // monorepo でも、対象ファイルに近い設定を優先して使えるようにする。
  let dir = path.dirname(entryAbs);
  while (true) {
    const cand = path.join(dir, "tsconfig.json");
    if (fs.existsSync(cand)) {
      // TypeScript 標準 API で読み込み。
      // JSON parse error / extends 解決エラーなどは diagnostics として返る。
      const read = ts.readConfigFile(cand, ts.sys.readFile);
      if (read.error) {
        const msg = ts.flattenDiagnosticMessageText(read.error.messageText, "\n");
        errorMessageO(`Failed to read tsconfig: ${cand}\n${msg}`);
      }

      // parseJsonConfigFileContent により `extends` 展開や include/exclude 解決を行い、
      // 実際に `createProgram` に渡せる options/fileNames へ変換する。
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir);
      return { configPath: cand, options: parsed.options, fileNames: parsed.fileNames };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // tsconfig が見つからない場合のフォールバック。
  // JSX/ESM を扱える最低限の設定を入れて、単体ファイル解析を継続できるようにする。
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
