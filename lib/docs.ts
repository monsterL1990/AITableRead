import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "./i18n/locale";
import { docBySlug, type DocSlug } from "./docs-nav";

export type Inline = { type: "text"; text: string } | { type: "strong"; text: string };

export type Block =
  | { type: "h1" | "h2"; inlines: Inline[] }
  | { type: "p"; inlines: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] }
  | { type: "img"; alt: string; src: string };

/** Chinese files in `content/` are the source. English lives in `content/en/`. */
export function loadDocMarkdown(slug: DocSlug, locale: Locale = "zh"): string {
  const doc = docBySlug(slug);
  const file =
    locale === "en"
      ? join(process.cwd(), "content", "en", doc.file)
      : join(process.cwd(), "content", doc.file);
  return readFileSync(/* turbopackIgnore: true */ file, "utf8");
}

export function parseInlines(text: string): Inline[] {
  const parts = text.split("**");
  const balanced = parts.length % 2 === 1;
  const nodes: Inline[] = [];
  const limit = balanced ? parts.length : parts.length - 1;
  for (let index = 0; index < limit; index += 1) {
    const part = parts[index];
    if (!part) continue;
    nodes.push(index % 2 === 0 ? { type: "text", text: part } : { type: "strong", text: part });
  }
  if (!balanced) {
    const tail = parts[parts.length - 1] ?? "";
    nodes.push({ type: "text", text: `**${tail}` });
  }
  return nodes.length ? nodes : [{ type: "text", text }];
}

function isStructural(line: string): boolean {
  return /^(#{1,2} )/.test(line) || line.startsWith("- ") || /^\d+\. /.test(line) || /^!\[[^\]]*\]\([^)\s]+\)\s*$/.test(line);
}

/** Local docs images only. Anything else is dropped so the page cannot point off-site. */
export function docsImageSrc(src: string): string | null {
  if (!src.startsWith("/docs-assets/")) return null;
  if (src.includes("..") || src.includes("\\") || src.includes("//")) return null;
  return src;
}

export function parseDocsMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index] ?? "";
    const line = raw.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,2}) (.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: heading[1] === "#" ? "h1" : "h2",
        inlines: parseInlines(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (image) {
      const src = docsImageSrc(image[2]);
      if (src) blocks.push({ type: "img", alt: image[1], src });
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items: Inline[][] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("- ")) {
        items.push(parseInlines((lines[index] ?? "").trim().slice(2).trim()));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\. /.test(line)) {
      const items: Inline[][] = [];
      while (index < lines.length && /^\d+\. /.test((lines[index] ?? "").trim())) {
        items.push(parseInlines((lines[index] ?? "").trim().replace(/^\d+\. /, "")));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = (lines[index] ?? "").trim();
      if (!next || isStructural(next)) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "p", inlines: parseInlines(paragraph.join("")) });
  }

  return blocks;
}
