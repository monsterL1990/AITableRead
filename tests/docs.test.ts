import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { DocsArticle } from "../components/docs-article";
import { isDocsPath } from "../lib/docs-nav";
import { loadDocMarkdown, parseDocsMarkdown } from "../lib/docs";

test("docs routes stay outside the login wall", () => {
  assert.equal(isDocsPath("/docs"), true);
  assert.equal(isDocsPath("/docs/getting-started"), true);
  assert.equal(isDocsPath("/docs/readers"), true);
  assert.equal(isDocsPath("/docs/api"), true);
  assert.equal(isDocsPath("/login"), false);
  assert.equal(isDocsPath("/"), false);
  assert.equal(isDocsPath("/readers"), false);
  assert.equal(isDocsPath("/docs-assets/cover.png"), false);
  assert.equal(isDocsPath("/settings"), false);
});

test("overview keeps the author's wording", () => {
  const markdown = loadDocMarkdown("overview");
  assert.match(markdown, /这个【围读·AI写作围读工作流】就这么诞生了/);
  assert.match(markdown, /华点/);
  assert.match(markdown, /把文写得多少能看/);
  const blocks = parseDocsMarkdown(markdown);
  assert.equal(blocks[0]?.type, "h1");
  const headings = blocks.filter((block) => block.type === "h2").map((block) => (block.type === "h2" ? block.inlines.map((node) => node.text).join("") : ""));
  assert.deepEqual(headings, ["【围读】的核心特点", "起因·经过·结果", "【围读】的优势与劣势"]);
  assert.equal(blocks.filter((block) => block.type === "ul").length, 2);
});

test("getting started renders the packaged figures", () => {
  const blocks = parseDocsMarkdown(loadDocMarkdown("getting-started"));
  const images = blocks.filter((block) => block.type === "img");
  assert.deepEqual(
    images.map((block) => (block.type === "img" ? block.src : "")),
    [
      "/docs-assets/fig1-new.png",
      "/docs-assets/fig2-new-form.png",
      "/docs-assets/fig3-idea-outline.jpeg",
      "/docs-assets/fig4-reader-feedback.png",
      "/docs-assets/fig5-polish.jpeg",
    ],
  );
  assert.match(loadDocMarkdown("getting-started"), /可以从写作流程三个不同环节开始/);
});

test("reader and api pages keep their figures", () => {
  const readers = parseDocsMarkdown(loadDocMarkdown("readers"));
  const api = parseDocsMarkdown(loadDocMarkdown("api"));
  assert.equal(readers.find((block) => block.type === "img")?.type, "img");
  assert.equal(readers.find((block) => block.type === "img" && block.src === "/docs-assets/fig6-readers.jpeg")?.type, "img");
  assert.equal(api.find((block) => block.type === "img" && block.src === "/docs-assets/fig7-api.png")?.type, "img");
  assert.match(loadDocMarkdown("api"), /可选的自建 DSH/);
  assert.match(loadDocMarkdown("api"), /不要求 purge/);
  assert.doesNotMatch(loadDocMarkdown("api"), /DSH \+ purge/);
});

test("off-site image urls are not rendered", () => {
  const blocks = parseDocsMarkdown("![外链](https://example.com/a.png)\n");
  assert.equal(blocks.some((block) => block.type === "img"), false);
});

function textOf(node: ReactNode) {
  return renderToStaticMarkup(createElement("div", null, node));
}

test("body figures are images, not links", () => {
  const html = textOf(createElement(DocsArticle, { slug: "getting-started" }));
  const imgAt = html.indexOf('src="/docs-assets/fig1-new.png"');
  assert.ok(imgAt > 0);
  assert.equal(html.slice(Math.max(0, imgAt - 180), imgAt).includes("<a"), false);
  assert.match(html, /双击放大/);
  assert.match(html, /src="\/docs-assets\/fig5-polish\.jpeg"/);
});

test("english docs keep the chinese structure, the images, and switch with the article", () => {
  const slugs = ["overview", "getting-started", "readers", "api"] as const;
  for (const slug of slugs) {
    const zh = parseDocsMarkdown(loadDocMarkdown(slug));
    const en = parseDocsMarkdown(loadDocMarkdown(slug, "en"));
    assert.deepEqual(
      en.map((block) => block.type),
      zh.map((block) => block.type),
      slug,
    );
    const srcs = (blocks: ReturnType<typeof parseDocsMarkdown>) =>
      blocks.flatMap((block) => (block.type === "img" ? [block.src] : []));
    assert.deepEqual(srcs(en), srcs(zh), slug);
  }
  const started = parseDocsMarkdown(loadDocMarkdown("getting-started", "en"));
  const title = started.find((block) => block.type === "ol");
  assert.equal(title?.type, "ol");
  if (title?.type === "ol") {
    assert.equal(title.items[0]?.some((node) => node.type === "strong" && node.text === "Title"), true);
  }
  assert.match(loadDocMarkdown("api", "en"), /does not require purge/);
  assert.doesNotMatch(loadDocMarkdown("api", "en"), /DSH \+ purge/);
  const html = textOf(createElement(DocsArticle, { slug: "getting-started", locale: "en" }));
  assert.match(html, /src="\/docs-assets\/fig1-new.png"/);
  assert.match(html, /src="\/docs-assets\/fig5-polish\.jpeg"/);
  assert.match(html, /New manuscript/);
  assert.doesNotMatch(html, /新开一稿/);
  const chinese = textOf(createElement(DocsArticle, { slug: "overview" }));
  assert.match(chinese, /【围读】的核心特点/);
  assert.match(chinese, /src="\/docs-assets\/cover.png"/);
});

test("overview page includes the cover and the opening", () => {
  const html = textOf(createElement(DocsArticle, { slug: "overview" }));
  const cover = html.indexOf('src="/docs-assets/cover.png"');
  const core = html.indexOf("【围读】的核心特点");
  const story = html.indexOf("起因·经过·结果");
  const tradeoff = html.indexOf("【围读】的优势与劣势");
  assert.ok(cover >= 0 && core > cover && story > core && tradeoff > story);
  assert.match(html, /href="\/docs\/getting-started"/);
  assert.doesNotMatch(html, /href="\/readers"/);
});
