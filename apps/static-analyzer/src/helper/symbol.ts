import { locOf } from "./locOf";
import { SymbolInfo } from "../types/tree";
import ts from "typescript";

/**
 * 入力例: `isSingleBit(1)`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function isSingleBit(v: number): boolean {
  return v > 0 && (v & (v - 1)) === 0;
}

/**
 * 入力例: `symbolFlagLabels(ts.SymbolFlags.Function)`
 * 成果物: SymbolFlags のビット名配列を昇順で返す。
 */
function symbolFlagLabels(flags: ts.SymbolFlags): NonNullable<SymbolInfo["flagsLabels"]> {
  const pairs: Array<{ name: string; value: number }> = [];

  for (const [k, v] of Object.entries(ts.SymbolFlags)) {
    if (typeof v !== "number") continue;
    // 合成フラグは除外し、基本ビットだけを分解対象にする。
    if (!isSingleBit(v)) continue;
    if ((flags & v) !== v) continue;
    pairs.push({ name: k, value: v });
  }

  // 数値順にしておくと出力の安定性が高く、diff が見やすい。
  pairs.sort((a, b) => a.value - b.value);
  return pairs.map((p) => p.name) as NonNullable<SymbolInfo["flagsLabels"]>;
}

// シンボル情報を取得
/**
 * 入力例: `symbolInfo(program.getTypeChecker(), ts.factory.createIdentifier("x"))`
 * 成果物: シンボル名・種別・宣言位置を含む情報オブジェクトを返す。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
export function symbolInfo(checker: ts.TypeChecker, node: ts.Node): SymbolInfo | undefined {
  // AST の形によって `getSymbolAtLocation` の当たり方が変わるため、
  // 代表的なパターンをフォールバックで吸収する。
  // - property access: `obj.method` のとき `method` 側で取れる場合がある
  // - identifier: 単純識別子はそのまま
  const sym =
    checker.getSymbolAtLocation(node) ??
    (ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name) : undefined) ??
    (ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined);

  if (!sym) return undefined;

  const decls = (sym.declarations ?? []).map((d) => locOf(d.getSourceFile(), d));
  const rawFlags = Number(sym.flags);
  const labels = symbolFlagLabels(sym.flags);
  return {
    name: checker.symbolToString(sym),
    // SymbolFlags はビットフラグなので、生値と分解済みラベルを両方持たせる。
    flagsRaw: rawFlags,
    flagsLabels: labels.length ? labels : undefined,
    declarations: decls.length ? decls : undefined,
  };
}
