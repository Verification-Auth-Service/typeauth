import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sym } from "../shared/syntax-node"
import type { SyntaxNode } from "../shared/syntax-node"
import type { LispauthDslWriteOptions, LispauthDslWriteResult, LispauthSpecDraft } from "./types"

export const q = sym

/**
 * DSL 下書きオブジェクトからコメント付き lispauth テキストを生成する。
 *
 * @param draft 仕様の下書き。例:
 * `{ name: "Mini", machine: { states: ["Start", "Done"], vars: [...], events: [...] } }`
 * @returns 改行終端つきの DSL 文字列。例:
 * `(spec Mini\n  (machine ... )\n)`
 */
export function buildLispauthDsl(draft: LispauthSpecDraft): string {
  return `${renderCommentedLispauthDsl(draft)}\n`
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
  const dsl = buildLispauthDsl(draft)
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
  const machineNode = buildMachineSyntax(draft)
  const httpNode = buildHttpSyntax(draft)
  const envNode = buildEnvSyntax(draft)
  const propertyNode = buildPropertySyntax(draft)

  return ["spec", draft.name, machineNode, ...(httpNode ? [httpNode] : []), envNode, propertyNode]
}

function buildMachineSyntax(draft: LispauthSpecDraft): SyntaxNode[] {
  return [
    "machine",
    ["states", ...draft.machine.states],
    ["vars", ...draft.machine.vars.map((variable) => [variable.name, variable.type])],
    ...draft.machine.events.map(buildEventSyntax),
  ]
}

function buildHttpSyntax(draft: LispauthSpecDraft): SyntaxNode[] | undefined {
  const httpDraft = draft.http ?? {}
  const http: SyntaxNode[] = ["http"]

  if (httpDraft.focusEndpoint) http.push(["focus-endpoint", httpDraft.focusEndpoint])
  for (const endpoint of httpDraft.endpoints ?? []) http.push(["endpoint", endpoint])
  for (const binding of httpDraft.eventEndpoints ?? []) {
    http.push(["event-endpoints", binding.event, ...binding.endpoints])
  }

  return http.length > 1 ? http : undefined
}

function buildEnvSyntax(draft: LispauthSpecDraft): SyntaxNode[] {
  const envDraft = draft.env ?? {}
  const env: SyntaxNode[] = ["env"]

  if (envDraft.scheduler) env.push(["scheduler", envDraft.scheduler])
  for (const allow of envDraft.allow ?? []) env.push(["allow", allow])
  if (typeof envDraft.sessions === "number") env.push(["sessions", envDraft.sessions])

  if (envDraft.time && (typeof envDraft.time.maxSteps === "number" || typeof envDraft.time.tick === "number")) {
    const time: SyntaxNode[] = ["time"]
    if (typeof envDraft.time.maxSteps === "number") time.push(["max-steps", envDraft.time.maxSteps])
    if (typeof envDraft.time.tick === "number") time.push(["tick", envDraft.time.tick])
    env.push(time)
  }

  return env
}

function buildPropertySyntax(draft: LispauthSpecDraft): SyntaxNode[] {
  const propertyDraft = draft.property ?? {}
  const property: SyntaxNode[] = [
    "property",
    ...(propertyDraft.invariants ?? []).map((invariant) => ["invariant", invariant.name, invariant.expr] satisfies SyntaxNode[]),
  ]

  if (propertyDraft.counterexample) {
    const counterexample: SyntaxNode[] = ["counterexample"]
    if (propertyDraft.counterexample.format) counterexample.push(["format", propertyDraft.counterexample.format])
    if (propertyDraft.counterexample.minimize) counterexample.push(["minimize", propertyDraft.counterexample.minimize])
    property.push(counterexample)
  }

  return property
}

function buildEventSyntax(event: LispauthSpecDraft["machine"]["events"][number]): SyntaxNode {
  const out: SyntaxNode[] = ["event", event.name, (event.params ?? []).map((param) => [param.name, param.type])]

  if (event.when !== undefined) out.push(["when", event.when])
  for (const requirement of event.require ?? []) out.push(["require", requirement])
  if (event.do) out.push(["do", ...event.do])
  if (event.goto) out.push(["goto", q(event.goto)])

  return out
}

/**
 * SyntaxNode を lispauth DSL 文字列へ整形する。
 *
 * @param node 変換対象の S 式ノード。例: `["event", "Finish", []]`
 * @param indent インデント幅。既定値は `2`。
 * @returns 整形済み DSL 文字列。例: `(event Finish ())`
 */
export function renderSyntax(node: SyntaxNode, indent = 2): string {
  return renderNode(node, 0, indent)
}

function renderNode(node: SyntaxNode, level: number, indent: number): string {
  if (Array.isArray(node)) return renderList(node, level, indent)
  if (typeof node === "string") return renderAtom(node)
  if (typeof node === "number") return String(node)
  if (typeof node === "boolean") return node ? "true" : "false"
  if (node === null) return "null"
  return `'${node.name}`
}

function renderList(list: SyntaxNode[], level: number, indent: number): string {
  if (list.length === 0) return "()"
  if (list.every(isAtomicLike)) {
    return `(${list.map((node) => renderNode(node, level + 1, indent)).join(" ")})`
  }

  const currentIndent = " ".repeat(level * indent)
  const childIndent = " ".repeat((level + 1) * indent)
  const [head, ...tail] = list

  let out = `(${renderNode(head, level + 1, indent)}`
  for (const item of tail) {
    if (isAtomicLike(item)) {
      out += ` ${renderNode(item, level + 1, indent)}`
      continue
    }
    out += `\n${childIndent}${renderNode(item, level + 1, indent)}`
  }

  if (tail.some((node) => !isAtomicLike(node))) out += `\n${currentIndent}`
  out += ")"
  return out
}

function isAtomicLike(node: SyntaxNode): boolean {
  return !Array.isArray(node)
}

function renderAtom(value: string): string {
  if (/^[A-Za-z0-9_.:+\-?*=<>!/]+$/.test(value)) return value
  return JSON.stringify(value)
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

function renderCommentedLispauthDsl(draft: LispauthSpecDraft): string {
  const lines: string[] = []

  pushComment(lines, 0, "仕様定義の開始（spec 名はレビュー単位の識別子）")
  pushLine(lines, 0, `(spec ${renderAtom(draft.name)}`)

  renderCommentedMachineSection(lines, draft)
  renderCommentedHttpSection(lines, draft)
  renderCommentedEnvSection(lines, draft)
  renderCommentedPropertySection(lines, draft)

  pushLine(lines, 0, ")")
  return lines.join("\n")
}

function renderCommentedMachineSection(lines: string[], draft: LispauthSpecDraft): void {
  pushComment(lines, 1, "状態機械")
  pushLine(lines, 1, "(machine")

  pushComment(lines, 2, "状態一覧")
  pushRendered(lines, 2, ["states", ...draft.machine.states])

  pushComment(lines, 2, "状態変数")
  pushLine(lines, 2, "(vars")
  for (const variable of draft.machine.vars) {
    pushComment(lines, 3, `${variable.name} の型`)
    pushRendered(lines, 3, [variable.name, variable.type])
  }
  pushLine(lines, 2, ")")

  for (const event of draft.machine.events) {
    renderCommentedEvent(lines, event)
  }

  pushLine(lines, 1, ")")
}

function renderCommentedEvent(
  lines: string[],
  event: LispauthSpecDraft["machine"]["events"][number],
): void {
  pushComment(lines, 2, `イベント ${event.name}`)
  pushLine(lines, 2, `(event ${renderAtom(event.name)}`)

  pushComment(lines, 3, "引数一覧")
  pushRendered(
    lines,
    3,
    (event.params ?? []).map((param) => [param.name, param.type]),
  )

  if (event.when !== undefined) {
    pushComment(lines, 3, "実行前提（when）")
    pushRendered(lines, 3, ["when", event.when])
  }

  for (const [index, requirement] of (event.require ?? []).entries()) {
    pushComment(lines, 3, `必須条件 require-${index + 1}`)
    pushRendered(lines, 3, ["require", requirement])
  }

  if (event.do) {
    pushComment(lines, 3, "更新処理（do）")
    pushLine(lines, 3, "(do")
    for (const [index, op] of event.do.entries()) {
      pushComment(lines, 4, `操作 ${index + 1}`)
      pushRendered(lines, 4, op)
    }
    pushLine(lines, 3, ")")
  }

  if (event.goto) {
    pushComment(lines, 3, "遷移先状態（goto）")
    pushRendered(lines, 3, ["goto", q(event.goto)])
  }

  pushLine(lines, 2, ")")
}

function renderCommentedHttpSection(lines: string[], draft: LispauthSpecDraft): void {
  const httpDraft = draft.http ?? {}
  const hasHttpContent =
    Boolean(httpDraft.focusEndpoint) ||
    (httpDraft.endpoints?.length ?? 0) > 0 ||
    (httpDraft.eventEndpoints?.length ?? 0) > 0

  if (!hasHttpContent) return

  pushComment(lines, 1, "HTTP endpoint 情報")
  pushLine(lines, 1, "(http")

  if (httpDraft.focusEndpoint) {
    pushComment(lines, 2, "注目 endpoint")
    pushRendered(lines, 2, ["focus-endpoint", httpDraft.focusEndpoint])
  }

  for (const endpoint of httpDraft.endpoints ?? []) {
    pushComment(lines, 2, "観測 endpoint")
    pushRendered(lines, 2, ["endpoint", endpoint])
  }

  for (const binding of httpDraft.eventEndpoints ?? []) {
    pushComment(lines, 2, `${binding.event} と endpoint の対応`)
    pushRendered(lines, 2, ["event-endpoints", binding.event, ...binding.endpoints])
  }

  pushLine(lines, 1, ")")
}

function renderCommentedEnvSection(lines: string[], draft: LispauthSpecDraft): void {
  const envDraft = draft.env ?? {}

  pushComment(lines, 1, "探索環境")
  pushLine(lines, 1, "(env")

  if (envDraft.scheduler) {
    pushComment(lines, 2, "スケジューラ方針")
    pushRendered(lines, 2, ["scheduler", envDraft.scheduler])
  }

  for (const allow of envDraft.allow ?? []) {
    pushComment(lines, 2, `許容挙動: ${allow}`)
    pushRendered(lines, 2, ["allow", allow])
  }

  if (typeof envDraft.sessions === "number") {
    pushComment(lines, 2, "同時セッション数")
    pushRendered(lines, 2, ["sessions", envDraft.sessions])
  }

  if (envDraft.time && (typeof envDraft.time.maxSteps === "number" || typeof envDraft.time.tick === "number")) {
    pushComment(lines, 2, "探索境界（time）")
    pushLine(lines, 2, "(time")

    if (typeof envDraft.time.maxSteps === "number") {
      pushComment(lines, 3, "最大ステップ数")
      pushRendered(lines, 3, ["max-steps", envDraft.time.maxSteps])
    }
    if (typeof envDraft.time.tick === "number") {
      pushComment(lines, 3, "1ステップの時間進行")
      pushRendered(lines, 3, ["tick", envDraft.time.tick])
    }

    pushLine(lines, 2, ")")
  }

  pushLine(lines, 1, ")")
}

function renderCommentedPropertySection(lines: string[], draft: LispauthSpecDraft): void {
  const propertyDraft = draft.property ?? {}

  pushComment(lines, 1, "検証プロパティ")
  pushLine(lines, 1, "(property")

  for (const invariant of propertyDraft.invariants ?? []) {
    pushComment(lines, 2, `不変条件 ${invariant.name}`)
    pushRendered(lines, 2, ["invariant", invariant.name, invariant.expr])
  }

  if (propertyDraft.counterexample) {
    pushComment(lines, 2, "反例出力設定")
    pushLine(lines, 2, "(counterexample")

    if (propertyDraft.counterexample.format) {
      pushComment(lines, 3, "出力形式")
      pushRendered(lines, 3, ["format", propertyDraft.counterexample.format])
    }
    if (propertyDraft.counterexample.minimize) {
      pushComment(lines, 3, "最小化方針")
      pushRendered(lines, 3, ["minimize", propertyDraft.counterexample.minimize])
    }

    pushLine(lines, 2, ")")
  }

  pushLine(lines, 1, ")")
}

function pushComment(lines: string[], level: number, text: string): void {
  lines.push(`${" ".repeat(level * 2)}; - ${text}`)
}

function pushLine(lines: string[], level: number, text: string): void {
  lines.push(`${" ".repeat(level * 2)}${text}`)
}

function pushRendered(lines: string[], level: number, node: SyntaxNode): void {
  const indent = " ".repeat(level * 2)
  for (const line of renderSyntax(node).split("\n")) {
    lines.push(`${indent}${line}`)
  }
}
