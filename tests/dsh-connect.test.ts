import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { inspectDshConnection } from "../lib/dsh";

const TOKEN = "launch-token-not-a-model-key";

function listen(handler: http.RequestListener): Promise<{ server: http.Server; origin: string }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("a 302 Set-Cookie is read and sent on the next API call", async () => {
  let apiCookie = "";
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/connect") {
      assert.equal(url.searchParams.get("token"), TOKEN);
      assert.equal(url.searchParams.get("interactions"), "none");
      res.writeHead(302, {
        Location: "./api/remote.mux",
        "Set-Cookie": "dsh-auth-test=v2.payload; HttpOnly; Path=/; SameSite=Strict",
      });
      res.end();
      return;
    }
    apiCookie = String(req.headers.cookie ?? "");
    const value = url.pathname.endsWith("/session/list")
      ? { items: [{ sessionId: "sess-1", title: "稿", running: false }] }
      : { routableProviders: [], groups: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "server-response", result: { ok: true, value } }));
  });
  try {
    const result = await inspectDshConnection({ baseUrl: origin, token: TOKEN });
    assert.equal(result.sessions[0]?.sessionId, "sess-1");
    assert.equal(result.sessions[0]?.title, "稿");
    assert.equal(apiCookie, "dsh-auth-test=v2.payload");
  } finally {
    await close(server);
  }
});

test("a fetch that hides Set-Cookie still uses the raw 302", async () => {
  let apiCookie = "";
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname === "/connect") {
      res.writeHead(302, {
        Location: "./api/remote.mux",
        "Set-Cookie": "dsh-auth-raw=v2.from-wire; HttpOnly; Path=/",
      });
      res.end();
      return;
    }
    apiCookie = String(req.headers.cookie ?? "");
    const value = url.pathname.endsWith("/session/list")
      ? { items: [{ sessionId: "sess-raw", running: false }] }
      : { routableProviders: [], groups: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "server-response", result: { ok: true, value } }));
  });
  const hidden: typeof fetch = async () => new Response("", { status: 302, headers: { location: "./api/remote.mux" } });
  try {
    const result = await inspectDshConnection(
      { baseUrl: origin, token: TOKEN },
      { fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/connect")) return hidden(input, init);
        return fetch(input, init);
      } },
    );
    assert.equal(result.sessions[0]?.sessionId, "sess-raw");
    assert.equal(apiCookie, "dsh-auth-raw=v2.from-wire");
  } finally {
    await close(server);
  }
});

test("a 404 on /connect exchanges the launch token at /", async () => {
  const hits: string[] = [];
  let apiCookie = "";
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url ?? "/", origin);
    hits.push(url.pathname);
    if (url.pathname === "/connect") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (url.pathname === "/" && url.searchParams.get("token") === TOKEN) {
      res.writeHead(303, {
        Location: "./",
        "Set-Cookie": "dsh-auth-old=v1.browser; HttpOnly; Path=/; SameSite=Strict",
      });
      res.end();
      return;
    }
    apiCookie = String(req.headers.cookie ?? "");
    const value = url.pathname.endsWith("/session/list")
      ? { items: [{ sessionId: "sess-old", title: "旧版", running: false }] }
      : { routableProviders: [], groups: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "server-response", result: { ok: true, value } }));
  });
  try {
    const result = await inspectDshConnection({ baseUrl: origin, token: TOKEN });
    assert.equal(result.sessions[0]?.sessionId, "sess-old");
    assert.equal(apiCookie, "dsh-auth-old=v1.browser");
    assert.equal(hits.includes("/connect"), true);
    assert.equal(hits.includes("/"), true);
  } finally {
    await close(server);
  }
});

test("a 404 on both /connect and / names the missing endpoint and hides the token", async () => {
  const { server, origin } = await listen((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  try {
    await assert.rejects(
      () => inspectDshConnection({ baseUrl: origin, token: TOKEN }),
      (error: Error) => {
        assert.match(error.message, /没有 \/connect/);
        assert.match(error.message, /404/);
        assert.equal(error.message.includes(TOKEN), false);
        return true;
      },
    );
  } finally {
    await close(server);
  }
});

test("a 302 without Set-Cookie names the status and does not echo the token", async () => {
  const { server, origin } = await listen((_req, res) => {
    res.writeHead(302, { Location: "./api/remote.mux" });
    res.end("unauthorized");
  });
  try {
    await assert.rejects(
      () => inspectDshConnection({ baseUrl: origin, token: TOKEN }),
      (error: Error) => {
        assert.match(error.message, /GET \/connect|向 .*\/connect/);
        assert.match(error.message, /302/);
        assert.match(error.message, /remote\.mux/);
        assert.equal(error.message.includes(TOKEN), false);
        return true;
      },
    );
  } finally {
    await close(server);
  }
});
