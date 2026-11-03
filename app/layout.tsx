import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "围读",
    template: "%s · 围读",
  },
  description: "围读·AI写作围读工作流。大纲、初稿、润色，经读者把一节改到能留下。",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full text-foreground">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
