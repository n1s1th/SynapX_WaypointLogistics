import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StoreMetricCard } from "@/components/store/store-cards";
import { formatTime, greeting } from "@/components/store/format";
import { mockIssues, type StoreIssue as DashboardIssue } from "@/components/store/mock-data";
import { fetchStoreIssues } from "@/services/issues-store";
import { STORE_DATA_SOURCE, storeNow } from "@/components/store/api/config";
import { getStoreOrders, getStoreSession } from "@/components/store/api/store-data";
import { getDashboardData } from "@/components/store/dashboard/dashboard-data";
import { UpcomingDeliveries } from "@/components/store/dashboard/upcoming-deliveries";
import { RecentRequests } from "@/components/store/dashboard/recent-requests";
import { NeedsAttention } from "@/components/store/dashboard/needs-attention";

// Figma: Desktop / 01 Dashboard and Mobile / 01 Dashboard.
export default async function StoreDashboardPage() {
  const now = storeNow();
  // Open delivery issues for "Needs attention" (live: the outlet's issues from the API).
  const issues: DashboardIssue[] =
    STORE_DATA_SOURCE === "api"
      ? (await fetchStoreIssues().catch(() => [])).map((issue) => ({
          code: issue.id,
          orderNumber: issue.orderId,
          summary: issue.title,
          isOpen: issue.status === "open" || issue.status === "under_review",
        }))
      : mockIssues;
  const [orders, session] = await Promise.all([getStoreOrders(), getStoreSession().catch(() => null)]);
  const outlet = session?.outlet ?? null;
  const data = getDashboardData(orders, issues);
  const next = data.nextDelivery;
  const nextEta = next?.eta ? formatTime(next.eta) : null;
  const issueCount = data.openIssues.length;

  return (
    // DOM order follows the mobile layout. From xl (tables) Needs Attention moves to the end; from 1400px
    // it sits beside Recent Goods Requests as in the 1440 Figma frame (narrower screens can't fit both tables' columns).
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:gap-6 min-[1400px]:grid-cols-[minmax(0,1fr)_350px] min-[1400px]:gap-x-[30px]">
      <div className="flex flex-col gap-4 min-[1400px]:col-span-2 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">
            <span className="md:hidden">
              {greeting(now)}
              {session ? `, ${session.manager.firstName}` : ""}
            </span>
            <span className="hidden md:inline">Dashboard</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="md:hidden">Here&apos;s what needs your attention today.</span>
            <span className="hidden md:inline">
              Overview of your requests, upcoming deliveries, and items that need your attention.
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 pt-2 md:flex-row md:gap-4 md:pt-0">
          <Button
            asChild
            variant="outline"
            className="hidden h-10 border-2 border-primary px-4 text-base font-bold md:inline-flex"
          >
            <Link href="/store/deliveries">View All Deliveries</Link>
          </Button>
          <Button asChild className="h-11 px-4 text-base font-bold md:h-10">
            <Link href="/store/requests/new">
              <Plus aria-hidden="true" />
              New Goods Request
            </Link>
          </Button>
        </div>
      </div>

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 xl:grid-cols-4 xl:gap-[30px] min-[1400px]:col-span-2">
        <StoreMetricCard
          label="Active Requests"
          value={data.active.length}
          caption="Being processed by the depot"
          mobileCaption="In progress"
        />
        <StoreMetricCard
          label="Upcoming Deliveries"
          value={data.inTransit.length}
          caption={next && nextEta ? `Next: ${next.orderNumber} · ETA ${nextEta}` : "None scheduled"}
          mobileCaption={nextEta ? `ETA ${nextEta}` : "None scheduled"}
        />
        <StoreMetricCard
          label="Awaiting Confirmation"
          value={data.awaitingConfirmation.length}
          caption="Delivery has arrived"
          mobileCaption="Has arrived"
        />
        <StoreMetricCard
          label="Needs Attention"
          value={issueCount}
          caption={`${issueCount} delivery ${issueCount === 1 ? "issue" : "issues"} reported`}
          mobileCaption={`${issueCount} ${issueCount === 1 ? "issue" : "issues"}`}
        />
      </section>

      <NeedsAttention
        items={data.attentionItems}
        className="xl:order-last min-[1400px]:order-none min-[1400px]:col-start-2 min-[1400px]:row-start-4"
      />

      <div className="min-[1400px]:col-span-2 min-[1400px]:row-start-3">
        <UpcomingDeliveries orders={data.upcomingDeliveries} outlet={outlet} now={now} />
      </div>

      <RecentRequests
        orders={data.recentRequests}
        outlet={outlet}
        className="min-[1400px]:col-start-1 min-[1400px]:row-start-4" />
    </div>
  );
}
