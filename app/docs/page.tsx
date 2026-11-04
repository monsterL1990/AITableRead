import { DocsArticle } from "@/components/docs-article";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.docsOverview");
}

export default function DocsOverviewPage() {
  return <DocsArticle slug="overview" />;
}
