import type { Metadata } from "next";
import { PromptStudio } from "@/components/prompt-studio";

export const metadata: Metadata = { title: "提示词" };

export default function PromptsPage() {
  return <PromptStudio />;
}
