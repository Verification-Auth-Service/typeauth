#!/usr/bin/env node
import ts from "typescript";
import path from "node:path";
import fs from "node:fs";
import { analyze } from "./analyze/analyze";
import { errorMessageO } from "./helper/errorMessage.js";

/**
 * 目的:
 * - 引数で与えられたTS/TSXファイルを起点に Program + TypeChecker を作る
 * - 関数/メソッド単位で、分岐/ループ/例外/return/await/call を「イベント」として抽出
 * - 重要: 各イベントに型情報(可能ならsymbol/decl)を付与
 */

// ---- CLI
function main() {
  const entry = process.argv[2];
  if (!entry) {
    console.error("Usage: static-analyzer <entry-file.ts>");
    process.exit(2);
  }

  const report = analyze(entry);
  process.stdout.write(JSON.stringify(report, null, 2));
}

main();
