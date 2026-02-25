import { describe, expect, it } from "vitest"
import { compileSpec, modelCheck } from "../../model-checker/lispauth"

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
