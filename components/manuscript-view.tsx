import type { ReactNode } from "react";

export function ManuscriptView({ text, empty = "这里还空着。" }: { text: string; empty?: string }) {
  if (!text.trim()) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="prose-sheet space-y-2">
      <Blocks text={text} />
    </div>
  );
}

function Blocks({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    nodes.push(
      <ul key={`list-${nodes.length}`} className="list-disc space-y-1 pl-5">
        {list.map((item, itemIndex) => (
          <li key={itemIndex}>{item}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((line) => {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      list.push(item[1] ?? "");
      return;
    }
    flush();
    if (!line.trim()) return;
    if (heading) {
      nodes.push(
        <p key={`h-${nodes.length}`} className="font-medium">
          {heading[2]}
        </p>,
      );
      return;
    }
    nodes.push(
      <p key={`p-${nodes.length}`} className="whitespace-pre-wrap">
        {line}
      </p>,
    );
  });
  flush();
  if (!nodes.length) return null;
  return <>{nodes}</>;
}
