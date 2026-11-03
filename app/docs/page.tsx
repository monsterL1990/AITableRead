import type { Metadata } from "next";
import { DocsArticle } from "@/components/docs-article";

export const metadata: Metadata = { title: "概述" };

export default function DocsOverviewPage() {
  return <DocsArticle slug="overview" />;
}
