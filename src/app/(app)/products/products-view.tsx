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
import { savePrice, saveProduct } from "@/server/settings/actions";
import type { CityOption, PriceRow, ProductRow } from "@/server/settings/queries";

type PriceState = "current" | "upcoming" | "ended";

/** Dates are "YYYY-MM-DD", so string comparison is date comparison. */
function priceState(p: PriceRow, today: string): PriceState {
  if (p.effective_from > today) return "upcoming";
  if (p.effective_to !== null && p.effective_to < today) return "ended";
  return "current";
}

const STATE_BADGE = { current: "approved", upcoming: "pending", ended: "reversed" } as const;

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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="true" defaultChecked={product?.is_active ?? true} className="size-4 accent-[#047B95]" />
            {t("settings.isActive")}
          </label>
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("settings.close")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("settings.saving") : t("settings.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({ price, products, cities, onClose }: { price?: PriceRow; products: ProductRow[]; cities: CityOption[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(savePrice, undefined);
  const choosable = products.filter((p) => p.is_active || p.id === price?.product_id);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-xl">{t(price ? "products.editPrice" : "products.addPrice")}</DialogTitle>
        </DialogHeader>
        <form action={action} className="space-y-4">
          {price ? <input type="hidden" name="id" value={price.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="productId">{t("products.product")}</Label>
              <NativeSelect id="productId" name="productId" defaultValue={price?.product_id ?? choosable[0]?.id} required>
                {choosable.map((p) => (
                  <option key={p.id} value={p.id}>{p.code}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cityId">{t("products.city")}</Label>
              <NativeSelect id="cityId" name="cityId" defaultValue={price?.city_id ?? "all"}>
                <option value="all">{t("products.allCities")}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="price">{t("products.monthlyPrice")}</Label>
            <Input id="price" name="price" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={price?.monthly_price} className="h-11 tabular-nums md:h-9" />
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("settings.close")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("settings.saving") : t("settings.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Products and the price list (FR-CONF-01, 05; D-04: prices are entered by Super Admin). */
export function ProductsView({
  products,
  prices,
  cities,
  today,
  canManage,
}: {
  products: ProductRow[];
  prices: PriceRow[];
  cities: CityOption[];
  today: string;
  canManage: boolean;
}) {
  const [productDialog, setProductDialog] = useState<{ product?: ProductRow; key: number } | null>(null);
  const [priceDialog, setPriceDialog] = useState<{ price?: PriceRow; key: number } | null>(null);
  const cityName = Object.fromEntries(cities.map((c) => [c.id, c.name]));
  const productCode = Object.fromEntries(products.map((p) => [p.id, p.code]));
  const currentAllCities = (productId: string) =>
    prices.find((p) => p.product_id === productId && p.city_id === null && priceState(p, today) === "current");
  const hasCurrent = (productId: string) => prices.some((p) => p.product_id === productId && priceState(p, today) === "current");

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
                <TableHead>{t("products.allCities")}</TableHead>
                <TableHead>{t("settings.status")}</TableHead>
                {canManage ? <TableHead className="w-12"><span className="sr-only">{t("settings.edit")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const price = currentAllCities(p.id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-semibold">{p.code}</TableCell>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {price ? formatUSD(Number(price.monthly_price)) : p.is_active && !hasCurrent(p.id) ? (
                        <StatusBadge status="pending" label={t("products.missingPrice")} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.is_active ? "active" : "reversed"} label={t(p.is_active ? "settings.active" : "settings.inactive")} />
                    </TableCell>
                    {canManage ? (
                      <TableCell>
                        <Button variant="ghost" size="icon" aria-label={`${t("products.editProduct")}: ${p.code}`} onClick={() => setProductDialog({ product: p, key: Date.now() })}>
                          <Pencil aria-hidden="true" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="brand-title text-lg">{t("products.prices")}</CardTitle>
            <CardDescription>{t("products.pricesIntro")}</CardDescription>
          </div>
          {canManage ? (
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
                <TableHead>{t("products.product")}</TableHead>
                <TableHead>{t("products.city")}</TableHead>
                <TableHead className="text-right">{t("products.monthlyPrice")}</TableHead>
                <TableHead>{t("products.from")}</TableHead>
                <TableHead>{t("products.to")}</TableHead>
                <TableHead>{t("settings.status")}</TableHead>
                {canManage ? <TableHead className="w-12"><span className="sr-only">{t("settings.edit")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 7 : 6} className="py-10 text-center text-muted-foreground">{t("products.noPrices")}</TableCell>
                </TableRow>
              ) : (
                prices.map((p) => {
                  const state = priceState(p, today);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono font-semibold">{productCode[p.product_id]}</TableCell>
                      <TableCell>{p.city_id ? cityName[p.city_id] : t("products.allCities")}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSD(Number(p.monthly_price))}</TableCell>
                      <TableCell className="tabular-nums">{formatDateOnly(p.effective_from)}</TableCell>
                      <TableCell className="tabular-nums">{p.effective_to ? formatDateOnly(p.effective_to) : <span className="text-muted-foreground">{t("products.openEnded")}</span>}</TableCell>
                      <TableCell>
                        <StatusBadge status={STATE_BADGE[state]} label={t(`products.${state}`)} />
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <Button variant="ghost" size="icon" aria-label={`${t("products.editPrice")}: ${productCode[p.product_id]}`} onClick={() => setPriceDialog({ price: p, key: Date.now() })}>
                            <Pencil aria-hidden="true" />
                          </Button>
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
      {priceDialog ? (
        <PriceDialog key={priceDialog.key} price={priceDialog.price} products={products} cities={cities} onClose={() => setPriceDialog(null)} />
      ) : null}
    </div>
  );
}
