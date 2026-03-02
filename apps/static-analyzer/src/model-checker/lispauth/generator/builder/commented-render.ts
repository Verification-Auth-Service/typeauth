import { sym } from "../../shared/syntax-node"
import type { SyntaxNode } from "../../shared/syntax-node"
import type { LispauthDslBuildOptions, LispauthSpecDraft } from "../types"
import { renderSyntax } from "./syntax"

export function renderCommentedLispauthDsl(draft: LispauthSpecDraft, options: LispauthDslBuildOptions = {}): string {
  const lines: string[] = []

  pushComment(lines, 0, "仕様定義の開始（spec 名はレビュー単位の識別子）")
  pushLine(lines, 0, `(spec ${renderAtom(draft.name)}`)

  renderCommentedMachineSection(lines, draft, options)
  renderCommentedHttpSection(lines, draft)
  renderCommentedEnvSection(lines, draft)
  renderCommentedPropertySection(lines, draft)

  pushLine(lines, 0, ")")
  return lines.join("\n")
}

function renderCommentedMachineSection(lines: string[], draft: LispauthSpecDraft, options: LispauthDslBuildOptions): void {
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

  const compactLinearTransitions = options.compactLinearTransitions ?? true
  if (!compactLinearTransitions) {
    for (const event of draft.machine.events) renderCommentedEvent(lines, event)
  } else {
    const grouped = groupLinearEvents(draft.machine.events)
    for (const item of grouped) {
      if (item.kind === "chain") {
        renderCommentedChain(lines, item.events)
        continue
      }
      renderCommentedEvent(lines, item.event)
    }
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
    pushRendered(lines, 3, ["goto", sym(event.goto)])
  }

  pushLine(lines, 2, ")")
}

function renderCommentedChain(
  lines: string[],
  events: Array<LispauthSpecDraft["machine"]["events"][number]>,
): void {
  pushComment(lines, 2, `一本道遷移を chain で集約（${events.length} イベント）`)
  pushLine(lines, 2, "(chain")
  for (const event of events) {
    const edge = asLinearStageEdge(event)
    if (!edge) continue
    pushRendered(lines, 3, [event.name, sym(edge.from), "->", sym(edge.to)])
  }
  pushLine(lines, 2, ")")
}

function groupLinearEvents(
  events: Array<LispauthSpecDraft["machine"]["events"][number]>,
): Array<{ kind: "single"; event: LispauthSpecDraft["machine"]["events"][number] } | { kind: "chain"; events: Array<LispauthSpecDraft["machine"]["events"][number]> }> {
  const out: Array<
    { kind: "single"; event: LispauthSpecDraft["machine"]["events"][number] } | { kind: "chain"; events: Array<LispauthSpecDraft["machine"]["events"][number]> }
  > = []

  let i = 0
  while (i < events.length) {
    const first = asLinearStageEdge(events[i])
    if (!first) {
      out.push({ kind: "single", event: events[i] })
      i += 1
      continue
    }

    const chain: Array<LispauthSpecDraft["machine"]["events"][number]> = [events[i]]
    let prevTo = first.to
    let j = i + 1
    while (j < events.length) {
      const next = asLinearStageEdge(events[j])
      if (!next || next.from !== prevTo) break
      chain.push(events[j])
      prevTo = next.to
      j += 1
    }

    if (chain.length >= 2) {
      out.push({ kind: "chain", events: chain })
      i = j
      continue
    }

    out.push({ kind: "single", event: events[i] })
    i += 1
  }

  return out
}

function asLinearStageEdge(
  event: LispauthSpecDraft["machine"]["events"][number],
): { from: string; to: string } | undefined {
  if ((event.params?.length ?? 0) !== 0) return undefined
  if ((event.require?.length ?? 0) !== 0) return undefined
  if (!event.when || !event.do || !event.goto) return undefined
  if (event.do.length !== 1) return undefined

  const when = event.when
  if (!Array.isArray(when) || when[0] !== "=" || when[1] !== "session.stage") return undefined
  const from = asStateAtom(when[2])
  if (!from) return undefined

  const op = event.do[0]
  if (!Array.isArray(op) || op[0] !== "set" || op[1] !== "session.stage") return undefined
  const to = asStateAtom(op[2])
  if (!to) return undefined
  if (event.goto !== to) return undefined

  return { from, to }
}

function asStateAtom(node: SyntaxNode): string | undefined {
  if (typeof node === "string") return node
  if (node && typeof node === "object" && "name" in node && typeof node.name === "string") return node.name
  return undefined
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

function renderAtom(value: string): string {
  if (/^[A-Za-z0-9_.:+\-?*=<>!/]+$/.test(value)) return value
  return JSON.stringify(value)
}
