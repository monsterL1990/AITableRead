import type { Metadata } from "next";
import { DocsArticle } from "@/components/docs-article";

export const metadata: Metadata = { title: "开始使用" };

export default function DocsGettingStartedPage() {
  return <DocsArticle slug="getting-started" />;
}
