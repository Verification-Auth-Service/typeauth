import { type LoaderFunctionArgs, redirect } from "react-router-dom";
import { loadToken } from "../lib/storage";
import { fetchMe } from "../lib/resource";

export type AuthedData =
  | { ok: true; me: unknown }
  | { ok: false; error: string; status?: number; detail?: unknown };

export async function requireAuthed(_args: LoaderFunctionArgs): Promise<AuthedData | Response> {
  const token = loadToken();
  if (!token) {
    return redirect("/");
  }

  const r = await fetchMe(token);
  if (!r.ok) {
    return { ok: false, error: "Resource server rejected token", status: r.status, detail: r.json };
  }

  return { ok: true, me: r.json };
}
