import type { TextRoute } from "./types";

export function countChars(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

export function formatWhen(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = now - time;
  if (diff < 45_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return "昨天";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim();
  return cleaned.slice(0, 60) || "未命名稿件";
}

export function routeMark(route: TextRoute): string {
  if (route === "dsh") return "经 DSH";
  if (route === "cliproxy") return "经 CLIProxy";
  if (route === "custom") return "经自定义 API";
  return "演示稿";
}

/** 半配（缺一两项）时点名缺什么。三项都空则只说未配齐，避免把三个变量名铺开。 */
export function dshFallbackNote(missing: string[]): string {
  if (missing.length > 0 && missing.length < 3) {
    return `未配齐 DSH（缺 ${missing.join("、")}），出字不经 DSH。`;
  }
  return "未配齐 DSH，出字不经 DSH。";
}

export function archivePath(ownerId: string, projectId: string): string {
  return `写作站/${ownerId}/${projectId}/`;
}

export type ConnectedModelLine = {
  text: string;
  mono?: boolean;
};

/** 模型名、接口地址、密钥说明各占一行。行尾空格让复制出来的字也不会粘在一起。 */
export function connectedModelLines(model: string, baseUrl: string | null | undefined): ConnectedModelLine[] {
  const name = model.trim();
  const lines: ConnectedModelLine[] = [{ text: name ? `已连接模型 ${name}` : "已连接模型" }];
  const url = baseUrl?.trim();
  if (url) lines.push({ text: url, mono: true });
  lines.push({ text: "密钥只留在服务器。" });
  return lines;
}
