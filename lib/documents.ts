import { inflateSync } from "node:zlib";

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown"];

export function extractDocumentText(filename: string, bytes: Uint8Array): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || isPdf(bytes)) return extractPdfText(bytes, filename);
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\u0000/g, "");
  }
  throw new Error(`暂不支持「${filename}」。请用 txt、md，或带文字层的 pdf。`);
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function extractPdfText(bytes: Uint8Array, filename: string): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const chunks = [raw, ...inflateStreams(raw)];
  const parts: string[] = [];
  for (const chunk of chunks) {
    for (const match of chunk.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
      parts.push(decodePdfString(match[0].slice(1, match[0].lastIndexOf(")"))));
    }
  }
  const text = parts.join("").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`「${filename}」没有抽出文字。扫描件或只有图片的 PDF 暂不支持。`);
  return text;
}

function inflateStreams(raw: string): string[] {
  const found: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const dict = raw.slice(Math.max(0, match.index - 240), match.index);
    if (!/FlateDecode/.test(dict)) continue;
    try {
      found.push(inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1"));
    } catch {
      // 压坏的流跳过，剩下的文本层仍可用。
    }
  }
  return found;
}

function decodePdfString(value: string): string {
  const unescaped = value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_all, code: string) => {
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    if (code === "t") return "\t";
    if (code === "b") return "\b";
    if (code === "f") return "\f";
    if (code === "(" || code === ")" || code === "\\") return code;
    return String.fromCharCode(Number.parseInt(code, 8));
  });
  const bytes = Buffer.from(unescaped, "latin1");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      out += String.fromCharCode((bytes[index]! << 8) | bytes[index + 1]!);
    }
    return out;
  }
  const utf8 = bytes.toString("utf8");
  return utf8.includes("\uFFFD") ? unescaped : utf8;
}
