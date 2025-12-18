import React from "react";
import { useLoaderData } from "react-router-dom";
import type { CallbackResult } from "../routes/authCallback";

export function CallbackScreen() {
  const data = useLoaderData() as CallbackResult;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h2>Auth callback</h2>
      <p>{data.ok ? "Redirecting..." : data.message}</p>
      {!data.ok && (
        <p style={{ marginTop: 12 }}>
          state mismatch / verifier missing / token exchange failure などの NG 状態がここに出ます。
        </p>
      )}
    </div>
  );
}
