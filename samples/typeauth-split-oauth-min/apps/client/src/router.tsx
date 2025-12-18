import { createBrowserRouter } from "react-router-dom";
import { Home } from "./screens/Home";
import { AuthCallback } from "./screens/AuthCallback";

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/auth/callback", element: <AuthCallback /> },
]);
