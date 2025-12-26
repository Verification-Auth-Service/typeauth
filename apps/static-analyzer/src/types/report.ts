import { Location } from "./tree.js";
import { PEvent } from "./event.js";

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
  functions: FunctionReport[];
};

export type AnalysisReport = {
  entry: string;
  tsconfigUsed?: string;
  files: FileReport[];
};
