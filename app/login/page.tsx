import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { authEnabled } from "@/lib/auth-mode";
import { pageMetadata } from "@/lib/i18n/request";

export function generateMetadata() {
  return pageMetadata("meta.login");
}

export default function LoginPage() {
  if (!authEnabled()) redirect("/");
  return <LoginForm />;
}
