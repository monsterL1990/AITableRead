import { PromptStudio } from "@/components/prompt-studio";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.prompts");
}

export default function PromptsPage() {
  return <PromptStudio />;
}
