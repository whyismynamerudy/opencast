import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AUTH_COOKIE, isAdminSession } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage() {
  const cookieStore = await cookies();
  if (isAdminSession(cookieStore.get(AUTH_COOKIE)?.value)) redirect("/");
  return <LoginForm />;
}
