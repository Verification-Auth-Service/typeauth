import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { exchangeCodeForToken } from "../lib/token";
import { clearState, clearVerifier, loadState, loadVerifier, saveToken } from "../lib/storage";

export function AuthCallback() {
  const nav = useNavigate();
  const [msg, setMsg] = useState<string>("Processing...");

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        setMsg("Missing code/state");
        return;
      }

      const expectedState = loadState();
      if (!expectedState || expectedState !== state) {
        setMsg("State mismatch (possible CSRF)");
        return;
      }

      const verifier = loadVerifier();
      if (!verifier) {
        setMsg("Missing PKCE code_verifier");
        return;
      }

      const r = await exchangeCodeForToken(code, verifier);
      if (!r.ok) {
        setMsg(`Token exchange failed: ${r.error} ${r.error_description ?? ""}`);
        return;
      }

      saveToken(r.access_token);
      clearVerifier();
      clearState();
      setMsg("Login successful. Redirecting...");

      nav("/", { replace: true });
    })();
  }, [nav]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h2>Auth callback</h2>
      <p>{msg}</p>
    </div>
  );
}
