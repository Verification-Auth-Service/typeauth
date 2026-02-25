import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sym } from "./parser"
import type { Sexp } from "./types"

// lispauth DSL 出力用の入力型。
// `when / require / do / invariant.expr` は S 式 (Sexp) をそのまま渡す設計にして、
// builder 自身が式言語の仕様まで抱え込まないようにしている。
export type LispauthSpecDraft = {
  name: string
  machine: {
    states: string[]
    vars: Array<{ name: string; type: Sexp }>
    events: Array<{
      name: string
      params?: Array<{ name: string; type: string }>
      when?: Sexp
      require?: Sexp[]
      do?: Sexp[]
      goto?: string
    }>
  }
  env?: {
    scheduler?: string
    allow?: string[]
    sessions?: number
    time?: { maxSteps?: number; tick?: number }
  }
  property?: {
    invariants?: Array<{ name: string; expr: Sexp }>
    counterexample?: { format?: string; minimize?: "steps" }
  }
}

export type LispauthDslWriteResult = {
  filePath: string
  fileName: string
  dsl: string
}

export type LispauthDslWriteOptions = {
  outDir?: string
  now?: Date
  fileStem?: string
}

// quoted symbol を builder 利用側でも作りやすくするための再公開ヘルパ。
// 例: q("AuthStarted") -> `'AuthStarted` 相当の AST ノード
export const q = sym

export function buildLispauthDsl(draft: LispauthSpecDraft): string {
  return renderSexp(buildSpecSexp(draft)) + "\n"
}

// DSL を生成しつつ、`apps/static-analyzer/report/` (デフォルト) に保存する。
// レビュー時に「今どの仕様を吐いたか」をファイルとして残せるよう、spec 名と timestamp をファイル名に含める。
export function writeLispauthDslReport(draft: LispauthSpecDraft, options: LispauthDslWriteOptions = {}): LispauthDslWriteResult {
  const dsl = buildLispauthDsl(draft)
  const outDir = options.outDir ?? defaultReportDir()
  const fileStem = options.fileStem ?? `lispauth-${slugify(draft.name)}-${formatTimestamp(options.now ?? new Date())}`
  const fileName = `${fileStem}.lispauth`
  const filePath = path.join(outDir, fileName)

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(filePath, dsl, "utf8")

  return { filePath, fileName, dsl }
}

export function buildSpecSexp(draft: LispauthSpecDraft): Sexp {
  const machine: Sexp[] = [
    "machine",
    ["states", ...draft.machine.states],
    ["vars", ...draft.machine.vars.map((v) => [v.name, v.type])],
    ...draft.machine.events.map(buildEventSexp),
  ]

  const envDraft = draft.env ?? {}
  const env: Sexp[] = ["env"]
  if (envDraft.scheduler) env.push(["scheduler", envDraft.scheduler])
  for (const a of envDraft.allow ?? []) env.push(["allow", a])
  if (typeof envDraft.sessions === "number") env.push(["sessions", envDraft.sessions])
  if (envDraft.time && (typeof envDraft.time.maxSteps === "number" || typeof envDraft.time.tick === "number")) {
    const time: Sexp[] = ["time"]
    if (typeof envDraft.time.maxSteps === "number") time.push(["max-steps", envDraft.time.maxSteps])
    if (typeof envDraft.time.tick === "number") time.push(["tick", envDraft.time.tick])
    env.push(time)
  }

  const propertyDraft = draft.property ?? {}
  const property: Sexp[] = [
    "property",
    ...(propertyDraft.invariants ?? []).map((inv) => ["invariant", inv.name, inv.expr] satisfies Sexp[]),
  ]
  if (propertyDraft.counterexample) {
    const cx: Sexp[] = ["counterexample"]
    if (propertyDraft.counterexample.format) cx.push(["format", propertyDraft.counterexample.format])
    if (propertyDraft.counterexample.minimize) cx.push(["minimize", propertyDraft.counterexample.minimize])
    property.push(cx)
  }

  return ["spec", draft.name, machine, env, property]
}

function buildEventSexp(event: LispauthSpecDraft["machine"]["events"][number]): Sexp {
  const out: Sexp[] = [
    "event",
    event.name,
    (event.params ?? []).map((p) => [p.name, p.type]),
  ]

  if (event.when !== undefined) out.push(["when", event.when])
  for (const r of event.require ?? []) out.push(["require", r])
  if (event.do) out.push(["do", ...event.do])
  if (event.goto) out.push(["goto", q(event.goto)])
  return out
}

export function renderSexp(node: Sexp, indent = 2): string {
  return renderNode(node, 0, indent)
}

function renderNode(node: Sexp, level: number, indent: number): string {
  if (Array.isArray(node)) return renderList(node, level, indent)
  if (typeof node === "string") return renderAtom(node)
  if (typeof node === "number") return String(node)
  if (typeof node === "boolean") return node ? "true" : "false"
  if (node === null) return "null"
  return `'${node.name}`
}

function renderList(list: Sexp[], level: number, indent: number): string {
  if (list.length === 0) return "()"
  if (list.every(isAtomicLike)) {
    return `(${list.map((x) => renderNode(x, level + 1, indent)).join(" ")})`
  }

  const pad = " ".repeat(level * indent)
  const childPad = " ".repeat((level + 1) * indent)
  const [head, ...rest] = list

  let out = `(${renderNode(head, level + 1, indent)}`
  for (const item of rest) {
    if (isAtomicLike(item)) {
      out += ` ${renderNode(item, level + 1, indent)}`
      continue
    }
    out += `\n${childPad}${renderNode(item, level + 1, indent)}`
  }
  if (rest.some((x) => !isAtomicLike(x))) out += `\n${pad}`
  out += ")"
  return out
}

function isAtomicLike(node: Sexp): boolean {
  return !Array.isArray(node)
}

function renderAtom(value: string): string {
  // DSL の識別子として安全に書けるもの以外は文字列リテラル化する。
  // `session.state`, `last.args.code`, `max-steps` などは識別子としてそのまま出す。
  if (/^[A-Za-z0-9_.:+\-?*=<>!/]+$/.test(value)) return value
  return JSON.stringify(value)
}

function defaultReportDir(): string {
  // `builder.ts` は `src/model-checker/lispauth/` 配下にあるので、3階層上が package root。
  // そこに `report/` を作ることで、ユーザー要望の `apps/static-analyzer/report/` をデフォルトにする。
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, "..", "..", "..", "report")
}

function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return s || "spec"
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
