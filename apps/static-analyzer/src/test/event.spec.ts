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

  it("session / db / form の入出力イベントを抽出できる", () => {
    const code = `
      async function action(request: Request) {
        const session = await getSession(request);
        const state = session.get("oauth:state");
        session.set("oauth:state", "next-state");
        await commitSession(session);

        const formData = await request.formData();
        const grantType = String(formData.get("grant_type") ?? "").trim();
        formData.set("scope", "read");

        await prisma.user.findUnique({ where: { id: "u1" } });
        await prisma.user.upsert({
          where: { id: "u1" },
          update: { state },
          create: { id: "u1", state: grantType },
        });
      }
    `;
    const sourceFile = createSourceFile(code);
    const checker = createChecker(sourceFile);
    const out: PEvent[] = extractEvents(checker, sourceFile, sourceFile, []);

    const sessionOps = out.filter((e): e is Extract<PEvent, { kind: "sessionOp" }> => e.kind === "sessionOp");
    expect(sessionOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "load", api: "getSession" }),
        expect.objectContaining({ operation: "get", api: "session.get", key: "\"oauth:state\"" }),
        expect.objectContaining({ operation: "set", api: "session.set", key: "\"oauth:state\"", value: "\"next-state\"" }),
        expect.objectContaining({ operation: "commit", api: "commitSession" }),
      ]),
    );

    const formOps = out.filter((e): e is Extract<PEvent, { kind: "formOp" }> => e.kind === "formOp");
    expect(formOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "load", api: "request.formData" }),
        expect.objectContaining({ operation: "get", api: "formData.get", field: "\"grant_type\"" }),
        expect.objectContaining({ operation: "set", api: "formData.set", field: "\"scope\"", value: "\"read\"" }),
      ]),
    );

    const dbOps = out.filter((e): e is Extract<PEvent, { kind: "dbOp" }> => e.kind === "dbOp");
    expect(dbOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "read",
          api: "prisma.user.findUnique",
          method: "findUnique",
          clientExpr: "prisma.user",
          model: "user",
        }),
        expect.objectContaining({
          operation: "write",
          api: "prisma.user.upsert",
          method: "upsert",
          clientExpr: "prisma.user",
          model: "user",
        }),
      ]),
    );
  });
});
