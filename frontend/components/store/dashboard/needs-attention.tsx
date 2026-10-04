import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StoreArrowLink, StoreSectionCard } from "@/components/store/store-cards";
import { StorePill } from "@/components/store/status-pill";
import { formatTime } from "@/components/store/format";
import { MobileSectionTitle } from "@/components/store/dashboard/mobile-section-title";
import type { AttentionItem } from "@/components/store/dashboard/dashboard-data";

function itemContent(item: AttentionItem) {
  if (item.kind === "arrival") {
    const { order } = item;
    const arrivedAt = order.arrivedAt ? ` at ${formatTime(order.arrivedAt)}` : "";
    return {
      key: `arrival-${order.id}`,
      title: `${order.orderNumber} arrived at the dock`,
      mobileTitle: `${order.orderNumber} arrived`,
      pill: <StorePill tone="success">Arrived</StorePill>,
      body: `${order.vehicleCode ?? "The vehicle"} arrived at the rear dock${arrivedAt}. Count the items and sign off.`,
      href: `/store/deliveries/${order.orderNumber}`,
      linkLabel: "Confirm Delivery",
      mobileLinkLabel: "Confirm Delivery",
      isPrimaryAction: true,
    };
  }
  const { issue } = item;
  return {
    key: `issue-${issue.code}`,
    title: `Issue ${issue.code} on ${issue.orderNumber}`,
    mobileTitle: `Issue ${issue.code}`,
    pill: <StorePill tone="warning">Review</StorePill>,
    body: issue.summary,
    href: `/store/issues?search=${encodeURIComponent(issue.orderNumber || issue.code)}`,
    linkLabel: "View Issue Details",
    mobileLinkLabel: "View Issue",
    isPrimaryAction: false,
  };
}

export function NeedsAttention({ items, className }: { items: AttentionItem[]; className?: string }) {
  const entries = items.map(itemContent);
  const countLabel = `${items.length} ${items.length === 1 ? "item" : "items"}`;

  return (
    <div className={className}>
      {/* Desktop */}
      <StoreSectionCard
        className="hidden h-full gap-2 xl:flex"
        title="Needs Your Attention"
        description="Actions requiring your review"
        action={items.length > 0 && <StorePill tone="destructive">{countLabel}</StorePill>}
      >
        {entries.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.key} className="flex flex-col gap-2 py-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">{entry.title}</p>
                  {entry.pill}
                </div>
                <p className="text-sm text-foreground/80">{entry.body}</p>
                <StoreArrowLink href={entry.href} className="w-fit">
                  {entry.linkLabel}
                </StoreArrowLink>
              </li>
            ))}
          </ul>
        )}
      </StoreSectionCard>

      {/* Mobile */}
      <section className="flex flex-col gap-4 xl:hidden" aria-labelledby="needs-attention-mobile">
        <MobileSectionTitle
          id="needs-attention-mobile"
          title="Needs Your Attention"
          trailing={
            items.length > 0 && (
              <StorePill tone="destructive">
                {items.length}
                <span className="sr-only"> {items.length === 1 ? "item" : "items"}</span>
              </StorePill>
            )
          }
        />
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        )}
        {entries.map((entry) => (
          <Card key={entry.key} className="gap-2 rounded-lg p-4 ring-border">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-primary">{entry.mobileTitle}</p>
              {entry.pill}
            </div>
            <p className="text-sm text-foreground/80">{entry.body}</p>
            {entry.isPrimaryAction ? (
              <Button asChild className="h-11 w-full text-base font-bold">
                <Link href={entry.href}>{entry.mobileLinkLabel}</Link>
              </Button>
            ) : (
              <StoreArrowLink href={entry.href} className="w-fit">
                {entry.mobileLinkLabel}
              </StoreArrowLink>
            )}
          </Card>
        ))}
      </section>
    </div>
  );
}
