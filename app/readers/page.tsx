import { ReaderDesk } from "@/components/reader-desk";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.readers");
}

export default function ReadersPage() {
  return <ReaderDesk />;
}
