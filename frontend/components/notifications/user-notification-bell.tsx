"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type InboxItem = {
  id: number;
  category: string;
  title: string;
  message: string;
  target_url: string | null;
  created_at: string;
  read_at: string | null;
};
type Inbox = { items: InboxItem[]; unread_count: number };

/** Shared inbox for authenticated User roles. The loader tablet uses a separate identity system. */
export function UserNotificationBell() {
  const [inbox, setInbox] = useState<Inbox>({ items: [], unread_count: 0 });
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInbox(await apiFetch<Inbox>("/notifications/inbox?limit=30"));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  async function markRead(id: number) {
    try {
      await apiFetch(`/notifications/inbox/${id}/read`, { method: "PATCH" });
      await refresh();
    } catch { setError(true); }
  }

  async function markAllRead() {
    try {
      await apiFetch("/notifications/inbox/read-all", { method: "POST" });
      await refresh();
    } catch { setError(true); }
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) void refresh(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-11" aria-label={`Notifications${inbox.unread_count ? `, ${inbox.unread_count} unread` : ""}`}>
          <Bell className="size-5" aria-hidden="true" />
          {inbox.unread_count > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="font-semibold">Notifications</h2>
            <p className="text-xs text-muted-foreground">{inbox.unread_count} unread</p>
          </div>
          <Button variant="ghost" size="sm" disabled={inbox.unread_count === 0} onClick={() => void markAllRead()}>
            <CheckCheck className="size-4" aria-hidden="true" /> Mark all read
          </Button>
        </div>
        {error && <div role="alert" className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load notifications. <Button variant="outline" size="sm" onClick={() => void refresh()}>Retry</Button>
        </div>}
        <div className="max-h-96 overflow-y-auto">
          {!error && inbox.items.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>}
          {inbox.items.map((item) => (
            <div key={item.id} className={`border-b border-border px-4 py-3 last:border-0 ${item.read_at ? "" : "bg-info-muted/60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs capitalize text-muted-foreground">{item.category} · {new Date(item.created_at).toLocaleString()}</p>
                  <p className="mt-1 text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                </div>
                {!item.read_at && <span className="mt-1 size-2 shrink-0 rounded-full bg-info" aria-label="Unread" />}
              </div>
              <div className="mt-2 flex gap-3">
                {item.target_url?.startsWith("/") && !item.target_url.startsWith("//") && (
                  <Link href={item.target_url} onClick={() => { setOpen(false); if (!item.read_at) void markRead(item.id); }} className="text-sm font-medium text-primary underline-offset-2 hover:underline">View</Link>
                )}
                {!item.read_at && <button type="button" onClick={() => void markRead(item.id)} className="text-sm text-muted-foreground hover:text-foreground">Mark read</button>}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
