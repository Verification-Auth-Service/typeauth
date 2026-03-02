import type { CompiledSpec, ModelCheckResult } from "../types"
import { evalExpr, truthy } from "./expr"
import { createInitialState, stableStateKey } from "./state"
import { generateNextStates } from "./transition"

type ModelCheckProgress = {
  phase: "start" | "explore" | "invariant-failed" | "done"
  explored: number
  queueSize: number
  step?: number
  invariant?: string
}

type ModelCheckOptions = {
  onProgress?: (progress: ModelCheckProgress) => void
}

/**
 * コンパイル済み仕様に対して到達探索を行い、不変条件を検証する。
 *
 * @param spec `compileSpec()` が返した `CompiledSpec`。
 * 例: `{ states, vars, events, env: { sessions: 2, maxSteps: 8, tick: 1 }, properties: { invariants: [...] } }`
 * @param options 進捗通知フック。例:
 * `{ onProgress: (p) => console.log(p.phase, p.explored) }`
 * @returns 検証結果。例:
 * 成功: `{ ok: true, explored: 42 }`
 * 失敗: `{ ok: false, explored: 17, invariant: "callback-must-match-state", trace: [...] }`
 */
export function modelCheck(spec: CompiledSpec, options: ModelCheckOptions = {}): ModelCheckResult {
  const init = createInitialState(spec)
  const queue = [init]

  const seen = new Set<string>()
  let explored = 0
  options.onProgress?.({ phase: "start", explored, queueSize: queue.length, step: init.step })

  while (queue.length) {
    const current = queue.shift()!
    const key = stableStateKey(current)

    if (seen.has(key)) continue
    seen.add(key)
    explored += 1
    options.onProgress?.({ phase: "explore", explored, queueSize: queue.length, step: current.step })

    for (const invariant of spec.properties.invariants) {
      const ok = truthy(evalExpr(invariant.expr, current, current.last.session ?? 0))
      if (!ok) {
        options.onProgress?.({
          phase: "invariant-failed",
          explored,
          queueSize: queue.length,
          step: current.step,
          invariant: invariant.name,
        })
        return {
          ok: false,
          explored,
          invariant: invariant.name,
          trace: current.trace,
        }
      }
    }

    if (current.step >= spec.env.maxSteps) continue

    const nextStates = generateNextStates(spec, current)
    for (const nextState of nextStates) queue.push(nextState)
  }

  options.onProgress?.({ phase: "done", explored, queueSize: queue.length, step: spec.env.maxSteps })
  return { ok: true, explored }
}
