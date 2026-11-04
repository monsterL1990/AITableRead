import { PipelineWorkspace } from "@/components/pipeline-workspace";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.project");
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PipelineWorkspace id={id} />;
}
