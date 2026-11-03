import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  handleGenerateRequest,
  resetHostedJobsForTests,
  sweepExpiredPendingJob,
  type HostedGenerateDeps,
} from "../lib/hosted-generation";
import { pendingJobProgress } from "../lib/pending-job";
import { createProject, getProject, updateProject } from "../lib/store";
import type { PendingJob } from "../lib/types";

const PROSE = "雨夜大纲。两个成年人把话说完，这一节就停在门口。";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function generateRequest(id: string, signal?: AbortSignal) {
  return new Request(`http://gaojian.local/api/projects/${id}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "outline", step: 1 }),
    signal,
  });
}

async function waitFor(read: () => Promise<boolean>) {
  const start = Date.now();
  while (Date.now() - start < 4000) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等任务落库超时了。");
}

async function withStore(run: () => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-hosted-"));
  const previous = process.env.GAOJIAN_DATA_FILE;
  process.env.GAOJIAN_DATA_FILE = path.join(dir, "store.json");
  resetHostedJobsForTests();
  try {
    await run();
  } finally {
    resetHostedJobsForTests();
    if (previous === undefined) delete process.env.GAOJIAN_DATA_FILE;
    else process.env.GAOJIAN_DATA_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test("hosted generation keeps working after the browser disconnects", { concurrency: false }, async (t) => {
  await t.test("progress copy includes elapsed minutes", () => {
    const now = Date.parse("2026-10-28T09:00:00.000Z");
    const job: PendingJob = {
      task: "revise-from-feedback",
      step: 3,
      startedAt: new Date(now - 3 * 60_000).toISOString(),
      label: "quality-revise",
      feedbackSource: "quality",
    };
    assert.equal(pendingJobProgress(job, now), "正在按质检改…（已进行 3 分）");
    const fresh: PendingJob = { ...job, startedAt: new Date(now - 20_000).toISOString() };
    assert.equal(pendingJobProgress(fresh, now), "正在按质检改…（已进行不到 1 分）");
  });

  await t.test("request abort does not cancel the job, and the manuscript is saved", async () => {
    const gate = deferred();
    let modelSignal: AbortSignal | null = null;
    const deps: HostedGenerateDeps = {
      timeoutMs: 30_000,
      runText: async ({ signal }) => {
        modelSignal = signal;
        await gate.promise;
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return PROSE;
      },
    };
    await withStore(async () => {
      const created = await createProject("local", {
        title: "雨夜",
        startFrom: "idea",
        idea: "两个成年人在雨里见面。",
      });
      const requestAbort = new AbortController();
      const response = await handleGenerateRequest(generateRequest(created.id, requestAbort.signal), created.id, "local", deps);
      assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
      const running = await getProject("local", created.id);
      assert.equal(running?.pendingJob?.task, "outline");
      assert.ok(running?.pendingJob?.requestId);
      const swept = await sweepExpiredPendingJob("local", created.id, { timeoutMs: 1 });
      assert.equal(swept, null);
      assert.ok((await getProject("local", created.id))?.pendingJob);

      requestAbort.abort();
      await response.body?.cancel();
      assert.equal(requestAbort.signal.aborted, true);
      assert.equal(modelSignal?.aborted, false);
      assert.ok((await getProject("local", created.id))?.pendingJob);

      gate.resolve();
      await waitFor(async () => {
        const project = await getProject("local", created.id);
        return project?.pendingJob == null && project?.outline === PROSE;
      });
      const saved = await getProject("local", created.id);
      assert.equal(saved?.outline, PROSE);
      assert.equal(saved?.pendingJob, null);
      assert.equal(modelSignal?.aborted, false);
      assert.ok(saved?.versions.some((version) => version.kind === "outline" && version.text === PROSE));
    });
    gate.resolve();
  });

  await t.test("a second generate is rejected while one is running", async () => {
    const gate = deferred();
    let calls = 0;
    const deps: HostedGenerateDeps = {
      timeoutMs: 30_000,
      runText: async ({ signal }) => {
        calls += 1;
        await gate.promise;
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        return PROSE;
      },
    };
    await withStore(async () => {
      const created = await createProject("local", {
        title: "雨夜",
        startFrom: "idea",
        idea: "两个成年人在雨里见面。",
      });
      const first = handleGenerateRequest(generateRequest(created.id), created.id, "local", deps);
      await waitFor(async () => Boolean((await getProject("local", created.id))?.pendingJob));
      const response = await first;
      const pendingId = (await getProject("local", created.id))?.pendingJob?.requestId;
      const second = await handleGenerateRequest(generateRequest(created.id), created.id, "local", deps);
      assert.equal(second.status, 409);
      const body = (await second.json()) as { error?: string };
      assert.equal(body.error, "已有任务在跑。");
      assert.equal(calls, 1);
      assert.equal((await getProject("local", created.id))?.pendingJob?.requestId, pendingId);
      await response.body?.cancel();
      gate.resolve();
      await waitFor(async () => (await getProject("local", created.id))?.outline === PROSE);
      assert.equal(calls, 1);
    });
    gate.resolve();
  });

  await t.test("timeout aborts the model signal and clears pendingJob", async () => {
    let sawAbort = false;
    const deps: HostedGenerateDeps = {
      timeoutMs: 40,
      runText: ({ signal }) =>
        new Promise((resolve, reject) => {
          const backup = setTimeout(() => resolve(PROSE), 5_000);
          const fail = () => {
            clearTimeout(backup);
            sawAbort = true;
            reject(new DOMException("Aborted", "AbortError"));
          };
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener("abort", fail, { once: true });
        }),
    };
    await withStore(async () => {
      const created = await createProject("local", {
        title: "雨夜",
        startFrom: "idea",
        idea: "两个成年人在雨里见面。",
      });
      const response = await handleGenerateRequest(generateRequest(created.id), created.id, "local", deps);
      await response.body?.cancel();
      await waitFor(async () => {
        const project = await getProject("local", created.id);
        return Boolean(project && project.pendingJob == null && project.log.some((entry) => entry.type === "timeout"));
      });
      const saved = await getProject("local", created.id);
      assert.equal(saved?.outline, "");
      assert.equal(saved?.pendingJob, null);
      assert.equal(sawAbort, true);
      const entry = saved?.log.find((item) => item.type === "timeout");
      assert.match(entry?.summary ?? "", /超时/);
      assert.match(entry?.summary ?? "", /原稿保持不变/);
    });
  });

  await t.test("a stale pendingJob is cleared on read, a fresh one is kept", async () => {
    await withStore(async () => {
      const created = await createProject("local", {
        title: "雨夜",
        startFrom: "idea",
        idea: "两个成年人在雨里见面。",
      });
      const fresh = await updateProject("local", created.id, (project) => {
        project.pendingJob = {
          task: "quality-check",
          step: 2,
          startedAt: new Date().toISOString(),
          requestId: "fresh",
          label: "quality",
        };
      });
      const kept = await sweepExpiredPendingJob("local", created.id, { timeoutMs: 60_000 });
      assert.equal(kept, null);
      const still = await getProject("local", created.id);
      assert.equal(still?.pendingJob?.requestId, "fresh");
      assert.equal(still?.revision, fresh?.revision);

      await updateProject("local", created.id, (project) => {
        project.pendingJob = {
          task: "revise-from-feedback",
          step: 3,
          startedAt: new Date(Date.now() - 3_600_000).toISOString(),
          requestId: "stale",
          label: "quality-revise",
          feedbackSource: "quality",
        };
      });
      const swept = await sweepExpiredPendingJob("local", created.id, { timeoutMs: 60_000 });
      assert.equal(swept?.pendingJob, null);
      assert.match(swept?.log.at(-1)?.summary ?? "", /超时/);
      assert.match(swept?.log.at(-1)?.summary ?? "", /原稿保持不变/);
      const again = await getProject("local", created.id);
      assert.equal(again?.pendingJob, null);
      assert.equal(again?.log.at(-1)?.type, "timeout");
    });
  });
});
