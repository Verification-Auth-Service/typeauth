import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sym } from "../shared/syntax-node"
import type { SyntaxNode } from "../shared/syntax-node"
import { renderCommentedLispauthDsl } from "./builder/commented-render"
import { buildSpecSyntax as buildSpecSyntaxInternal, renderSyntax as renderSyntaxInternal } from "./builder/syntax"
import type { LispauthDslBuildOptions, LispauthDslWriteOptions, LispauthDslWriteResult, LispauthSpecDraft } from "./types"

export const q = sym

/**
 * DSL 下書きオブジェクトからコメント付き lispauth テキストを生成する。
 *
 * @param draft 仕様の下書き。例:
 * `{ name: "Mini", machine: { states: ["Start", "Done"], vars: [...], events: [...] } }`
 * @returns 改行終端つきの DSL 文字列。例:
 * `(spec Mini\n  (machine ... )\n)`
 */
export function buildLispauthDsl(draft: LispauthSpecDraft, options: LispauthDslBuildOptions = {}): string {
  return `${renderCommentedLispauthDsl(draft, options)}\n`
}

/**
 * DSL を生成し、レポート用ディレクトリへ `.lispauth` ファイルとして保存する。
 *
 * @param draft 仕様の下書き。`buildLispauthDsl` と同じ形式。
 * @param options 出力オプション。例:
 * `{ outDir: "./report", now: new Date("2026-02-25T10:30:45"), fileStem: "oauth-mini" }`
 * @returns 生成結果。例:
 * `{ fileName: "oauth-mini.lispauth", filePath: "/.../report/oauth-mini.lispauth", dsl: "(spec ...)" }`
 */
export function writeLispauthDslReport(
  draft: LispauthSpecDraft,
  options: LispauthDslWriteOptions = {},
): LispauthDslWriteResult {
  const dsl = buildLispauthDsl(draft, { compactLinearTransitions: options.compactLinearTransitions })
  const outDir = options.outDir ?? defaultReportDir()
  const fileStem = options.fileStem ?? `lispauth-${slugify(draft.name)}-${formatTimestamp(options.now ?? new Date())}`
  const fileName = `${fileStem}.lispauth`
  const filePath = path.join(outDir, fileName)

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(filePath, dsl, "utf8")

  return { filePath, fileName, dsl }
}

/**
 * 下書きオブジェクトを `(spec ...)` の構文木へ変換する。
 *
 * @param draft `LispauthSpecDraft`。
 * @returns ルート S 式ノード。例:
 * `["spec", "Mini", ["machine", ...], ["env", ...], ["property", ...]]`
 */
export function buildSpecSyntax(draft: LispauthSpecDraft): SyntaxNode {
  return buildSpecSyntaxInternal(draft)
}

/**
 * SyntaxNode を lispauth DSL 文字列へ整形する。
 *
 * @param node 変換対象の S 式ノード。例: `["event", "Finish", []]`
 * @param indent インデント幅。既定値は `2`。
 * @returns 整形済み DSL 文字列。例: `(event Finish ())`
 */
export function renderSyntax(node: SyntaxNode, indent = 2): string {
  return renderSyntaxInternal(node, indent)
}

function defaultReportDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(currentDir, "..", "..", "..", "..", "report")
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "spec"
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mi = String(date.getMinutes()).padStart(2, "0")
  const ss = String(date.getSeconds()).padStart(2, "0")

  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`
}
