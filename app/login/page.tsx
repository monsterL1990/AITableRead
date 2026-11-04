import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { authEnabled } from "@/lib/auth-mode";

export const metadata: Metadata = { title: "进入围读" };

export default function LoginPage() {
  if (!authEnabled()) redirect("/");
  return <LoginForm />;
}
