import { DocsLocaleArticle } from "@/components/docs-article";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.docsApi");
}

export default function DocsApiPage() {
  return <DocsLocaleArticle slug="api" />;
}
