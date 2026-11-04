import { complianceHandoff, complianceNoteForRoute } from "./compliance";
import { archivePath, countChars, formatWhen } from "./format";
import type { Locale } from "./i18n/locale";
import { localize, translate } from "./i18n/translate";
import { STEPS, reviewsForStep, wordTargetLabel } from "./pipeline";
import type { Project, TextRoute } from "./types";

export function currentProse(project: Project): string {
  return project.polished.trim() || project.draft.trim();
}

export function projectToMarkdown(
  project: Project,
  scope: "full" | "current",
  routeInfo?: { textRoute: TextRoute; dshConfigured?: boolean; byokPurge?: boolean },
  locale: Locale = "zh",
): string {
  const L = (text: string) => localize(locale, text);
  const path = archivePath(project.ownerId, project.id);
  const handoff = routeInfo
    ? complianceNoteForRoute(routeInfo.textRoute, routeInfo.dshConfigured === true, routeInfo.byokPurge === true)
    : complianceHandoff();
  const compliance = `${L("合规：本文件不含合规修改标记。")}${L(handoff.note)}`;
  const archiveLine = `${L("归档路径：")}${path}${L("（FileBrowser 尚未连接，这里只是路径约定）")}`;
  if (scope === "current") {
    const body = currentProse(project).trim();
    const which = project.polished.trim() ? "润色稿" : project.draft.trim() ? "初稿" : "空";
    return `# ${project.title}

> ${L("当前正文")}（${L(which)}）· ${countChars(body)} ${L("字")} · ${L("目标")} ${L(wordTargetLabel(project))}
> ${archiveLine}
> ${compliance}

${body || L("还没有正文。")}
`;
  }

  const step = STEPS.find((item) => item.id === project.currentStep)?.title ?? "";
  const status = project.confirmed[3] ? "润色已确认" : "进行中";
  const notes = [1, 2, 3]
    .map((id) => {
      const found = reviewsForStep(project, id as 1 | 2 | 3);
      if (!found.length) return "";
      const body = found.map((note) => `### ${note.readerName}\n\n${note.text.trim()}`).join("\n\n");
      const heading = locale === "en" ? translate("en", "md.stepNotes", { step: id }) : `第 ${id} 步的读者意见`;
      return `## ${heading}\n\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const emptyMark = locale === "en" ? L("（空）") : "（空）";
  return `# ${project.title}

- ${L("状态：")}${L(status)}
- ${L("当前步骤：")}${L(step)}
- ${L("起点：")}${project.startFrom}
- ${L("目标字数：")}${L(wordTargetLabel(project))}
- ${archiveLine}
- ${L("更新：")}${L(formatWhen(project.updatedAt))}
- ${compliance}

## ${L("想法")}

${project.idea.trim() || emptyMark}

## ${L("大纲")}

${project.outline.trim() || emptyMark}

## ${L("初稿")}

${project.draft.trim() || emptyMark}

## ${L("润色稿")}

${project.polished.trim() || emptyMark}

${notes || (locale === "en" ? translate("en", "md.noNotesHeading") : "## 读者意见\n\n（这一版没有留下读者意见）")}

## ${L("结构质检")}

${project.qualityReport?.text.trim() || L("（还没有质检）")}
`;
}
