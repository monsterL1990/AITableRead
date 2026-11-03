import type { Metadata } from "next";
import { DocsArticle } from "@/components/docs-article";

export const metadata: Metadata = { title: "AI读者与提示词" };

export default function DocsReadersPage() {
  return <DocsArticle slug="readers" />;
}
