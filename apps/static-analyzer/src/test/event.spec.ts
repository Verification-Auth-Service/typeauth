import { extractEvents } from "../analyze/event";
import { PEvent } from "../types/event";
import { describe, it, expect } from "vitest";
import { createSourceFile, createChecker } from "./helper/create";

describe("extractEventsのテスト", () => {
  it("if文のイベント抽出", () => {
    const code = `
      function test(x: number) {
        if (x > 0) {
          console.log("positive");
        } else {
          console.log("non-positive");
        }
      }
    `;
    const sourceFile = createSourceFile(code);
    const checker = createChecker(sourceFile);
    const out: PEvent[] = extractEvents(checker, sourceFile, sourceFile, []);

    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(["if", "blockEnter", "call", "blockExit", "blockEnter", "call", "blockExit"]);
  });

  it("for文のイベント抽出", () => {
    const code = `
      function test() {
        for (let i = 0; i < 5; i++) {
          console.log(i);
        }
      }
    `;
    const sourceFile = createSourceFile(code);
    const checker = createChecker(sourceFile);
    const out: PEvent[] = extractEvents(checker, sourceFile, sourceFile, []);

    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(["loop", "blockEnter", "call", "blockExit"]);
  });

  it("Auth系でよくあるリダイレクトを専用イベントとして抽出", () => {
    const code = `
      function guard(ok: boolean) {
        if (!ok) {
          return redirect("/login");
        }
        window.location.href = "/home";
      }
    `;
    const sourceFile = createSourceFile(code);
    const checker = createChecker(sourceFile);
    const out: PEvent[] = extractEvents(checker, sourceFile, sourceFile, []);

    const redirects = out.filter((e) => e.kind === "redirect");
    expect(redirects).toHaveLength(2);

    expect(redirects[0]).toMatchObject({
      kind: "redirect",
      via: "call",
      api: "redirect",
      target: "\"/login\"",
    });
    expect(redirects[1]).toMatchObject({
      kind: "redirect",
      via: "assign",
      api: "window.location.href",
      target: "\"/home\"",
    });
  });

  it("OAuth authorize URL の searchParams.set と redirect options(headers) を拾える", () => {
    const code = `
      async function startAuth(state: string, challenge: string) {
        const authorizeUrl = new URL(requireEnv("AUTHORIZE_URL"));
        authorizeUrl.searchParams.set("client_id", requireEnv("GITHUB_CLIENT_ID"));
        authorizeUrl.searchParams.set("redirect_uri", getRedirectUri());
        authorizeUrl.searchParams.set("state", state);
        authorizeUrl.searchParams.set("code_challenge", challenge);
        authorizeUrl.searchParams.set("code_challenge_method", "S256");

        const setCookie = await commitSession(session, { maxAge: 60 * 10 });
        return redirect(authorizeUrl.toString(), {
          headers: {
            "Set-Cookie": setCookie,
          },
        });
      }
    `;
    const sourceFile = createSourceFile(code);
    const checker = createChecker(sourceFile);
    const out: PEvent[] = extractEvents(checker, sourceFile, sourceFile, []);

    const paramSets = out.filter((e) => e.kind === "urlParamSet");
    expect(paramSets).toHaveLength(5);
    expect(paramSets[0]).toMatchObject({
      kind: "urlParamSet",
      urlExpr: "authorizeUrl",
      key: "\"client_id\"",
      value: "requireEnv(\"GITHUB_CLIENT_ID\")",
    });
    expect(paramSets[4]).toMatchObject({
      kind: "urlParamSet",
      key: "\"code_challenge_method\"",
      value: "\"S256\"",
    });

    const redirects = out.filter((e) => e.kind === "redirect");
    expect(redirects).toHaveLength(1);
    expect(redirects[0]).toMatchObject({
      kind: "redirect",
      via: "call",
      api: "redirect",
      target: "authorizeUrl.toString()",
      headerKeys: ["Set-Cookie"],
    });
  });
});
