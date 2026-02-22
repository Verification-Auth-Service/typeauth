import { Location } from "./tree";
import { PEvent } from "./event";

export type ImportReport = {
  // import 元モジュール (例: "react-router", "@remix-run/node")
  source: string;
  // import 文そのもの。後で判定根拠を追いやすくするため残す。
  syntax: string;
};

export type FunctionReport = {
  id: string;
  name: string;
  kind: "function" | "method" | "arrow" | "constructor";
  loc: Location;
  signature?: string;
  events: PEvent[];
};

export type FileReport = {
  file: string;
  // framework 判定などの派生分析で使うため、import 情報を保持する。
  imports?: ImportReport[];
  functions: FunctionReport[];
};

export type AnalysisReport = {
  entry: string;
  tsconfigUsed?: string;
  files: FileReport[];
};
