import { useMemo } from "react";

export function Debug() {
  const entries = useMemo(() => {
    const keys = [
      "demo_state",
      "demo_verifier",
      "demo_access_token",
      "demo_scope",
    ];
    return keys.map((k) => [k, sessionStorage.getItem(k)] as const);
  }, []);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Debug</h2>
      <p>sessionStorage の中身。</p>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td style={{ borderBottom: "1px solid #eee", padding: "6px 10px", fontFamily: "monospace" }}>{k}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: "6px 10px", fontFamily: "monospace" }}>{v ?? "(null)"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ opacity: 0.7, fontSize: 12 }}>
        NOTE: 静的解析の検証用に「どのキーに保存しているか」も固定しています。
      </p>
    </div>
  );
}
