import { sym } from "../../shared/syntax-node"
import type { SyntaxNode } from "../../shared/syntax-node"
import type { LispauthSpecDraft } from "../types"

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
  if (event.goto) out.push(["goto", sym(event.goto)])

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
