import { createBrowserRouter } from "react-router-dom";
import { Home } from "./screens/Home";
import { CallbackScreen } from "./screens/CallbackScreen";
import { AuthedScreen } from "./screens/AuthedScreen";
import { startAuthRedirect } from "./routes/startAuth";
import { handleAuthCallback } from "./routes/authCallback";
import { requireAuthed } from "./routes/requireAuthed";

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/auth/start", loader: startAuthRedirect, element: <div /> },
  { path: "/auth/callback", loader: handleAuthCallback, element: <CallbackScreen /> },
  { path: "/authed", loader: requireAuthed, element: <AuthedScreen /> },
]);
