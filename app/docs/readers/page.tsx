import { DocsLocaleArticle } from "@/components/docs-article";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.docsReaders");
}

export default function DocsReadersPage() {
  return <DocsLocaleArticle slug="readers" />;
}
