import fs from "node:fs"
import path from "node:path"
import { compileSpec, modelCheck } from "./model-checker/lispauth"

function usage(): string {
  return [
    "Usage:",
    "  pnpm run lispauth:check -- [--quiet] <spec-file.lispauth>",
    "",
    "Example:",
    "  pnpm run lispauth:check -- ./report/model-checker/lispauth/example.lispauth",
  ].join("\n")
}

function main() {
  const rawArgs = process.argv.slice(2)
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs
  const flags = new Set(args.filter((a) => a.startsWith("-")))
  const positional = args.filter((a) => !a.startsWith("-"))
  const specFile = positional[0]
  const verbose = !flags.has("--quiet")

  if (!specFile || flags.has("-h") || flags.has("--help")) {
    console.error(usage())
    process.exit(specFile ? 0 : 2)
  }

  const specPath = path.resolve(specFile)
  let source: string

  try {
    if (verbose) console.error(`[lispauth] reading ${specPath}`)
    source = fs.readFileSync(specPath, "utf8")
  } catch (error) {
    console.error(`Failed to read .lispauth file: ${specPath}`)
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }

  try {
    if (verbose) console.error("[lispauth] compiling spec")
    const compiled = compileSpec(source)
    if (verbose) {
      console.error(
        `[lispauth] model-check start: states=${compiled.states.length} events=${compiled.events.length} sessions=${compiled.env.sessions} maxSteps=${compiled.env.maxSteps}`,
      )
    }

    let lastProgressLog = 0
    const result = modelCheck(compiled, {
      onProgress(progress) {
        if (!verbose) return
        if (progress.phase === "start") return
        if (progress.phase === "explore") {
          if (progress.explored === 1 || progress.explored - lastProgressLog >= 100) {
            lastProgressLog = progress.explored
            console.error(
              `[lispauth] exploring explored=${progress.explored} queue=${progress.queueSize} step=${progress.step ?? "?"}`,
            )
          }
          return
        }
        if (progress.phase === "invariant-failed") {
          console.error(
            `[lispauth] violation detected invariant=${progress.invariant} explored=${progress.explored} step=${progress.step ?? "?"}`,
          )
          return
        }
        if (progress.phase === "done") {
          console.error(`[lispauth] completed explored=${progress.explored}`)
        }
      },
    })

    if (result.ok) {
      console.log(`OK ${path.relative(process.cwd(), specPath) || path.basename(specPath)}`)
      console.log(`explored=${result.explored}`)
      process.exit(0)
    }

    console.log(`VIOLATION ${result.invariant}`)
    console.log(`file=${path.relative(process.cwd(), specPath) || path.basename(specPath)}`)
    console.log(`explored=${result.explored}`)
    console.log(JSON.stringify(result.trace, null, 2))
    process.exit(1)
  } catch (error) {
    console.error(`Failed to compile or model-check: ${specPath}`)
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(2)
  }
}

main()
