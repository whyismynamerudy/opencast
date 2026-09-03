import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, isAdminSession } from "@/lib/auth";
import { Workspace } from "@/components/Workspace";

export default async function Home() {
  const cookieStore = await cookies();
  if (!isAdminSession(cookieStore.get(AUTH_COOKIE)?.value)) redirect("/login");
  return <Workspace />;
}
