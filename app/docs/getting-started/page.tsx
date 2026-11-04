import { DocsLocaleArticle } from "@/components/docs-article";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.docsStart");
}

export default function DocsGettingStartedPage() {
  return <DocsLocaleArticle slug="getting-started" />;
}
