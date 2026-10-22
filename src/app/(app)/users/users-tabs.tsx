import { PageTabs } from "@/components/page-tabs";

export function UsersTabs() {
  return (
    <PageTabs
      label="nav.users"
      tabs={[
        { href: "/users", label: "users.tabUsers" },
        { href: "/users/teams", label: "users.tabTeams" },
        { href: "/users/roles", label: "users.tabRoles" },
      ]}
    />
  );
}
