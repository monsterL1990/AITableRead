import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "进入围读" };

export default function LoginPage() {
  return <LoginForm />;
}
