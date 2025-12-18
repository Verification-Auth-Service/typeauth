import { redirect, type LoaderFunctionArgs } from "react-router-dom";
import { exchangeCodeForToken } from "../lib/token";
import { clearState, clearVerifier, loadState, loadVerifier, saveToken } from "../lib/storage";

export type CallbackResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function handleAuthCallback({ request }: LoaderFunctionArgs): Promise<CallbackResult | Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return { ok: false, message: "Missing code/state" };
  }

  const expectedState = loadState();
  if (!expectedState || expectedState !== state) {
    return { ok: false, message: "State mismatch (possible CSRF)" };
  }

  const verifier = loadVerifier();
  if (!verifier) {
    return { ok: false, message: "Missing PKCE code_verifier" };
  }

  const r = await exchangeCodeForToken(code, verifier);
  if (!r.ok) {
    return { ok: false, message: `Token exchange failed: ${r.error} ${r.error_description ?? ""}` };
  }

  saveToken(r.access_token);
  clearVerifier();
  clearState();

  return redirect("/authed");
}
