import fs from "node:fs"
import path from "node:path"
import { compileSpec, modelCheck } from "./model-checker/lispauth"

// 最小 CLI の usage。
// `pnpm run <script> -- ...` 前提のため、区切りの `--` を例示しておく。
/**
 * 入力例: `usage()`
 * 成果物: 実行方法を複数行でまとめたヘルプ文字列を返す。
 */
function usage(): string {
  return [
    "Usage:",
    "  pnpm run lispauth:check -- [--quiet] <spec-file.lispauth>",
    "",
    "Example:",
    "  pnpm run lispauth:check -- ./report/model-checker/lispauth/example.lispauth",
  ].join("\n")
}

/**
 * 入力例: `main()`
 * 成果物: 副作用のみを実行する（戻り値なし）。
 */
function main() {
  // node/tsx が渡す先頭 2 要素 (`node`, scriptPath) を除外する。
  const rawArgs = process.argv.slice(2)

  // `pnpm run lispauth:check -- <args>` の場合、`--` 自体が argv に残ることがある。
  // そのまま解釈すると `"--"` をファイル名扱いしてしまうため、先頭にある場合のみ剥がす。
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs

  // ここでは簡易パーサとして「`-` 始まりは flag / それ以外は位置引数」に分ける。
  // 位置引数は最初の 1 つだけ使い、残りは現時点では無視する。
  const flags = new Set(args.filter((a) => a.startsWith("-")))
  const positional = args.filter((a) => !a.startsWith("-"))
  const specFile = positional[0]
  const verbose = !flags.has("--quiet")

  // `--help` は終了コード 0、引数不足は 2 (usage error) に分ける。
  // シェルスクリプトや CI から呼ぶときに判定しやすくするため。
  if (!specFile || flags.has("-h") || flags.has("--help")) {
    console.error(usage())
    process.exit(specFile ? 0 : 2)
  }

  const specPath = path.resolve(specFile)
  let source: string

  try {
    // 進捗ログは stderr に出し、結果本体 (OK/VIOLATION/trace) は stdout に出す。
    // これにより `stdout` のみを JSON/ログ収集へ流しやすくなる。
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

    // 探索開始時に規模感を出しておくと、時間がかかるケースで「止まっているのか / 探索中か」を判断しやすい。
    if (verbose) {
      console.error(
        `[lispauth] model-check start: states=${compiled.states.length} events=${compiled.events.length} sessions=${compiled.env.sessions} maxSteps=${compiled.env.maxSteps}`,
      )
    }

    let lastProgressLog = 0
    const result = modelCheck(compiled, {
      onProgress(progress) {
        if (!verbose) return

        // `start` は直前に CLI 側でより詳細な開始ログを出しているため抑制。
        if (progress.phase === "start") return
        if (progress.phase === "explore") {
          // 全状態で出すと大量ログになるため、初回 + 100 件ごとの間引きにする。
          if (progress.explored === 1 || progress.explored - lastProgressLog >= 100) {
            lastProgressLog = progress.explored
            console.error(
              `[lispauth] exploring explored=${progress.explored} queue=${progress.queueSize} step=${progress.step ?? "?"}`,
            )
          }
          return
        }
        if (progress.phase === "invariant-failed") {
          // 失敗時は最終結果の前に stderr 側でも一報を出す。
          // 長い trace 出力の前に、どの invariant が落ちたかを視認しやすくするため。
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
      // 終了コード 0: 反例未検出 (bounded check の範囲内で OK)
      console.log(`OK ${path.relative(process.cwd(), specPath) || path.basename(specPath)}`)
      console.log(`explored=${result.explored}`)
      process.exit(0)
    }

    // 終了コード 1: invariant violation を検出
    // trace は stdout に JSON で出して、後処理しやすくしている。
    console.log(`VIOLATION ${result.invariant}`)
    console.log(`file=${path.relative(process.cwd(), specPath) || path.basename(specPath)}`)
    console.log(`explored=${result.explored}`)
    console.log(JSON.stringify(result.trace, null, 2))
    process.exit(1)
  } catch (error) {
    // 終了コード 2: I/O 以外の実行失敗 (構文エラー・未対応 DSL・内部例外など)
    console.error(`Failed to compile or model-check: ${specPath}`)
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(2)
  }
}

// 非同期処理を使っていないため同期 main を直接呼ぶ。
main()
