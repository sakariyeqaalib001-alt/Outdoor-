"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { savePlan, savePlanPrice, saveProduct } from "@/server/settings/actions";
import type { PlanPriceRow, PlanRow, ProductRow } from "@/server/settings/queries";

type PriceState = "current" | "upcoming" | "ended";

/** Dates are "YYYY-MM-DD", so string comparison is date comparison. */
function priceState(p: PlanPriceRow, today: string): PriceState {
  if (p.effective_from > today) return "upcoming";
  if (p.effective_to !== null && p.effective_to < today) return "ended";
  return "current";
}

const STATE_BADGE = { current: "approved", upcoming: "pending", ended: "reversed" } as const;

function DialogButtons({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose}>{t("settings.close")}</Button>
      <Button type="submit" disabled={pending}>{pending ? t("settings.saving") : t("settings.save")}</Button>
    </DialogFooter>
  );
}

function ActiveBox({ checked }: { checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="active" value="true" defaultChecked={checked} className="size-4 accent-[#047B95]" />
      {t("settings.isActive")}
    </label>
  );
}

function ProductDialog({ product, onClose }: { product?: ProductRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(saveProduct, undefined);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-xl">{t(product ? "products.editProduct" : "products.addProduct")}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {product ? <input type="hidden" name="id" value={product.id} /> : null}
          <div className="space-y-2">
            <Label htmlFor="code">{t("products.code")}</Label>
            {product ? (
              <div id="code" className="font-mono text-sm">{product.code}</div>
            ) : (
              <>
                <Input id="code" name="code" required pattern="[A-Za-z][A-Za-z0-9_]{1,19}" className="h-11 font-mono uppercase md:h-9" aria-describedby="code-hint" />
                <p id="code-hint" className="text-xs text-muted-foreground">{t("products.codeHint")}</p>
              </>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{t("products.name")}</Label>
            <Input id="name" name="name" required minLength={2} maxLength={60} defaultValue={product?.name} className="h-11 md:h-9" />
          </div>
          <ActiveBox checked={product?.is_active ?? true} />
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogButtons pending={pending} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({ plan, products, productId, onClose }: { plan?: PlanRow; products: ProductRow[]; productId: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(savePlan, undefined);
  const choosable = products.filter((p) => p.is_active || p.id === plan?.product_id);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-xl">{t(plan ? "products.editPlan" : "products.addPlan")}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
          <div className="space-y-2">
            <Label htmlFor="productId">{t("products.product")}</Label>
            <NativeSelect id="productId" name="productId" defaultValue={plan?.product_id ?? productId} disabled={Boolean(plan)} aria-describedby={plan ? "product-fixed" : undefined}>
              {choosable.map((p) => (
                <option key={p.id} value={p.id}>{p.code}</option>
              ))}
            </NativeSelect>
            {plan ? (
              <>
                <input type="hidden" name="productId" value={plan.product_id} />
                <p id="product-fixed" className="text-xs text-muted-foreground">{t("products.productFixed")}</p>
              </>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{t("products.name")}</Label>
            <Input id="name" name="name" required minLength={2} maxLength={60} defaultValue={plan?.name} className="h-11 md:h-9" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="download">{t("products.download")}</Label>
              <Input id="download" name="download" required inputMode="numeric" pattern="\d+" defaultValue={plan?.download_mbps} className="h-11 tabular-nums md:h-9" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="upload">{t("products.upload")}</Label>
              <Input id="upload" name="upload" required inputMode="numeric" pattern="\d+" defaultValue={plan?.upload_mbps} className="h-11 tabular-nums md:h-9" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="data">{t("products.data")}</Label>
            <Input id="data" name="data" maxLength={40} defaultValue={plan?.data_allowance ?? "Unlimited"} className="h-11 md:h-9" aria-describedby="data-hint" />
            <p id="data-hint" className="text-xs text-muted-foreground">{t("products.dataHint")}</p>
          </div>
          <ActiveBox checked={plan?.is_active ?? true} />
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogButtons pending={pending} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({
  price,
  planId,
  planOptions,
  onClose,
}: {
  price?: PlanPriceRow;
  planId: string;
  planOptions: { id: string; label: string }[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(savePlanPrice, undefined);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-xl">{t(price ? "products.editPrice" : "products.addPrice")}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {price ? <input type="hidden" name="id" value={price.id} /> : null}
          <div className="space-y-2">
            <Label htmlFor="planId">{t("products.plan")}</Label>
            <NativeSelect id="planId" name="planId" defaultValue={price?.plan_id ?? planId} required>
              {planOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recharge">{t("products.recharge")}</Label>
              <Input id="recharge" name="recharge" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={price?.recharge_amount} className="h-11 tabular-nums md:h-9" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="installation">{t("products.installation")}</Label>
              <Input id="installation" name="installation" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={price?.installation_fee ?? 0} className="h-11 tabular-nums md:h-9" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="from">{t("products.from")}</Label>
              <Input id="from" name="from" type="date" required defaultValue={price?.effective_from} className="h-11 md:h-9" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">{t("products.to")}</Label>
              <Input id="to" name="to" type="date" defaultValue={price?.effective_to ?? ""} className="h-11 md:h-9" aria-describedby="to-hint" />
            </div>
          </div>
          <p id="to-hint" className="text-xs text-muted-foreground">{t("products.toHint")}</p>
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogButtons pending={pending} onClose={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} onClick={onClick}>
      <Pencil aria-hidden="true" />
    </Button>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return <StatusBadge status={active ? "active" : "reversed"} label={t(active ? "settings.active" : "settings.inactive")} />;
}

/** Products, their plans and the plan price history (FR-CONF-01, 05; D-34). */
export function ProductsView({
  products,
  plans,
  prices,
  today,
  canManage,
}: {
  products: ProductRow[];
  plans: PlanRow[];
  prices: PlanPriceRow[];
  today: string;
  canManage: boolean;
}) {
  const [productFilter, setProductFilter] = useState<string>("all");
  const [productDialog, setProductDialog] = useState<{ product?: ProductRow; key: number } | null>(null);
  const [planDialog, setPlanDialog] = useState<{ plan?: PlanRow; key: number } | null>(null);
  const [priceDialog, setPriceDialog] = useState<{ price?: PlanPriceRow; key: number } | null>(null);

  const productById = Object.fromEntries(products.map((p) => [p.id, p]));
  const planById = Object.fromEntries(plans.map((p) => [p.id, p]));
  const planLabel = (plan: PlanRow) => `${productById[plan.product_id]?.code ?? ""} · ${plan.name}`;
  const currentPrice = (planId: string) => prices.find((p) => p.plan_id === planId && priceState(p, today) === "current");
  const productOrder = (id: string) => products.findIndex((p) => p.id === id);

  const shownPlans = plans
    .filter((p) => productFilter === "all" || p.product_id === productFilter)
    .sort((a, b) => productOrder(a.product_id) - productOrder(b.product_id));
  const shownPrices = prices.filter((p) => productFilter === "all" || planById[p.plan_id]?.product_id === productFilter);
  const planOptions = plans
    .filter((p) => p.is_active)
    .sort((a, b) => productOrder(a.product_id) - productOrder(b.product_id))
    .map((p) => ({ id: p.id, label: planLabel(p) }));
  const defaultProduct = productFilter === "all" ? products.find((p) => p.is_active)?.id ?? "" : productFilter;
  const defaultPlan = shownPlans.find((p) => p.is_active)?.id ?? planOptions[0]?.id ?? "";

  return (
    <div className="grid gap-4">
      {!canManage ? <p className="text-sm text-muted-foreground">{t("products.readOnly")}</p> : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="brand-title text-lg">{t("products.products")}</CardTitle>
            <CardDescription>{t("products.productsIntro")}</CardDescription>
          </div>
          {canManage ? (
            <Button onClick={() => setProductDialog({ key: Date.now() })} className="h-11 md:h-9">
              <Plus aria-hidden="true" />
              {t("products.addProduct")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("products.code")}</TableHead>
                <TableHead>{t("products.name")}</TableHead>
                <TableHead className="text-right">{t("products.plansCount")}</TableHead>
                <TableHead>{t("settings.status")}</TableHead>
                {canManage ? <TableHead className="w-12"><span className="sr-only">{t("settings.edit")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-semibold">{p.code}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{plans.filter((pl) => pl.product_id === p.id && pl.is_active).length}</TableCell>
                  <TableCell><ActiveBadge active={p.is_active} /></TableCell>
                  {canManage ? (
                    <TableCell>
                      <EditButton label={`${t("products.editProduct")}: ${p.code}`} onClick={() => setProductDialog({ product: p, key: Date.now() })} />
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="w-full space-y-1 sm:w-56">
        <Label htmlFor="product-filter">{t("products.product")}</Label>
        <NativeSelect id="product-filter" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
          <option value="all">{t("products.allProducts")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.code}</option>
          ))}
        </NativeSelect>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="brand-title text-lg">{t("products.plans")}</CardTitle>
            <CardDescription>{t("products.plansIntro")}</CardDescription>
          </div>
          {canManage ? (
            <Button onClick={() => setPlanDialog({ key: Date.now() })} className="h-11 md:h-9">
              <Plus aria-hidden="true" />
              {t("products.addPlan")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("products.product")}</TableHead>
                <TableHead>{t("products.plan")}</TableHead>
                <TableHead className="text-right">{t("products.recharge")}</TableHead>
                <TableHead className="text-right">{t("products.installation")}</TableHead>
                <TableHead>{t("products.speed")}</TableHead>
                <TableHead>{t("products.data")}</TableHead>
                <TableHead>{t("settings.status")}</TableHead>
                {canManage ? <TableHead className="w-12"><span className="sr-only">{t("settings.edit")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownPlans.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 8 : 7} className="py-10 text-center text-muted-foreground">{t("products.noPlans")}</TableCell>
                </TableRow>
              ) : (
                shownPlans.map((plan) => {
                  const price = currentPrice(plan.id);
                  return (
                    <TableRow key={plan.id}>
                      <TableCell className="font-mono">{productById[plan.product_id]?.code}</TableCell>
                      <TableCell className="font-semibold">{plan.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {price ? formatUSD(Number(price.recharge_amount)) : plan.is_active ? <StatusBadge status="pending" label={t("products.missingPrice")} /> : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{price ? formatUSD(Number(price.installation_fee)) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{`${plan.download_mbps} / ${plan.upload_mbps} Mbps`}</TableCell>
                      <TableCell>{plan.data_allowance}</TableCell>
                      <TableCell><ActiveBadge active={plan.is_active} /></TableCell>
                      {canManage ? (
                        <TableCell>
                          <EditButton label={`${t("products.editPlan")}: ${planLabel(plan)}`} onClick={() => setPlanDialog({ plan, key: Date.now() })} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="brand-title text-lg">{t("products.priceHistory")}</CardTitle>
            <CardDescription>{t("products.priceHistoryIntro")}</CardDescription>
          </div>
          {canManage && planOptions.length > 0 ? (
            <Button onClick={() => setPriceDialog({ key: Date.now() })} className="h-11 md:h-9">
              <Plus aria-hidden="true" />
              {t("products.addPrice")}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("products.plan")}</TableHead>
                <TableHead className="text-right">{t("products.recharge")}</TableHead>
                <TableHead className="text-right">{t("products.installation")}</TableHead>
                <TableHead>{t("products.from")}</TableHead>
                <TableHead>{t("products.to")}</TableHead>
                <TableHead>{t("settings.status")}</TableHead>
                {canManage ? <TableHead className="w-12"><span className="sr-only">{t("settings.edit")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownPrices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 7 : 6} className="py-10 text-center text-muted-foreground">{t("products.noPrices")}</TableCell>
                </TableRow>
              ) : (
                shownPrices.map((p) => {
                  const state = priceState(p, today);
                  const plan = planById[p.plan_id];
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-semibold">{plan ? planLabel(plan) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSD(Number(p.recharge_amount))}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSD(Number(p.installation_fee))}</TableCell>
                      <TableCell className="tabular-nums">{formatDateOnly(p.effective_from)}</TableCell>
                      <TableCell className="tabular-nums">
                        {p.effective_to ? formatDateOnly(p.effective_to) : <span className="text-muted-foreground">{t("products.openEnded")}</span>}
                      </TableCell>
                      <TableCell><StatusBadge status={STATE_BADGE[state]} label={t(`products.${state}`)} /></TableCell>
                      {canManage ? (
                        <TableCell>
                          <EditButton label={`${t("products.editPrice")}: ${plan ? planLabel(plan) : ""}`} onClick={() => setPriceDialog({ price: p, key: Date.now() })} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {productDialog ? <ProductDialog key={productDialog.key} product={productDialog.product} onClose={() => setProductDialog(null)} /> : null}
      {planDialog ? (
        <PlanDialog key={planDialog.key} plan={planDialog.plan} products={products} productId={defaultProduct} onClose={() => setPlanDialog(null)} />
      ) : null}
      {priceDialog ? (
        <PriceDialog
          key={priceDialog.key}
          price={priceDialog.price}
          planId={defaultPlan}
          planOptions={
            priceDialog.price && !planOptions.some((o) => o.id === priceDialog.price!.plan_id) && planById[priceDialog.price.plan_id]
              ? [...planOptions, { id: priceDialog.price.plan_id, label: planLabel(planById[priceDialog.price.plan_id]) }]
              : planOptions
          }
          onClose={() => setPriceDialog(null)}
        />
      ) : null}
    </div>
  );
}
