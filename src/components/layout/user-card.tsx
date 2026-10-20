import { CircleUserRound, LogOut } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { t } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/server/auth/actions";
import { getSessionInfo } from "@/server/auth/session";

/** Signed-in user and sign-out, at the bottom of the sidebar. Reads the session, so it renders inside <Suspense>. */
export async function UserCard() {
  const supabase = await createSupabaseServerClient();
  const info = supabase ? await getSessionInfo(supabase) : null;
  const name = info?.full_name ?? t("user.notSignedIn");
  const role = info?.employment_type ? t(`user.${info.employment_type}`) : "";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          <CircleUserRound className="size-8 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{role}</span>
          </span>
        </div>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <form action={signOut}>
          <SidebarMenuButton type="submit" tooltip={t("user.signOut")}>
            <LogOut aria-hidden="true" />
            <span>{t("user.signOut")}</span>
          </SidebarMenuButton>
        </form>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
