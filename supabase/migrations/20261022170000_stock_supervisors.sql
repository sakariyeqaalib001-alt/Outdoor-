-- Phase 6 addition (owner, 22 Oct 2026): stock is issued to an Outdoor Supervisor (the Team Leader of a
-- team), not to "a team". The Stock Officer has no right to read the user list, so this function returns
-- only what stock work needs: each active team with its Supervisor's name.

create or replace function public.stock_supervisors()
returns table (team_id uuid, team_name text, location_id uuid, supervisor_id uuid, supervisor_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, l.id, t.team_leader_id, p.full_name
  from public.teams t
  join public.stock_locations l on l.team_id = t.id
  left join public.user_profiles p on p.id = t.team_leader_id
  where t.is_active
    -- Stock Officers see every Supervisor; others only the teams whose stock they may read.
    and (app.has_permission('stock.receive') or app.has_permission('stock.transfer') or app.can_read_location(l.id))
  order by p.full_name nulls last, t.name
$$;

revoke execute on function public.stock_supervisors() from public, anon, authenticated, service_role;
grant execute on function public.stock_supervisors() to authenticated;
