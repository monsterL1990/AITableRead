import type { Metadata } from "next";
import { ReaderDesk } from "@/components/reader-desk";

export const metadata: Metadata = { title: "读者" };

export default function ReadersPage() {
  return <ReaderDesk />;
}
