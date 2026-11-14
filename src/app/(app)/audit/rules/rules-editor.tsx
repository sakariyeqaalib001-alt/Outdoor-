"use client";

import { useState, useTransition } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isRuleCode, RULE_THRESHOLDS } from "@/lib/audit";
import { t, type MessageKey } from "@/lib/i18n";
import { updateRule, type ActionResult } from "@/server/audit/actions";
import type { RuleRow } from "@/server/audit/queries";

function RuleCard({ rule, canEdit }: { rule: RuleRow; canEdit: boolean }) {
  const fields = isRuleCode(rule.code) ? RULE_THRESHOLDS[rule.code] ?? [] : [];
  const [enabled, setEnabled] = useState(rule.enabled);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, String(rule.threshold[f.key] ?? "")])));
  const [result, setResult] = useState<ActionResult>();
  const [pending, start] = useTransition();
  const name = isRuleCode(rule.code) ? t(`audit.rules.${rule.code}.name` as MessageKey) : rule.code;
  const explain = isRuleCode(rule.code) ? t(`audit.rules.${rule.code}.explain` as MessageKey) : "";
  const editable = canEdit && (rule.can_disable || fields.length > 0);

  const save = () =>
    start(async () => {
      const threshold = Object.fromEntries(fields.map((f) => [f.key, Number(values[f.key])]));
      setResult(await updateRule(rule.code, enabled, threshold));
    });

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{name}</span>
              <Badge variant="outline">{rule.code}</Badge>
              {!rule.can_disable ? <Badge variant="secondary">{t("audit.ruleCore")}</Badge> : null}
              {!rule.opens_case ? <Badge variant="secondary">{t("audit.ruleEventOnly")}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">{explain}</p>
          </div>
          <StatusBadge status={rule.enabled ? "active" : "reversed"} label={t(rule.enabled ? "audit.ruleOn" : "audit.ruleOff")} />
        </div>
        {editable ? (
          <div className="flex flex-wrap items-end gap-4">
            {rule.can_disable ? (
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
                {t("audit.ruleEnabled")}
              </label>
            ) : null}
            {fields.map((f) => (
              <div key={f.key} className="grid gap-1">
                <Label htmlFor={`${rule.code}-${f.key}`}>{t(f.label)}</Label>
                <Input
                  id={`${rule.code}-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  className="w-28"
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                />
              </div>
            ))}
            <Button className="h-11 md:h-9" disabled={pending} onClick={save}>{t("audit.save")}</Button>
          </div>
        ) : null}
        {result ? <FormMessage error={result.error} notice={result.message} /> : null}
      </CardContent>
    </Card>
  );
}

export function RulesEditor({ rules, canEdit }: { rules: RuleRow[]; canEdit: boolean }) {
  return <div className="grid gap-3">{rules.map((r) => <RuleCard key={r.code} rule={r} canEdit={canEdit} />)}</div>;
}
