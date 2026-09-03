import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, isAdminSession } from "@/lib/auth";
import { Workspace } from "@/components/Workspace";

// One route serves the library (/) and the editor (/project/<id>). Projects
// live in the browser's IndexedDB, so the id is resolved client-side; the
// server only authenticates and validates the path shape.
export default async function Home({ params }: { params: Promise<{ slug?: string[] }> }) {
  const cookieStore = await cookies();
  if (!isAdminSession(cookieStore.get(AUTH_COOKIE)?.value)) redirect("/login");
  const { slug } = await params;
  if (!slug || slug.length === 0) return <Workspace />;
  if (slug[0] === "project" && slug.length === 2 && slug[1]) return <Workspace initialProjectId={decodeURIComponent(slug[1])} />;
  redirect("/");
}
