# Refunds (Phase 12)

BRD §6.5 (FR-REF-01…08), BR-03, D-15; SDD §10.5; technical choices T-28.

## Who does what

| Step | Who | Where |
|---|---|---|
| Ask for a refund | The sale's agent (own sales), their Team Leader (team's sales, own included), Super Admin | Sales → open the sale → **Request refund** |
| Approve or reject | **Super Admin only** — never a refund they asked for themselves | **Refunds** (also linked from Approvals) |
| Take the device back | **Stock Officer only** | Stock → Returns → **refunds: devices to collect** |

## Rules

- Only an **approved** sale can be refunded. One refund waiting or approved per sale; after a rejection a new request may be sent.
- Amount: more than $0 and not more than the amount collected on the sale.
- Reasons: Out of boundary, Technical delay, Refused, No signal, Other (Other needs a note).
- **Waiting** refunds change nothing: the sale keeps counting.
- **Rejected** refunds change nothing (a reason is required and shown to the person who asked).
- **Approved** refunds mark the sale **Refunded**. The sale is kept with its whole history (approval, device given), but it no longer counts for targets, the dashboard or pay. This cannot be undone.
- Pay (FR-REF-07): if the sale's counting month is not finalized yet, the sale simply drops out of that month. If the month was already finalized (from Phase 16), a correction (−1 unit, −amount) waits for the next payroll run; finalized payroll is never edited.
- Devices: when an approved refund's sale had a device, Stock Officers are notified. Record the device only when it is physically back; tick **Faulty** to put it in the faulty store. You can never record more than the sale gave.

## Audit rule HIGH_REFUND_RATE

Off by default (Audit → Rules). When on, an agent whose approved refunds within the period reach the set share of their approved sales (and at least the set number of refunds) gets one audit event and case per period. Defaults: 20 %, 3 refunds, 30 days.

## Checking in the SQL Editor (read only)

```sql
select status, count(*) from public.refunds group by status;
select * from public.payroll_pending_adjustments order by created_at desc;
```
