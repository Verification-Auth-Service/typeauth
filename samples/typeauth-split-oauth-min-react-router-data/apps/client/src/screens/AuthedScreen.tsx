import React from "react";
import { Link, useLoaderData } from "react-router-dom";
import type { AuthedData } from "../routes/requireAuthed";

export function AuthedScreen() {
  const data = useLoaderData() as AuthedData;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 820, margin: "0 auto" }}>
      <h2>/authed</h2>

      <div style={{ marginTop: 12 }}>
        <Link to="/"><button>Back</button></Link>
      </div>

      <div style={{ marginTop: 18 }}>
        <h3>Loader result</h3>
        <pre style={{ background: "#f6f6f6", padding: 12, overflowX: "auto" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>

      {!data.ok && (
        <p style={{ marginTop: 12 }}>
          ここが NG 状態（TokenVerified 失敗）になります。401 などが detail に出ます。
        </p>
      )}
    </div>
  );
}
