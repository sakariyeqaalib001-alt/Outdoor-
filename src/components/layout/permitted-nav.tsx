import { getAccess } from "@/server/auth/access";
import { SidebarNav } from "./sidebar-nav";

/** Reads the signed-in user's permissions (per request, inside <Suspense>) and renders the filtered menu. */
export async function PermittedNav() {
  const access = await getAccess();
  return <SidebarNav permissions={Object.keys(access.permissions)} />;
}
