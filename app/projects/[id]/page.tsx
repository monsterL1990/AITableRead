import type { Metadata } from "next";
import { PipelineWorkspace } from "@/components/pipeline-workspace";

export const metadata: Metadata = { title: "稿件" };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PipelineWorkspace id={id} />;
}
