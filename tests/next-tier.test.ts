import assert from "node:assert/strict";
import { test } from "node:test";
import { complianceHandoff } from "../lib/compliance";
import { extractDocumentText } from "../lib/documents";
import { dshTaskText, getDshConfig, promptDshSession } from "../lib/dsh";
import { draftReaderFromSpec } from "../lib/reader-spec";
import { getLlmConfig } from "../lib/llm";
import { resolveTextRoute } from "../lib/text-route";

test("an incomplete DSH config does not call the kernel", async () => {
  let called = false;
  await assert.rejects(
    () =>
      promptDshSession(
        { user: "门外站着梁照，四十一岁。" },
        {
          env: { DSH_BASE_URL: "", DSH_TOKEN: "", DSH_SESSION_ID: "" },
          fetchImpl: async () => {
            called = true;
            throw new Error("不应该发起请求。");
          },
        },
      ),
    /未配齐 DSH/,
  );
  assert.equal(called, false);
  assert.doesNotMatch(dshTaskText({ system: "写大纲", user: "两个成年人" }), /破甲|你是稿件合规清洗/);
  const handoff = complianceHandoff({
    DSH_BASE_URL: "http://dsh.example:8080",
    DSH_TOKEN: "launch-token",
    DSH_SESSION_ID: "session-1",
  });
  assert.equal(handoff.status, "configured");
  assert.match(handoff.note, /出字经 DSH/);
  assert.doesNotMatch(handoff.note, /永不|跑一次/);
  assert.equal(
    resolveTextRoute({
      DSH_BASE_URL: "http://dsh.example:8080",
      DSH_TOKEN: "t",
      DSH_SESSION_ID: "s",
      OPENAI_BASE_URL: "http://llm.example/v1",
      OPENAI_API_KEY: "k",
    }),
    "dsh",
  );
  assert.equal(
    resolveTextRoute({ OPENAI_BASE_URL: "http://llm.example/v1", OPENAI_API_KEY: "k" }),
    "cliproxy",
  );
  assert.equal(resolveTextRoute({ DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "", DSH_SESSION_ID: "s" }), "demo");
});

test("a configured session returns the assistant reply and an empty reply does not invent text", async () => {
  const reply = "门外站着梁照。他今年四十一岁，把修订稿放在台阶上。";
  let requestId = "";
  let submitted = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as { method?: string; payload?: { args?: { request?: { content?: { text?: string }[] } } } };
    if (body.method === "session/create") {
      return json({ type: "server-response", result: { ok: true, value: { sessionId: "session-job" } } });
    }
    if (body.method === "session/cancel") {
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/prompt") {
      submitted = body.payload?.args?.request?.content?.[0]?.text ?? "";
      requestId = /稿间请求 ([0-9a-f-]+)/.exec(submitted)?.[1] ?? "";
      assert.ok(requestId);
      assert.match(submitted, /写一节正文/);
      assert.doesNotMatch(submitted, /你是稿件合规清洗|破甲/);
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            items: [
              { sessionId: "session-1", running: false, projections: { kind: "sequenced", asOfSeq: 4, values: {} } },
              { sessionId: "session-job", running: false, projections: { kind: "sequenced", asOfSeq: 4, values: {} } },
            ],
          },
        },
      });
    }
    if (body.method === "session/page") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            records: [
              { type: "event", event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${requestId}\n任务` }] } } },
              { type: "event", event: { type: "assistant/message", data: { content: [{ type: "text", text: reply }] } } },
            ],
          },
        },
      });
    }
    throw new Error(`意外的地址 ${url}`);
  };
  const env = { DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "launch-token", DSH_SESSION_ID: "session-1" };
  const text = await promptDshSession(
    { system: "你写正文。", user: "写一节正文。" },
    { env, fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, reply);

  const emptyFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "session/create") {
      return json({ type: "server-response", result: { ok: true, value: { sessionId: "session-job" } } });
    }
    if (body.method === "session/cancel") {
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/prompt") {
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            items: [
              { sessionId: "session-1", projections: { kind: "sequenced", asOfSeq: 1, values: {} } },
              { sessionId: "session-job", projections: { kind: "sequenced", asOfSeq: 1, values: {} } },
            ],
          },
        },
      });
    }
    if (body.method === "session/page") {
      return json({ type: "server-response", result: { ok: true, value: { records: [] } } });
    }
    throw new Error(`意外的地址 ${url}`);
  };
  let clock = 0;
  await assert.rejects(
    () =>
      promptDshSession(
        { user: "写一节正文。" },
        {
          env: { ...env, DSH_TIMEOUT_MS: "5000" },
          fetchImpl: emptyFetch,
          sleep: async () => undefined,
          now: () => {
            clock += 10_000;
            return clock;
          },
        },
      ),
    /原稿保持不变/,
  );
});

test("text and pdf documents can be read, and a missing model does not invent a reader", async () => {
  const plain = extractDocumentText("口味.md", new TextEncoder().encode("追读看节拍，不要概述。"));
  assert.match(plain, /追读看节拍/);
  const pdf = extractDocumentText("note.pdf", pdfWith("读者看人话"));
  assert.match(pdf, /读者看人话/);
  await assert.rejects(
    async () => extractDocumentText("scan.pdf", new TextEncoder().encode("%PDF-1.1\n1 0 obj<<>>endobj\n")),
    /没有抽出文字/,
  );
  if (getLlmConfig().demo) {
    await assert.rejects(
      () =>
        draftReaderFromSpec(
          { requirement: "看节拍有没有被跳过", files: [{ name: "a.md", bytes: new TextEncoder().encode("节拍要写细。") }] },
          { preference: null },
        ),
      /未配置模型，不能根据文档生成读者。演示模式不会假装读过这些文件。/,
    );
  }
});

test("a one-line need can draft a reader with or without documents", async () => {
  await assert.rejects(() => draftReaderFromSpec({ requirement: "  ", files: [] }), /先用一句话写清这位读者要看什么/);
  await assert.rejects(
    () =>
      draftReaderFromSpec({
        requirement: "看节拍",
        files: Array.from({ length: 5 }, (_, index) => ({ name: `${index}.md`, bytes: new TextEncoder().encode("节拍要写细。") })),
      }),
    /一次最多 4 份文档/,
  );

  let seen = "";
  const fromNeed = await draftReaderFromSpec(
    { requirement: "看节拍有没有被跳过", files: [] },
    {
      demo: false,
      complete: async ({ user }) => {
        seen = user;
        return JSON.stringify({ name: "节拍读者", blurb: "盯紧被跳过的节拍。", prompt: "指出节拍被跳过和动机接不上的地方。" });
      },
    },
  );
  assert.equal(fromNeed.name, "节拍读者");
  assert.match(seen, /# 一句话需求\n看节拍有没有被跳过/);
  assert.doesNotMatch(seen, /文档摘录/);

  const fromDocs = await draftReaderFromSpec(
    { requirement: "看人话", files: [{ name: "口味.md", bytes: new TextEncoder().encode("追读要具体。") }] },
    {
      demo: false,
      complete: async ({ user, system }) => {
        seen = `${system}\n${user}`;
        return JSON.stringify({ name: "人话读者", blurb: "看人话。", prompt: "专挑不像人话的句子。" });
      },
    },
  );
  assert.equal(fromDocs.name, "人话读者");
  assert.match(seen, /口味和参照/);
  assert.match(seen, /## 口味\.md\n追读要具体。/);

  let called = false;
  await assert.rejects(
    () =>
      draftReaderFromSpec(
        { requirement: "看节拍有没有被跳过", files: [] },
        {
          demo: true,
          complete: async () => {
            called = true;
            return "";
          },
        },
      ),
    /未配置模型，不能生成读者。/,
  );
  assert.equal(called, false);
  await assert.rejects(
    () =>
      draftReaderFromSpec(
        { requirement: "看节拍有没有被跳过", files: [{ name: "a.md", bytes: new TextEncoder().encode("节拍要写细。") }] },
        { demo: true, complete: async () => "不应调用" },
      ),
    /未配置模型，不能根据文档生成读者。演示模式不会假装读过这些文件。/,
  );
});

test("a mid-turn assistant message is kept until the session is idle and the final prose settles", async () => {
  const plan = "先按大纲把六拍写成正文，写完核对字数和节拍，不够就补场面，不补心情。";
  const early = "雨先打在自行车棚上。沈酌把红笔搁进笔洗。".repeat(8);
  const prose = `${early}他三十四岁，没有把那页纸翻过去。`;
  const session = sessionFetch([
    { running: true, agentAvailable: false, assistant: [{ text: plan }] },
    { running: true, agentAvailable: false, assistant: [{ text: plan }, { text: early }] },
    { running: false, idle: true, assistant: [{ text: plan }] },
    { running: true, agentAvailable: false, assistant: [{ text: plan }, { text: early }] },
    { running: false, agentAvailable: true, assistant: [{ text: plan }, { text: prose }, { type: "assistant/progress", text: "正在写正文" }] },
  ]);
  const text = await promptDshSession(
    { system: "你写正文。", user: "写一节正文。" },
    { env: dshEnv, fetchImpl: session.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
  assert.equal(text.includes(plan), false);
  assert.equal(text.includes("正在写正文"), false);
  assert.equal(session.maxMessages >= 40, true);
  assert.equal(session.polls() >= 5, true);
});

test("mid-turn text is not returned when the session stays running until timeout", async () => {
  const plan = "先按大纲把六拍写成正文，写完核对字数和节拍，不够就补场面，不补心情。";
  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗。".repeat(20);
  const session = sessionFetch([
    { running: true, agentAvailable: true, assistant: [{ text: plan }, { text: prose }] },
  ]);
  let clock = 0;
  await assert.rejects(
    () =>
      promptDshSession(
        { user: "写一节正文。" },
        {
          env: { ...dshEnv, DSH_TIMEOUT_MS: "12000" },
          fetchImpl: session.fetchImpl,
          sleep: async () => undefined,
          now: () => {
            clock += 1000;
            return clock;
          },
        },
      ),
    /中途的句子没有保存/,
  );
  assert.equal(session.polls() > 0, true);
});

test("without a running field, a growing reply is not frozen on the first short bubble", async () => {
  const plan = "先按大纲把六拍写成正文，写完核对字数和节拍，不够就补场面，不补心情。";
  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗，才听见纸袋碰在门外。".repeat(12);
  const session = sessionFetch([
    { assistant: [{ text: plan }] },
    { assistant: [{ text: prose }] },
    { assistant: [{ text: prose }] },
    { assistant: [{ text: prose }] },
  ]);
  const text = await promptDshSession(
    { user: "写一节正文。" },
    { env: dshEnv, fetchImpl: session.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
  assert.equal(session.polls(), 4);
});

test("agentAvailable marks the session idle, and idle false keeps a short reply uncommitted", async () => {
  const prose = "门外站着梁照。他今年四十一岁，把修订稿放在台阶上，雨还没有停。";
  const ready = sessionFetch([{ agentAvailable: true, assistant: [{ text: prose }] }]);
  const text = await promptDshSession(
    { user: "写一节正文。" },
    { env: dshEnv, fetchImpl: ready.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
  assert.equal(ready.polls(), 2);

  const plan = "先按大纲把六拍写成正文，写完核对字数和节拍，不够就补场面，不补心情。";
  const busy = sessionFetch([{ idle: false, assistant: [{ text: plan }] }]);
  let clock = 0;
  await assert.rejects(
    () =>
      promptDshSession(
        { user: "写一节正文。" },
        {
          env: { ...dshEnv, DSH_TIMEOUT_MS: "12000" },
          fetchImpl: busy.fetchImpl,
          sleep: async () => undefined,
          now: () => {
            clock += 1000;
            return clock;
          },
        },
      ),
    /中途的句子没有保存/,
  );

  const byStatus = sessionFetch([{ status: "running", assistant: [{ text: plan }, { text: prose }] }]);
  clock = 0;
  await assert.rejects(
    () =>
      promptDshSession(
        { user: "写一节正文。" },
        {
          env: { ...dshEnv, DSH_TIMEOUT_MS: "8000" },
          fetchImpl: byStatus.fetchImpl,
          sleep: async () => undefined,
          now: () => {
            clock += 1000;
            return clock;
          },
        },
      ),
    /中途的句子没有保存/,
  );
});

test("a settled assistant message keeps the assembled outline once when the stream repeats it", async () => {
  const plan = "# 暂定篇名\n《旧稿》\n周衡，34周岁。这一份是更早一步的提纲，不能跟后文接在一起。";
  const outline = ["# 暂定篇名", "《十七页》", "林晓晴，31周岁，独立图书编辑。", "周衡，34周岁，咖啡馆合伙人。"].join("\n");
  let requestId = "";
  let polls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as { method?: string; payload?: { args?: { request?: { content?: { text?: string }[] } } } };
    if (body.method === "session/create") {
      return json({ type: "server-response", result: { ok: true, value: { sessionId: "session-job" } } });
    }
    if (body.method === "session/cancel") {
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/prompt") {
      const submitted = body.payload?.args?.request?.content?.[0]?.text ?? "";
      requestId = /稿间请求 ([0-9a-f-]+)/.exec(submitted)?.[1] ?? "";
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            items: [
              { sessionId: "session-1", running: false, agentAvailable: true, projections: { kind: "sequenced", asOfSeq: 8, values: {} } },
              { sessionId: "session-job", running: false, agentAvailable: true, projections: { kind: "sequenced", asOfSeq: 8, values: {} } },
            ],
          },
        },
      });
    }
    if (body.method === "session/page") {
      polls += 1;
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            records: [
              {
                type: "event",
                event: {
                  type: "user/message",
                  data: {
                    role: "user",
                    content: [{ type: "text", text: `请写大纲。\n\n稿间请求 ${requestId}` }],
                  },
                },
              },
              {
                type: "event",
                event: {
                  type: "assistant/message",
                  data: settledAssistant(plan, 1),
                },
              },
              {
                type: "event",
                event: {
                  type: "assistant/message",
                  data: settledAssistant(outline, 2),
                },
              },
            ],
          },
        },
      });
    }
    throw new Error(`意外的地址 ${url}`);
  };
  const text = await promptDshSession(
    { system: "你写大纲。", user: "写大纲。" },
    { env: dshEnv, fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, outline);
  assert.equal(text.includes(plan), false);
  assert.equal(text.split("# 暂定篇名").length, 2);
  assert.equal(polls >= 2, true);
});

test("a short trailing confirmation does not replace the long draft in the same turn", async () => {
  const plan = "先按大纲把六拍写成正文，写完核对字数和节拍，不够就补场面，不补心情。";
  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗，才听见纸袋碰在门外。".repeat(40);
  const ack = "正文已按上面的全文替换。同一份在 [验收改稿](/home/dsh/yanshou_draft.txt)。";
  const session = sessionFetch([
    {
      running: false,
      agentAvailable: true,
      assistant: [{ text: plan }, { text: prose, settled: true }, { text: ack }],
    },
  ]);
  const text = await promptDshSession(
    { user: "按读者意见改一节正文。" },
    { env: dshEnv, fetchImpl: session.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
  assert.equal(text.includes(ack), false);
  assert.equal(text.includes(plan), false);
  assert.equal(text.split("雨先打在自行车棚上").length, 41);
  assert.equal(session.polls(), 2);
});

test("a single short assistant reply is still returned as that reply", async () => {
  const reply = "改好了。";
  const session = sessionFetch([{ running: false, agentAvailable: true, assistant: [{ text: reply }] }]);
  const text = await promptDshSession(
    { user: "按读者意见改一节正文。" },
    { env: dshEnv, fetchImpl: session.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, reply);
  assert.equal(session.polls(), 2);
});

test("equal-length assistant replies keep the later one, and a longer fallback does not replace an assembled message", async () => {
  const first = "甲".repeat(24);
  const second = "乙".repeat(24);
  const tied = sessionFetch([
    { running: false, agentAvailable: true, assistant: [{ text: first }, { text: second }] },
  ]);
  const tiedText = await promptDshSession(
    { user: "写一节正文。" },
    { env: dshEnv, fetchImpl: tied.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(tiedText, second);

  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗。".repeat(12);
  const ack = "已写入文件。";
  const progress = `${prose}\n${prose}\n进度里又抄了一遍，不能跟组装正文拼在一起。`;
  const preferred = sessionFetch([
    {
      running: false,
      agentAvailable: true,
      assistant: [
        { text: prose },
        { text: ack },
        { type: "assistant/progress", text: progress },
      ],
    },
  ]);
  const text = await promptDshSession(
    { user: "写一节正文。" },
    { env: dshEnv, fetchImpl: preferred.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
  assert.equal(text.includes(ack), false);
  assert.equal(text.includes("进度里又抄了一遍"), false);
});

test("fallback assistant texts also keep the longer body instead of a trailing confirmation", async () => {
  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗，才听见纸袋碰在门外。".repeat(8);
  const ack = "正文已按上面的全文替换。同一份在 [验收改稿](/home/dsh/yanshou_draft.txt)。";
  const session = sessionFetch([
    {
      running: false,
      agentAvailable: true,
      assistant: [
        { type: "assistant/text", text: prose },
        { type: "assistant/text", text: ack },
      ],
    },
  ]);
  const text = await promptDshSession(
    { user: "写一节正文。" },
    { env: dshEnv, fetchImpl: session.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
  assert.equal(text.includes(ack), false);
});

test("a final assistant message still counts after the request id scrolls out of the page", async () => {
  const plan = "先按大纲把六拍写成正文，写完核对字数和节拍，不够就补场面，不补心情。";
  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗。他三十四岁，没有追下楼。".repeat(6);
  const session = sessionFetch([
    { running: true, assistant: [{ text: plan }] },
    { running: false, agentAvailable: true, withRequest: false, assistant: [{ text: prose }] },
  ]);
  const text = await promptDshSession(
    { user: "写一节正文。" },
    { env: dshEnv, fetchImpl: session.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
});

test("after the request scrolls off, a trailing confirmation still does not replace the long draft", async () => {
  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗，才听见纸袋碰在门外。".repeat(12);
  const ack = "正文已按上面的全文替换。同一份在 [验收改稿](/home/dsh/yanshou_draft.txt)。";
  const session = sessionFetch([
    { running: true, assistant: [{ text: prose }] },
    { running: false, agentAvailable: true, withRequest: false, assistant: [{ text: prose }, { text: ack }] },
  ]);
  const text = await promptDshSession(
    { user: "写一节正文。" },
    { env: dshEnv, fetchImpl: session.fetchImpl, sleep: async () => undefined },
  );
  assert.equal(text, prose);
  assert.equal(text.includes(ack), false);
  assert.equal(session.polls(), 3);
});

test("the wait budget defaults to 20 minutes and caps at 30", () => {
  const base = { DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "t", DSH_SESSION_ID: "s" };
  assert.equal(getDshConfig(base).timeoutMs, 1_200_000);
  assert.equal(getDshConfig({ ...base, DSH_TIMEOUT_MS: "300000" }).timeoutMs, 300_000);
  assert.equal(getDshConfig({ ...base, DSH_TIMEOUT_MS: "9000000" }).timeoutMs, 1_800_000);
  assert.equal(getDshConfig({ ...base, DSH_TIMEOUT_MS: "1000" }).timeoutMs, 5_000);
});

test("a running template session does not block another job on its own session", async () => {
  const prose = "结构清单：大纲六拍都在，字数够，缺一处雨声。";
  let creates = 0;
  const jobs = new Map<string, string>();
  const prompted: string[] = [];
  const paged: string[] = [];
  const cancelled: string[] = [];
  let preset = "";
  let cwd = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      payload?: {
        args?: {
          request?: {
            sessionId?: string;
            agentPreset?: string;
            cwd?: string;
            content?: { text?: string }[];
            address?: { sessionId?: string };
          };
        };
      };
    };
    const request = body.payload?.args?.request;
    if (body.method === "session/create") {
      creates += 1;
      preset = request?.agentPreset ?? "";
      cwd = request?.cwd ?? "";
      const sessionId = `job-${creates}`;
      jobs.set(sessionId, "");
      return json({ type: "server-response", result: { ok: true, value: { sessionId, agentPreset: preset } } });
    }
    if (body.method === "session/prompt") {
      const sessionId = request?.sessionId ?? "";
      prompted.push(sessionId);
      const text = request?.content?.[0]?.text ?? "";
      jobs.set(sessionId, /稿间请求 ([0-9a-f-]+)/.exec(text)?.[1] ?? "");
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/cancel") {
      cancelled.push(request?.sessionId ?? "");
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/list") {
      const items: Record<string, unknown>[] = [
        {
          sessionId: "session-1",
          running: true,
          cwd: "/tmp/dsh-workspace",
          projections: { kind: "sequenced", asOfSeq: 3, values: { agentPreset: "gaojian-purge" } },
        },
      ];
      for (const sessionId of jobs.keys()) {
        items.push({
          sessionId,
          running: false,
          agentAvailable: true,
          projections: { kind: "sequenced", asOfSeq: 4, values: {} },
        });
      }
      return json({ type: "server-response", result: { ok: true, value: { items } } });
    }
    if (body.method === "session/page") {
      const sessionId = request?.address?.sessionId ?? "";
      paged.push(sessionId);
      const requestId = jobs.get(sessionId) ?? "";
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            records: [
              {
                type: "event",
                event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${requestId}` }] } },
              },
              {
                type: "event",
                event: {
                  type: "assistant/message",
                  data: { message: { content: [{ type: "text", text: `${prose}\n${sessionId}` }] } },
                },
              },
            ],
          },
        },
      });
    }
    throw new Error(`意外的地址 ${url} ${body.method ?? ""}`);
  };
  const [first, second] = await Promise.all([
    promptDshSession({ user: "质检。" }, { env: dshEnv, fetchImpl, sleep: async () => undefined }),
    promptDshSession({ user: "再质检。" }, { env: dshEnv, fetchImpl, sleep: async () => undefined }),
  ]);
  assert.equal(preset, "gaojian-purge");
  assert.equal(cwd, "/tmp/dsh-workspace");
  assert.equal(creates, 2);
  assert.deepEqual(prompted.filter((id) => id === "session-1"), []);
  assert.deepEqual([...prompted].sort(), ["job-1", "job-2"]);
  assert.equal(paged.includes("session-1"), false);
  assert.deepEqual(cancelled, []);
  assert.match(first, /结构清单/);
  assert.match(second, /结构清单/);
  assert.notEqual(first, second);
  assert.equal(first.includes(second) || second.includes(first), false);
});

test("a job that is still writing when the deadline hits is cancelled and reports timeout", async () => {
  let prompted = "";
  let cancelled = "";
  let requestId = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      payload?: { args?: { request?: { sessionId?: string; content?: { text?: string }[] } } };
    };
    const request = body.payload?.args?.request;
    if (body.method === "session/create") {
      return json({ type: "server-response", result: { ok: true, value: { sessionId: "session-job" } } });
    }
    if (body.method === "session/prompt") {
      prompted = request?.sessionId ?? "";
      requestId = /稿间请求 ([0-9a-f-]+)/.exec(request?.content?.[0]?.text ?? "")?.[1] ?? "";
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/cancel") {
      cancelled = request?.sessionId ?? "";
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            items: [
              { sessionId: "session-1", running: true, agentPreset: "gaojian-purge", projections: { kind: "sequenced", asOfSeq: 2, values: {} } },
              { sessionId: "session-job", running: true, projections: { kind: "sequenced", asOfSeq: 4, values: {} } },
            ],
          },
        },
      });
    }
    if (body.method === "session/page") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            records: [
              { type: "event", event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${requestId}` }] } } },
              {
                type: "event",
                event: {
                  type: "assistant/message",
                  data: { message: { content: [{ type: "text", text: "先按大纲列缺口，这句话还没写完。" }] } },
                },
              },
            ],
          },
        },
      });
    }
    throw new Error(`意外的地址 ${url}`);
  };
  let clock = 0;
  await assert.rejects(
    () =>
      promptDshSession(
        { user: "质检。" },
        {
          env: { ...dshEnv, DSH_TIMEOUT_MS: "8000" },
          fetchImpl,
          sleep: async () => undefined,
          now: () => {
            clock += 1000;
            return clock;
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /超时/);
      assert.match(error.message, /中途的句子没有保存/);
      assert.match(error.message, /原稿保持不变/);
      return true;
    },
  );
  assert.equal(prompted, "session-job");
  assert.equal(cancelled, "session-job");
});

test("without session create, a busy template is refused and an idle one is still used once", async () => {
  const reply = "门外站着梁照。他今年四十一岁，把修订稿放在台阶上。";

  function sharedFetch(running: boolean) {
    let prompts = 0;
    let requestId = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/connect")) {
        return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
      }
      const body = JSON.parse(String(init?.body)) as {
        method?: string;
        payload?: { args?: { request?: { sessionId?: string; content?: { text?: string }[] } } };
      };
      const request = body.payload?.args?.request;
      if (body.method === "session/create") return new Response("unknown method session/create", { status: 404 });
      if (body.method === "session/prompt") {
        prompts += 1;
        assert.equal(request?.sessionId, "session-1");
        requestId = /稿间请求 ([0-9a-f-]+)/.exec(request?.content?.[0]?.text ?? "")?.[1] ?? "";
        return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
      }
      if (body.method === "session/list") {
        return json({
          type: "server-response",
          result: {
            ok: true,
            value: {
              items: [
                {
                  sessionId: "session-1",
                  running,
                  agentAvailable: !running,
                  projections: { kind: "sequenced", asOfSeq: 4, values: {} },
                },
              ],
            },
          },
        });
      }
      if (body.method === "session/page") {
        return json({
          type: "server-response",
          result: {
            ok: true,
            value: {
              records: [
                {
                  type: "event",
                  event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${requestId}` }] } },
                },
                {
                  type: "event",
                  event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: reply }] } } },
                },
              ],
            },
          },
        });
      }
      throw new Error(`意外的地址 ${url}`);
    };
    return { fetchImpl, prompts: () => prompts };
  }

  const idle = sharedFetch(false);
  const text = await promptDshSession({ user: "写一节正文。" }, { env: dshEnv, fetchImpl: idle.fetchImpl, sleep: async () => undefined });
  assert.equal(text, reply);
  assert.equal(idle.prompts(), 1);

  const busy = sharedFetch(true);
  await assert.rejects(
    () => promptDshSession({ user: "质检。" }, { env: dshEnv, fetchImpl: busy.fetchImpl, sleep: async () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /还在写上一轮/);
      assert.match(error.message, /没有提交/);
      assert.match(error.message, /原稿保持不变/);
      assert.doesNotMatch(error.message, /没能另开一轮/);
      return true;
    },
  );
  assert.equal(busy.prompts(), 0);

  let releasePrompt: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  let promptStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    promptStarted = resolve;
  });
  let overlapped = 0;
  let heldRequestId = "";
  const overlap: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      payload?: { args?: { request?: { content?: { text?: string }[] } } };
    };
    if (body.method === "session/create") return new Response("method not found", { status: 404 });
    if (body.method === "session/prompt") {
      overlapped += 1;
      heldRequestId = /稿间请求 ([0-9a-f-]+)/.exec(body.payload?.args?.request?.content?.[0]?.text ?? "")?.[1] ?? "";
      promptStarted();
      await hold;
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            items: [{ sessionId: "session-1", running: false, agentAvailable: true, projections: { kind: "sequenced", asOfSeq: 4, values: {} } }],
          },
        },
      });
    }
    if (body.method === "session/page") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            records: [
              { type: "event", event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${heldRequestId}` }] } } },
              { type: "event", event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: reply }] } } } },
            ],
          },
        },
      });
    }
    throw new Error(`意外的地址 ${url}`);
  };
  const first = promptDshSession({ user: "先写。" }, { env: dshEnv, fetchImpl: overlap, sleep: async () => undefined });
  try {
    await started;
    await assert.rejects(
      () => promptDshSession({ user: "后写。" }, { env: dshEnv, fetchImpl: overlap, sleep: async () => undefined }),
      /还在写上一轮/,
    );
    assert.equal(overlapped, 1);
  } finally {
    releasePrompt();
  }
  assert.equal(await first, reply);
});

test("a session create failure other than a missing method does not fall back onto the shared queue", async () => {
  let prompts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: { items: [{ sessionId: "session-1", running: false, agentPreset: "gaojian-purge", projections: { kind: "sequenced", asOfSeq: 1, values: {} } }] },
        },
      });
    }
    if (body.method === "session/create") {
      return json({
        type: "server-response",
        result: { ok: false, error: { message: 'agent preset "gaojian-purge" not found' } },
      });
    }
    if (body.method === "session/prompt") {
      prompts += 1;
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    throw new Error(`意外的地址 ${url}`);
  };
  await assert.rejects(
    () => promptDshSession({ user: "质检。" }, { env: dshEnv, fetchImpl, sleep: async () => undefined }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /没能另开一轮/);
      assert.match(error.message, /原稿保持不变/);
      assert.match(error.message, /gaojian-purge/);
      return true;
    },
  );
  assert.equal(prompts, 0);
});

const dshEnv = { DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "launch-token", DSH_SESSION_ID: "session-1" };

type AssistantBubble = { text: string; type?: string; settled?: boolean };
type SessionFrame = {
  running?: boolean;
  agentAvailable?: boolean;
  idle?: boolean;
  status?: string;
  withRequest?: boolean;
  assistant: AssistantBubble[];
};

function sessionFetch(frames: SessionFrame[]) {
  let requestId = "";
  let polls = 0;
  let maxMessages = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      payload?: { args?: { request?: { content?: { text?: string }[]; maxMessages?: number } } };
    };
    if (body.method === "session/create") {
      return json({ type: "server-response", result: { ok: true, value: { sessionId: "session-job" } } });
    }
    if (body.method === "session/cancel") {
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/prompt") {
      const submitted = body.payload?.args?.request?.content?.[0]?.text ?? "";
      requestId = /稿间请求 ([0-9a-f-]+)/.exec(submitted)?.[1] ?? "";
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    const frame = frames[Math.min(polls, frames.length - 1)]!;
    if (body.method === "session/list") {
      const item: Record<string, unknown> = {
        sessionId: "session-1",
        projections: { kind: "sequenced", asOfSeq: polls + 1, values: {} },
      };
      if (frame.running !== undefined) item.running = frame.running;
      if (frame.agentAvailable !== undefined) item.agentAvailable = frame.agentAvailable;
      if (frame.idle !== undefined) item.idle = frame.idle;
      if (frame.status !== undefined) item.status = frame.status;
      const job = { ...item, sessionId: "session-job" };
      return json({ type: "server-response", result: { ok: true, value: { items: [item, job] } } });
    }
    if (body.method === "session/page") {
      maxMessages = body.payload?.args?.request?.maxMessages ?? 0;
      polls += 1;
      const records: unknown[] = [];
      if (frame.withRequest !== false) {
        records.push({
          type: "event",
          event: {
            type: "user/message",
            data: { content: [{ type: "text", text: `请写正文。\n\n稿间请求 ${requestId}` }] },
          },
        });
      }
      frame.assistant.forEach((bubble, index) => {
        records.push({
          type: "event",
          event: {
            type: bubble.type ?? "assistant/message",
            data: bubble.settled
              ? settledAssistant(bubble.text, index + 1)
              : { turn: 4, step: index + 1, message: { content: [{ type: "text", text: bubble.text }] } },
          },
        });
      });
      return json({ type: "server-response", result: { ok: true, value: { records } } });
    }
    throw new Error(`意外的地址 ${url}`);
  };
  return { fetchImpl, polls: () => polls, get maxMessages() { return maxMessages; } };
}

/** 一条已经写完的 assistant/message：正文在 message.content，流里再放一份相同文本。 */
function settledAssistant(text: string, step: number) {
  return {
    turn: 4,
    step,
    message: {
      role: "assistant",
      id: `msg-${step}`,
      content: [{ type: "text", text }],
    },
    stream: [
      { type: "text-chunks", index: 0, time0: 1, dt: [1, 1], texts: [text.slice(0, 4), text.slice(4)] },
      {
        type: "chunk",
        time: 3,
        chunk: { type: "block-end", index: 0, block: { type: "text", text } },
      },
    ],
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function pdfWith(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 100 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>endobj\n",
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
  ];
  let body = "%PDF-1.1\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}
