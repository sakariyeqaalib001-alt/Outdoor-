-- =====================================================================================
-- Sogasho Outdoor — ONE-TIME MAINTENANCE: clear stock TEST data before real opening stock
-- Owner request, 22 Oct 2026 (staging "Outdoor"). NOT a migration: run it by hand, once, in the
-- Supabase SQL Editor, only when every stock movement so far is test data.
--
-- What it does (all-or-nothing):
--   * deletes all rows of stock_movements, stock_transfer_lines, stock_transfers, stock_adjustments
--     → every stock balance is 0 again
--   * keeps stock items, locations (Central, faulty, one per team), teams, users and settings
--   * the deletions are recorded in change_log, and one activity_log row records the reset
-- Safety:
--   * refuses if any sale exists (public.sales arrives in Phase 7) — real stock is never wiped
--   * the append-only locks are switched off only inside this transaction and switched on again
-- =====================================================================================
begin;

do $reset$
declare
  v_movements int;
  v_transfers int;
  v_adjustments int;
begin
  if to_regclass('public.sales') is not null then
    execute 'select count(*) from public.sales' into v_movements;
    if v_movements > 0 then
      raise exception 'Sales exist — stock can no longer be reset. Nothing was changed.';
    end if;
  end if;

  select count(*) into v_movements from public.stock_movements;
  select count(*) into v_transfers from public.stock_transfers;
  select count(*) into v_adjustments from public.stock_adjustments;

  alter table public.stock_movements disable trigger stock_movements_append_only;
  alter table public.stock_transfer_lines disable trigger stock_transfer_lines_append_only;

  delete from public.stock_movements;
  delete from public.stock_transfer_lines;
  delete from public.stock_transfers;
  delete from public.stock_adjustments;

  alter table public.stock_movements enable trigger stock_movements_append_only;
  alter table public.stock_transfer_lines enable trigger stock_transfer_lines_append_only;

  insert into public.activity_log (actor_id, action, entity_type, details)
  values (null, 'stock.test_data_reset', 'stock_movements',
          jsonb_build_object('movements', v_movements, 'transfers', v_transfers, 'adjustments', v_adjustments,
                             'note', 'Test data cleared by the owner before opening stock'));

  raise notice 'Deleted % movements, % issues, % adjustments', v_movements, v_transfers, v_adjustments;
end
$reset$;

commit;

select
  (select count(*) from public.stock_movements) as movements_left,
  (select count(*) from public.stock_transfers) as issues_left,
  (select count(*) from public.stock_adjustments) as adjustments_left,
  'Stock test data cleared — all balances are 0' as result;
