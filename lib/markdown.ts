import { complianceHandoff, complianceNoteForRoute } from "./compliance";
import { archivePath, countChars, formatWhen } from "./format";
import { STEPS, reviewsForStep, wordTargetLabel } from "./pipeline";
import type { Project, TextRoute } from "./types";

export function currentProse(project: Project): string {
  return project.polished.trim() || project.draft.trim();
}

export function projectToMarkdown(
  project: Project,
  scope: "full" | "current",
  routeInfo?: { textRoute: TextRoute; dshConfigured?: boolean; byokPurge?: boolean },
): string {
  const path = archivePath(project.ownerId, project.id);
  const handoff = routeInfo
    ? complianceNoteForRoute(routeInfo.textRoute, routeInfo.dshConfigured === true, routeInfo.byokPurge === true)
    : complianceHandoff();
  const compliance = `合规：本文件不含合规修改标记。${handoff.note}`;
  if (scope === "current") {
    const body = currentProse(project).trim();
    const which = project.polished.trim() ? "润色稿" : project.draft.trim() ? "初稿" : "空";
    return `# ${project.title}

> 当前正文（${which}）· ${countChars(body)} 字 · 目标 ${wordTargetLabel(project)}
> 归档路径：${path}（FileBrowser 尚未连接，这里只是路径约定）
> ${compliance}

${body || "还没有正文。"}
`;
  }

  const step = STEPS.find((item) => item.id === project.currentStep)?.title ?? "";
  const status = project.confirmed[3] ? "润色已确认" : "进行中";
  const notes = [1, 2, 3]
    .map((id) => {
      const found = reviewsForStep(project, id as 1 | 2 | 3);
      if (!found.length) return "";
      const body = found.map((note) => `### ${note.readerName}\n\n${note.text.trim()}`).join("\n\n");
      return `## 第 ${id} 步的读者意见\n\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return `# ${project.title}

- 状态：${status}
- 当前步骤：${step}
- 起点：${project.startFrom}
- 目标字数：${wordTargetLabel(project)}
- 归档路径：${path}（FileBrowser 尚未连接，这里只是路径约定）
- 更新：${formatWhen(project.updatedAt)}
- ${compliance}

## 想法

${project.idea.trim() || "（空）"}

## 大纲

${project.outline.trim() || "（空）"}

## 初稿

${project.draft.trim() || "（空）"}

## 润色稿

${project.polished.trim() || "（空）"}

${notes || "## 读者意见\n\n（这一版没有留下读者意见）"}

## 结构质检

${project.qualityReport?.text.trim() || "（还没有质检）"}
`;
}
