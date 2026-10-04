"use client";

import { useState } from "react";
import Link from "next/link";
import { differenceInMinutes, format, isSameDay, parseISO, subDays } from "date-fns";
import { BellOff } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StoreArrowLink } from "@/components/store/store-cards";
import { StorePill, type StorePillTone } from "@/components/store/status-pill";
import type { NotificationCategory, NotificationType, StoreNotification, StoreOutlet } from "@/components/store/mock-data";
import {
  markAllRead,
  markNotificationsRead,
  useNotificationsState,
} from "@/components/store/notifications/notification-store";

type NotificationTab = "all" | NotificationCategory;

const tabs: { value: NotificationTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "request", label: "Requests" },
  { value: "delivery", label: "Deliveries" },
  { value: "issue", label: "Issues" },
];

// Tag colour per type (Figma 10). The tag text names the category, so colour is never the only signal.
const typeTag: Record<NotificationType, { label: string; tone: StorePillTone }> = {
  issue_logged: { label: "Issue", tone: "destructive" },
  eta_updated: { label: "Delivery", tone: "info" },
  delivered: { label: "Delivery", tone: "success" },
  dispatcher_note: { label: "Request", tone: "warning" },
  shortfall_warning: { label: "Request", tone: "warning" },
  deferred: { label: "Deferred", tone: "warning" },
  ready_for_dispatch: { label: "Request", tone: "brand" },
  order_submitted: { label: "Request", tone: "neutral" },
  order_confirmed: { label: "Request", tone: "neutral" },
  order_closed: { label: "Request", tone: "neutral" },
};

function timeLabel(iso: string, now: Date) {
  const date = parseISO(iso);
  const minutes = differenceInMinutes(now, date);
  const day = isSameDay(date, now)
    ? "Today"
    : isSameDay(date, subDays(now, 1))
      ? "Yesterday"
      : format(date, "d MMM");
  const base = `${day}, ${format(date, "HH:mm")}`;
  if (minutes >= 0 && minutes < 5) return `${base} · Just now`;
  if (minutes >= 5 && minutes < 60) return `${base} · ${minutes} min ago`;
  return base;
}

export function NotificationsView({ outlet, now }: { outlet: StoreOutlet | null; now: Date }) {
  const { items: notifications, status, reload } = useNotificationsState();
  const [tab, setTab] = useState<NotificationTab>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const unread = notifications.filter((n) => !n.isRead);
  const counts = Object.fromEntries(
    tabs.map((t) => [t.value, notifications.filter((n) => t.value === "all" || n.category === t.value).length])
  );
  const visible = notifications.filter(
    (n) => (tab === "all" || n.category === tab) && (!unreadOnly || !n.isRead)
  );

  const markAll = () => markAllRead(unread.map((n) => n.id));

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold text-primary md:text-3xl md:font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            <span className="md:hidden">{unread.length === 0 ? "All caught up" : `${unread.length} unread`}</span>
            <span className="hidden md:inline">
              Order updates, delivery alerts and receiving activity for {outlet?.code ?? "your outlet"}.
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Button
            asChild
            variant="outline"
            className="hidden h-10 border-2 border-primary px-4 text-base font-bold md:inline-flex"
          >
            {/* Notification preferences live in Outlet Settings (Figma 09). */}
            <Link href="/store/settings#notifications">Preferences</Link>
          </Button>
          <Button
            onClick={markAll}
            disabled={unread.length === 0}
            className="hidden h-10 px-4 text-base font-bold md:inline-flex"
          >
            Mark All as Read
          </Button>
          <button
            type="button"
            onClick={markAll}
            disabled={unread.length === 0}
            className="min-h-11 text-sm font-medium text-primary disabled:text-muted-foreground md:hidden"
          >
            Mark all as read
          </button>
        </div>
      </div>

      {/* Mobile: chips on the page background. md+: a card with underlined tabs (Figma 10). */}
      <Card className="gap-0 overflow-visible rounded-lg bg-transparent p-0 ring-0 md:overflow-hidden md:bg-card md:ring-1 md:ring-border">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:border-b md:border-border md:px-6 md:pt-2">
          <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationTab)} className="min-w-0 gap-0">
            <TabsList
              aria-label="Notification type"
              className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-none bg-transparent p-0 pb-1 group-data-horizontal/tabs:h-auto md:w-fit md:max-w-full md:gap-0 md:pb-0"
            >
              {tabs.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="h-auto min-h-11 flex-none rounded-md border-input bg-card px-4 py-2 text-sm text-muted-foreground group-data-[variant=default]/tabs-list:data-active:shadow-none data-active:border-primary data-active:bg-primary data-active:font-bold data-active:text-primary-foreground md:mb-[-1px] md:min-h-0 md:min-w-[100px] md:rounded-none md:border-0 md:border-b-4 md:border-border md:bg-transparent md:text-base md:font-normal md:data-active:border-primary md:data-active:bg-transparent md:data-active:font-bold md:data-active:text-foreground"
                >
                  {t.label} ({counts[t.value]})
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 md:pb-3">
            <Label htmlFor="unread-only" className="text-sm font-medium text-foreground/80">
              Unread only
            </Label>
            <Switch id="unread-only" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
          </div>
        </div>

        <p className="sr-only" aria-live="polite">
          {visible.length} {visible.length === 1 ? "notification" : "notifications"} shown, {unread.length} unread
        </p>

        {status === "error" ? (
          <div role="alert" className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/40 px-4 py-10 text-center md:mt-0 md:rounded-none md:border-0">
            <p className="text-base font-semibold text-foreground">Couldn&apos;t load notifications</p>
            <p className="text-sm text-muted-foreground">Check your connection, then try again.</p>
            <Button variant="outline" onClick={reload} className="h-11 md:h-9">
              Try again
            </Button>
          </div>
        ) : status === "loading" ? (
          <p className="mt-4 px-4 py-10 text-center text-sm text-muted-foreground md:mt-0" role="status">
            Loading notifications…
          </p>
        ) : visible.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center md:mt-0 md:rounded-none md:border-0">
            <BellOff className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-base font-semibold text-foreground">
              {unreadOnly ? "You're all caught up" : "No notifications here"}
            </p>
            <p className="text-sm text-muted-foreground">
              {unreadOnly ? "There are no unread notifications in this view." : "New updates will appear here."}
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col overflow-hidden rounded-lg ring-1 ring-border md:mt-0 md:rounded-none md:ring-0">
            {visible.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} now={now} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NotificationRow({ notification, now }: { notification: StoreNotification; now: Date }) {
  const tag = typeTag[notification.type];
  const markRead = () => !notification.isRead && markNotificationsRead([notification.id]);

  return (
    <li
      className={cn(
        "flex gap-4 border-b border-border px-4 py-4 last:border-b-0 md:px-6",
        notification.isRead ? "bg-card" : "bg-info-muted/60",
        notification.type === "deferred" && "border-l-4 border-l-warning"
      )}
    >
      <span className="flex w-2 shrink-0 justify-center pt-2" aria-hidden="true">
        <span className={cn("size-2 rounded-full", notification.isRead ? "bg-border" : "bg-info")} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StorePill tone={tag.tone}>{tag.label}</StorePill>
          <time dateTime={notification.createdAt} className="text-sm text-muted-foreground">
            {timeLabel(notification.createdAt, now)}
          </time>
          {!notification.isRead && <span className="sr-only">Unread</span>}
        </div>
        <p className={cn("text-sm text-foreground", notification.isRead ? "font-medium" : "font-bold")}>
          {notification.title}
        </p>
        <p className="text-sm text-foreground/80">{notification.message}</p>
        {(notification.links.length > 0 || !notification.isRead) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {notification.links.map((link) => (
              <StoreArrowLink key={link.href} href={link.href} onClick={markRead}>
                {link.label}
              </StoreArrowLink>
            ))}
            {!notification.isRead && (
              <button
                type="button"
                onClick={markRead}
                className="min-h-11 text-sm font-medium text-muted-foreground hover:text-foreground md:hidden"
              >
                Mark as read
              </button>
            )}
          </div>
        )}
      </div>
      {!notification.isRead && (
        <button
          type="button"
          onClick={markRead}
          className="hidden shrink-0 self-start text-sm font-medium text-muted-foreground hover:text-foreground md:block"
        >
          Mark as read<span className="sr-only">: {notification.title}</span>
        </button>
      )}
    </li>
  );
}
