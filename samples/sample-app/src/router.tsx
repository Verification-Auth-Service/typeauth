import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./ui/RootLayout";
import { Home } from "./ui/Home";
import { Authorize } from "./ui/Authorize";
import { Login } from "./ui/Login";
import { Consent } from "./ui/Consent";
import { ClientDemo } from "./ui/ClientDemo";
import { Callback } from "./ui/Callback";
import { Tokens } from "./ui/Tokens";
import { Debug } from "./ui/Debug";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Home /> },

      // ---- Auth server side (simulated with React Router pages) ----
      { path: "authorize", element: <Authorize /> },
      { path: "login", element: <Login /> },
      { path: "consent", element: <Consent /> },

      // ---- Client side (demo app, same origin for simplicity) ----
      { path: "client", element: <ClientDemo /> },
      { path: "callback", element: <Callback /> },
      { path: "tokens", element: <Tokens /> },

      // ---- Debug ----
      { path: "debug", element: <Debug /> },
    ],
  },
]);
