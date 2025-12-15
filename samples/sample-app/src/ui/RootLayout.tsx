import { Outlet, Link, useLocation } from "react-router-dom";

export function RootLayout() {
  const loc = useLocation();
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <header style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>React Router 認可サーバー（擬似）</h1>
        <nav style={{ display: "flex", gap: 12 }}>
          <Link to="/">Home</Link>
          <Link to="/client">Client Demo</Link>
          <Link to="/debug">Debug</Link>
        </nav>
        <div style={{ marginLeft: "auto", opacity: 0.6, fontSize: 12 }}>{loc.pathname}</div>
      </header>
      <hr style={{ margin: "16px 0" }} />
      <Outlet />
    </div>
  );
}
