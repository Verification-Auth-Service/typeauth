import ts from "typescript";
import path from "node:path";
import fs from "node:fs";
import { errorMessageO } from "./helper/errorMessage";

export function readTsConfigNearest(entryAbs: string): { configPath?: string; options: ts.CompilerOptions; fileNames?: string[] } {
  // entryから上に向かって tsconfig.json 探す
  let dir = path.dirname(entryAbs);
  while (true) {
    const cand = path.join(dir, "tsconfig.json");
    if (fs.existsSync(cand)) {
      const read = ts.readConfigFile(cand, ts.sys.readFile);
      if (read.error) {
        const msg = ts.flattenDiagnosticMessageText(read.error.messageText, "\n");
        errorMessageO(`Failed to read tsconfig: ${cand}\n${msg}`);
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
