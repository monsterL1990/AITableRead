export const DOCS_NAV = [
  { slug: "overview", href: "/docs", label: "概述", file: "overview.md", showCover: true },
  { slug: "getting-started", href: "/docs/getting-started", label: "开始使用", file: "getting-started.md", showCover: false },
  { slug: "readers", href: "/docs/readers", label: "AI读者与提示词", file: "readers.md", showCover: false },
  { slug: "api", href: "/docs/api", label: "API配置", file: "api.md", showCover: false },
] as const;

export type DocSlug = (typeof DOCS_NAV)[number]["slug"];

export function docBySlug(slug: DocSlug) {
  const found = DOCS_NAV.find((item) => item.slug === slug);
  if (!found) throw new Error(`未知说明页：${slug}`);
  return found;
}

/** /docs and its subroutes stay readable without a session. */
export function isDocsPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}
