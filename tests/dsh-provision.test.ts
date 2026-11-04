import assert from "node:assert/strict";
import test from "node:test";
import { ensureDshDeskSession, provisionDshDesk } from "../lib/dsh";

const input = { baseUrl: "http://127.0.0.1:3080", token: "launch-token" };

type RpcBody = {
  method?: string;
  payload?: { args?: { request?: Record<string, unknown> } };
};

function deskFetch(options: {
  list: Array<{ sessionId: string; title?: string; running?: boolean }>;
  createId?: string;
  catalog?: "fail";
  onCreate?: (request: Record<string, unknown> | undefined) => void;
}): typeof fetch {
  return (async (target: string | URL, init?: RequestInit) => {
    const url = String(target);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh-auth=v1; Path=/" } });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as RpcBody;
    if (body.method === "session/list") return Response.json({ items: options.list });
    if (body.method === "session/modelCatalog") {
      if (options.catalog === "fail") return new Response("catalog down", { status: 500 });
      return Response.json({ routableProviders: [], groups: [] });
    }
    if (body.method === "session/create") {
      options.onCreate?.(body.payload?.args?.request);
      return Response.json(options.createId ? { sessionId: options.createId } : {});
    }
    return new Response("no", { status: 500 });
  }) as typeof fetch;
}

test("provision creates a new session even when others already exist", async () => {
  let request: Record<string, unknown> | undefined;
  const result = await provisionDshDesk(input, {
    fetchImpl: deskFetch({
      list: [{ sessionId: "old-one", title: "旧对话", running: false }],
      createId: "weidu-new",
      onCreate(value) {
        request = value;
      },
    }),
  });
  assert.equal(result.dedicatedSession.sessionId, "weidu-new");
  assert.equal(result.dedicatedSession.title, "围读");
  assert.notEqual(result.dedicatedSession.sessionId, "old-one");
  assert.deepEqual(request, {});
  assert.equal(result.sessions[0]?.sessionId, "weidu-new");
  assert.equal(result.sessions.some((item) => item.sessionId === "old-one"), true);
});

test("provision still creates a session when the kernel has none", async () => {
  const result = await provisionDshDesk(input, {
    fetchImpl: deskFetch({ list: [], createId: "weidu-empty", catalog: "fail" }),
  });
  assert.equal(result.dedicatedSession.sessionId, "weidu-empty");
  assert.equal(result.catalog.loaded, false);
  assert.equal(result.sessions.length, 1);
});

test("provision refuses to adopt an id the kernel already listed", async () => {
  await assert.rejects(
    () => provisionDshDesk(input, { fetchImpl: deskFetch({ list: [{ sessionId: "old-one" }], createId: "old-one" }) }),
    (error: Error) => {
      assert.match(error.message, /不会改用已有会话/);
      assert.equal(error.message.includes("old-one"), false);
      return true;
    },
  );
});

test("reconnect keeps the desk session when it is still listed", async () => {
  let created = false;
  const result = await ensureDshDeskSession(input, "keep-me", {
    fetchImpl: deskFetch({
      list: [
        { sessionId: "other", title: "别人的" },
        { sessionId: "keep-me", title: "围读" },
      ],
      createId: "should-not",
      onCreate() {
        created = true;
      },
    }),
  });
  assert.equal(result.replaced, false);
  assert.equal(result.sessionId, "keep-me");
  assert.equal(created, false);
});

test("reconnect mints a dedicated session when the saved one is gone", async () => {
  const gone = "session-7823138a-ec27-457b-aeea-89299ca28f2d";
  const result = await ensureDshDeskSession(input, gone, {
    fetchImpl: deskFetch({
      list: [{ sessionId: "old-one", title: "旧对话" }],
      createId: "weidu-next",
    }),
  });
  assert.equal(result.replaced, true);
  assert.equal(result.sessionId, "weidu-next");
  assert.notEqual(result.sessionId, "old-one");
  assert.notEqual(result.sessionId, gone);
});

test("reconnect does not switch to another existing session when create fails", async () => {
  const gone = "session-gone";
  await assert.rejects(
    () =>
      ensureDshDeskSession(input, gone, {
        fetchImpl: deskFetch({ list: [{ sessionId: "old-one" }], createId: "old-one" }),
      }),
    (error: Error) => {
      assert.match(error.message, /不会改用别的已有会话/);
      assert.equal(error.message.includes(gone), false);
      assert.equal(error.message.includes("old-one"), false);
      return true;
    },
  );
  await assert.rejects(
    () => ensureDshDeskSession(input, "", { fetchImpl: deskFetch({ list: [] }) }),
    (error: Error) => {
      assert.match(error.message, /不会改用别的已有会话/);
      return true;
    },
  );
});
