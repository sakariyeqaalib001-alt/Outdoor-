-- Pilot readiness checks (Phase 11) — paste into the Supabase SQL Editor of the project to check.
-- Read-only: changes nothing. Run one query at a time (select its lines, then Run), as the SQL Editor shows
-- only the last result. Change the city name for another city.

-- 1) Go-live checks: every row with required = true must show ok = true.
select check_key, required, ok, n, detail
from app.readiness_report((select id from public.cities where name = 'Hargeisa'));

-- 2) Opening stock: compare "received" with the Stock Officer's count; "difference" must be 0.
select code, received, adjusted, central, teams, in_transit, faulty, issued, removed, difference
from app.opening_stock_summary();
