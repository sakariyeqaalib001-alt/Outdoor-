"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Mail, Plus } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { NEXT_STATUS, type CaseStatus } from "@/lib/audit";
import { t } from "@/lib/i18n";
import { addCaseNote, assignCase, createCase, sendEmailsNow, setCaseStatus, type ActionResult } from "@/server/audit/actions";

function NoteField({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={1000}
        rows={3}
        className="min-h-20 rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
    </div>
  );
}

/** Super Admin: open a case by hand, optionally about one sale (its agent and customer are linked too). */
export function NewCaseButton({ saleId = null, label }: { saleId?: string | null; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult>();
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await createCase(title, note, saleId);
      setResult(r);
      if (r.ok && r.id) router.push(`/audit/cases/${r.id}`);
    });
  return (
    <>
      <Button variant={saleId ? "outline" : "default"} className="h-11 justify-self-start md:h-9" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {label ?? t("audit.newCase")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("audit.newCaseTitle")}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="case-title">{t("audit.caseTitle")}</Label>
              <Input id="case-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <NoteField id="case-note" label={t("audit.note")} value={note} onChange={setNote} />
            {result?.error ? <FormMessage error={result.error} /> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("audit.cancel")}</Button>
            <Button disabled={pending} onClick={submit}>{t("audit.openCase")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Email queue status + "Send now" (Super Admin). */
export function EmailBox({ summary }: { summary: { pending: number; failed: number; sent: number } }) {
  const [result, setResult] = useState<ActionResult>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm">
      <span className="flex items-center gap-2">
        <Mail aria-hidden="true" className="size-4 text-muted-foreground" />
        {t("audit.email.summary", { pending: String(summary.pending), failed: String(summary.failed), sent: String(summary.sent) })}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        {result ? <FormMessage error={result.error} notice={result.message} /> : null}
        <Button variant="outline" className="h-11 md:h-9" disabled={pending} onClick={() => start(async () => setResult(await sendEmailsNow()))}>
          {t("audit.email.sendNow")}
        </Button>
      </div>
    </div>
  );
}

/** State change (note required), note, and assignment — the database decides who may act (FR-AUD-07). */
export function CaseActions({
  caseId,
  status,
  assignedTo,
  canAct,
  canAssign,
  assignees,
}: {
  caseId: string;
  status: CaseStatus;
  assignedTo: string | null;
  canAct: boolean;
  canAssign: boolean;
  assignees: { id: string; name: string }[];
}) {
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(assignedTo ?? "");
  const [result, setResult] = useState<ActionResult>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) setNote("");
    });

  return (
    <div className="grid gap-4">
      {canAct ? (
        <>
          <NoteField id="case-action-note" label={t("audit.noteRequired")} value={note} onChange={setNote} />
          <div className="flex flex-wrap gap-2">
            {NEXT_STATUS[status].map((next) => (
              <Button
                key={next}
                variant={next === "confirmed_issue" ? "destructive" : "default"}
                className="h-11 md:h-9"
                disabled={pending}
                onClick={() => run(() => setCaseStatus(caseId, next, note))}
              >
                {t(`audit.moveTo.${next}`)}
              </Button>
            ))}
            <Button variant="outline" className="h-11 md:h-9" disabled={pending} onClick={() => run(() => addCaseNote(caseId, note))}>
              {t("audit.addNote")}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("audit.readOnly")}</p>
      )}
      {canAssign && status !== "resolved" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-2">
            <Label htmlFor="case-assignee">{t("audit.assignTo")}</Label>
            <NativeSelect id="case-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{t("audit.unassigned")}</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </div>
          <Button variant="outline" className="h-11 md:h-9" disabled={pending} onClick={() => run(() => assignCase(caseId, assignee || null, note))}>
            {t("audit.assign")}
          </Button>
        </div>
      ) : null}
      {result ? <FormMessage error={result.error} notice={result.message} /> : null}
    </div>
  );
}
