import { describe, expect, it } from "vitest";
import { reactRouterRoutePathFromFile } from "../framework/react-router";

describe("reactRouterRoutePathFromFile", () => {
  it("normalizes common React Router file-route patterns", () => {
    expect(reactRouterRoutePathFromFile("/repo/app/routes/login.tsx")).toBe("/login");
    expect(reactRouterRoutePathFromFile("/repo/app/routes/_index.tsx")).toBe("/");
    expect(reactRouterRoutePathFromFile("/repo/app/routes/oauth.authorize.tsx")).toBe("/oauth/authorize");
    expect(reactRouterRoutePathFromFile("/repo/app/routes/auth+/github+/_index.tsx")).toBe("/auth/github");
    expect(reactRouterRoutePathFromFile("/repo/app/routes/posts.$id.tsx")).toBe("/posts/:id");
    expect(reactRouterRoutePathFromFile("/repo/app/routes/_auth.login.tsx")).toBe("/login");
  });

  it("preserves escaped dot literals in route segments", () => {
    expect(reactRouterRoutePathFromFile("/repo/app/routes/sitemap[.]xml.tsx")).toBe("/sitemap.xml");
  });
});
