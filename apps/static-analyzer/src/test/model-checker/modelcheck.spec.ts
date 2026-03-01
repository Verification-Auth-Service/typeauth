import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { buildLispauthDsl, compileSpec, modelCheck, q, writeLispauthDslReport } from "../../model-checker/lispauth"

const unsafeSpec = `
(spec OAuthPKCE
  (machine
    (states Start AuthStarted CodeReceived TokenIssued LoggedOut)
    (vars
      (session.state (maybe string))
      (session.verifier (maybe string))
      (session.stage (enum Start AuthStarted TokenIssued LoggedOut))
      (used-codes (set string))
      (now int))

    (event BeginAuth ()
      (when (or (= session.stage 'Start) (= session.stage 'LoggedOut)))
      (do
        (set session.state (fresh "state"))
        (set session.verifier (fresh "verifier"))
        (set session.stage 'AuthStarted))
      (goto 'AuthStarted))

    (event Callback ((code string) (state string))
      (when (= session.stage 'AuthStarted))
      (do (noop))
      (goto 'CodeReceived))

    (event ExchangeToken ((code string) (verifier string))
      (when (or (= session.stage 'AuthStarted) (= session.stage 'CodeReceived)))
      (require (= verifier session.verifier))
      (require (not (in code used-codes)))
      (do
        (set used-codes (add used-codes code))
        (set session.stage 'TokenIssued))
      (goto 'TokenIssued))

    (event Logout ()
      (when true)
      (do (set session.stage 'LoggedOut))
      (goto 'LoggedOut)))

  (env
    (scheduler worst)
    (allow reorder)
    (allow duplicate)
    (sessions 2)
    (allow cross-delivery)
    (time (max-steps 4) (tick 1)))

  (property
    (invariant callback-must-match-state
      (=> (and (= last.event 'Callback) last.transitioned)
          (= last.args.state session.state)))
    (counterexample (format trace) (minimize steps))))
`

const safeSpec = unsafeSpec
  .replace("(sessions 2)", "(sessions 1)")
  .replace("(allow cross-delivery)\n", "")
  .replace("(time (max-steps 4) (tick 1))", "(time (max-steps 2) (tick 1))")
  .replace(
  "(do (noop))",
  "(require (= state session.state))\n      (do (noop))",
)

describe("state-machine DSL model checker", () => {
  it("builds lispauth DSL text from a draft object", () => {
    const dsl = buildLispauthDsl({
      name: "Mini",
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
      env: { scheduler: "worst", sessions: 1, time: { maxSteps: 1, tick: 1 } },
      property: {
        invariants: [{ name: "stage-defined", expr: ["not", ["=", "session.stage", "null-never"]] }],
      },
    })

    expect(dsl).toContain("(spec Mini")
    expect(dsl).toContain("(event Finish")
    const compiled = compileSpec(dsl)
    expect(compiled.name).toBe("Mini")
    expect(compiled.events.map((e) => e.name)).toEqual(["Finish"])
  })

  it("writes built DSL to report-like directory with readable filename", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lispauth-report-"))
    const result = writeLispauthDslReport(
      {
        name: "OAuth PKCE Demo",
        machine: {
          states: ["Start", "Done"],
          vars: [{ name: "session.stage", type: ["enum", "Start", "Done"] }],
          events: [{ name: "Finish", do: [["set", "session.stage", q("Done")]], goto: "Done" }],
        },
      },
      {
        outDir,
        now: new Date("2026-02-25T10:30:45"),
      },
    )

    expect(result.fileName).toBe("lispauth-oauth-pkce-demo-20260225-103045.lispauth")
    expect(result.filePath.startsWith(outDir)).toBe(true)
    expect(fs.existsSync(result.filePath)).toBe(true)
    expect(fs.readFileSync(result.filePath, "utf8")).toBe(result.dsl)
  })

  it("parses and compiles the 3-block top-level spec", () => {
    const compiled = compileSpec(unsafeSpec)
    expect(compiled.name).toBe("OAuthPKCE")
    expect(compiled.events.map((e) => e.name)).toEqual(["BeginAuth", "Callback", "ExchangeToken", "Logout"])
    expect(compiled.env.sessions).toBe(2)
    expect(compiled.properties.invariants.map((i) => i.name)).toContain("callback-must-match-state")
  })

  it("finds a short counterexample when callback state check is missing", () => {
    const result = modelCheck(compileSpec(unsafeSpec))
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.invariant).toBe("callback-must-match-state")
    expect(result.trace.length).toBeGreaterThanOrEqual(2)
    const last = result.trace[result.trace.length - 1]
    expect(last.event).toBe("Callback")
    expect(last.transitioned).toBe(true)
  })

  it("does not violate callback-state invariant when require is present (bounded)", () => {
    const result = modelCheck(compileSpec(safeSpec))
    expect(result.ok).toBe(true)
  })
})
