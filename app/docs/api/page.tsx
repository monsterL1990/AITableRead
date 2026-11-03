import type { Metadata } from "next";
import { DocsArticle } from "@/components/docs-article";

export const metadata: Metadata = { title: "API配置" };

export default function DocsApiPage() {
  return <DocsArticle slug="api" />;
}
