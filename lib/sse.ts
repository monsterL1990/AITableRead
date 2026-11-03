import type { Project, TextRoute } from "./types";

export type SseEvent = {
  type: "delta" | "done" | "error" | "status" | "pending";
  text?: string;
  message?: string;
  task?: string;
  readerId?: string | null;
  revision?: number;
  demoMode?: boolean;
  textRoute?: TextRoute;
  project?: Project;
};

export async function readSse(response: Response, onEvent: (event: SseEvent) => void) {
  if (!response.body) throw new Error("没有返回内容。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      onEvent(JSON.parse(data) as SseEvent);
    }
  }
}
