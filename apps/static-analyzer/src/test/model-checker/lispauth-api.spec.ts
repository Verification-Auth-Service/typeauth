import { describe, expect, it } from "vitest"
import {
  buildLispauthDsl,
  buildSpecSyntax,
  compileSpec,
  modelCheck,
  parseSyntax,
  q,
  renderSyntax,
  type LispauthSpecDraft,
  type ModelCheckResult,
} from "../../model-checker/lispauth"

describe("lispauth public API: parser / renderer / compiler / engine", () => {
  describe("parseSyntax(input) => SyntaxNode", () => {
    it("parses comments, quoted symbols, booleans, null and numbers", () => {
      const input = `
; spec-level comment
(spec Demo
  (machine
    (states Start Done)
    (vars (session.stage (enum Start Done)) (now int))
    (event Finish ()
      (when (= session.stage 'Start))
      (do (set session.stage 'Done))
      (goto 'Done)))
  (env (sessions 1) (time (max-steps 2) (tick 1)))
  (property
    (invariant end-or-start
      (or (= session.stage 'Start) (= session.stage 'Done)))
    (invariant bool-num-null-example (and true (= 1 1) (= null null)))))
`

      const ast = parseSyntax(input)
      expect(Array.isArray(ast)).toBe(true)
      expect((ast as unknown[])[0]).toBe("spec")
      expect(renderSyntax(ast)).toContain("'Done")
      expect(renderSyntax(ast)).toContain("true")
      expect(renderSyntax(ast)).toContain("null")
      expect(renderSyntax(ast)).toContain("1")
    })

    it("throws when root has extra tokens", () => {
      expect(() => parseSyntax("(spec A) (spec B)")).toThrow("Extra tokens after root")
    })
  })

  describe("buildSpecSyntax(draft) / renderSyntax(node)", () => {
    it("builds top-level spec AST with machine/env/property blocks", () => {
      const node = buildSpecSyntax({
        name: "CompileExample",
        machine: {
          states: ["Start", "Done"],
          vars: [
            { name: "session.stage", type: ["enum", "Start", "Done"] },
            { name: "used-codes", type: ["set", "string"] },
          ],
          events: [
            {
              name: "Finish",
              params: [{ name: "code", type: "string" }],
              when: ["=", "session.stage", q("Start")],
              require: [["not", ["in", "code", "used-codes"]]],
              do: [
                ["set", "used-codes", ["add", "used-codes", "code"]],
                ["set", "session.stage", q("Done")],
              ],
              goto: "Done",
            },
          ],
        },
        env: {
          scheduler: "worst",
          allow: ["reorder", "duplicate"],
          sessions: 1,
          time: { maxSteps: 2, tick: 1 },
        },
        property: {
          invariants: [
            {
              name: "stage-is-known",
              expr: ["or", ["=", "session.stage", q("Start")], ["=", "session.stage", q("Done")]],
            },
          ],
          counterexample: { format: "trace", minimize: "steps" },
        },
      })

      const rendered = renderSyntax(node)
      expect(rendered).toContain("(spec CompileExample")
      expect(rendered).toContain("(event Finish")
      expect(rendered).toContain("(counterexample")
      expect(rendered).toContain("(minimize steps)")
    })

    it("quotes atoms containing spaces and keeps symbol atoms quoted", () => {
      const rendered = renderSyntax(["endpoint", "https://example.com/callback with space", q("AuthStarted")])
      expect(rendered).toBe("(endpoint \"https://example.com/callback with space\" 'AuthStarted)")
    })
  })

  describe("compileSpec(source) => CompiledSpec", () => {
    it("compiles env flags and event details into executable structure", () => {
      const spec = compileSpec(`
(spec Compiled
  (machine
    (states Start Done)
    (vars
      (session.stage (enum Start Done))
      (used-codes (set string))
      (now int))
    (event Finish ((code string))
      (when (= session.stage 'Start))
      (require (not (in code used-codes)))
      (do (set used-codes (add used-codes code)) (set session.stage 'Done))
      (goto 'Done)))
  (env
    (allow reorder)
    (allow duplicate)
    (allow cross-delivery)
    (sessions 2)
    (time (max-steps 7) (tick 2)))
  (property
    (invariant known-stage (or (= session.stage 'Start) (= session.stage 'Done)))
    (counterexample (format trace) (minimize steps))))
`)

      expect(spec.name).toBe("Compiled")
      expect(spec.env).toEqual({
        sessions: 2,
        maxSteps: 7,
        tick: 2,
        allowDuplicate: true,
        allowReorder: true,
        allowCrossDelivery: true,
      })
      expect(spec.events[0]).toMatchObject({
        name: "Finish",
        params: [{ name: "code", type: "string" }],
        gotoState: "Done",
      })
      expect(spec.properties.counterexample).toEqual({ format: "trace", minimizeSteps: true })
    })

    it("throws for unsupported var type", () => {
      expect(() =>
        compileSpec(`
(spec Broken
  (machine
    (states Start)
    (vars (session.stage float))
    (event Nop ()))
  (env)
  (property))
`),
      ).toThrow("Invalid type")
    })
  })

  describe("modelCheck(compiled) => ModelCheckResult", () => {
    it("returns failing invariant and a concrete trace when rule can be violated", () => {
      const compiled = compileSpec(`
(spec Unsafe
  (machine
    (states Start TokenIssued)
    (vars (session.stage (enum Start TokenIssued)) (session.verifier (maybe string)) (now int))
    (event Issue ((verifier string))
      (when (= session.stage 'Start))
      (do (set session.stage 'TokenIssued))
      (goto 'TokenIssued)))
  (env (sessions 1) (time (max-steps 1) (tick 1)))
  (property
    (invariant verifier-required
      (=> (= session.stage 'TokenIssued)
          (not (= session.verifier null))))))
`)

      const result = modelCheck(compiled)
      expect(result.ok).toBe(false)
      if (result.ok) return

      expect(result.invariant).toBe("verifier-required")
      expect(result.trace.length).toBeGreaterThan(0)
      const last = result.trace[result.trace.length - 1]
      expect(last.event).toBe("Issue")
      expect(last.transitioned).toBe(true)
    })

    it("returns ok for bounded safe flow", () => {
      const compiled = compileSpec(`
(spec Safe
  (machine
    (states Start TokenIssued)
    (vars (session.stage (enum Start TokenIssued)) (session.verifier (maybe string)) (now int))
    (event Issue ((verifier string))
      (when (= session.stage 'Start))
      (do
        (set session.verifier verifier)
        (set session.stage 'TokenIssued))
      (goto 'TokenIssued)))
  (env (sessions 1) (time (max-steps 1) (tick 1)))
  (property
    (invariant verifier-required
      (=> (= session.stage 'TokenIssued)
          (not (= session.verifier null))))))
`)

      const result: ModelCheckResult = modelCheck(compiled)
      expect(result.ok).toBe(true)
      if (!result.ok) {
        throw new Error(`unexpected counterexample: ${JSON.stringify(result.trace)}`)
      }
      expect(result.explored).toBeGreaterThan(0)
    })
  })

  describe("buildLispauthDsl(draft) => string", () => {
    it("builds commented DSL that can be compiled back", () => {
      const draft: LispauthSpecDraft = {
        name: "RoundTrip",
        machine: {
          states: ["Start", "Done"],
          vars: [
            { name: "session.stage", type: ["enum", "Start", "Done"] },
            { name: "now", type: "int" },
          ],
          events: [
            {
              name: "Finish",
              when: ["=", "session.stage", q("Start")],
              do: [["set", "session.stage", q("Done")]],
              goto: "Done",
            },
          ],
        },
        env: { sessions: 1, time: { maxSteps: 1, tick: 1 } },
        property: {
          invariants: [
            {
              name: "known-stage",
              expr: ["or", ["=", "session.stage", q("Start")], ["=", "session.stage", q("Done")]],
            },
          ],
        },
      }

      const dsl = buildLispauthDsl(draft)
      expect(dsl).toContain("; - 状態機械")
      expect(dsl).toContain("(event Finish")

      const compiled = compileSpec(dsl)
      expect(compiled.name).toBe("RoundTrip")
      expect(compiled.events.map((event) => event.name)).toEqual(["Finish"])
    })
  })
})
