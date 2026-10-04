"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, Hourglass, WifiOff } from "lucide-react";
import { cn } from "cn";
import { DecisionOption } from "@/components/loader/decision-option";
import { InfoChip } from "@/components/loader/info-chip";
import { LoaderButton } from "@/components/loader/loader-button";
import { LoaderCard } from "@/components/loader/loader-card";
import { LoaderPill, type LoaderPillTone } from "@/components/loader/loader-pill";
import { LoaderScreen } from "@/components/loader/loader-screen";
import { useStoredSession } from "@/components/loader/loader-session";
import { useLoaderShell } from "@/components/loader/loader-shell";
import { TrackerStep } from "@/components/loader/tracker-step";
import { formatTime, ISSUE_TYPE_LABELS, isIssueWaiting } from "@/lib/loader/format";
import type { IssueStatus, LoaderIssue } from "@/lib/loader/types";
import { useIssue } from "./use-issue";

const linkClass =
  "rounded-sm text-xs leading-[17px] font-medium text-muted-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

const STATUS_PILL: Record<IssueStatus, { tone: LoaderPillTone; label: string }> = {
  sent: { tone: "error", label: "Waiting on Dispatcher" },
  seen: { tone: "error", label: "Seen · waiting" },
  decided: { tone: "info", label: "Decision" },
  default_applied: { tone: "warning", label: "Default applied" },
};

const HEADING: Record<IssueStatus, string> = {
  sent: "Waiting for Dispatcher",
  seen: "Waiting for Dispatcher",
  decided: "Dispatcher decided",
  default_applied: "No decision · default applied",
};

const time = (iso: string | null | undefined) => (iso ? formatTime(iso) : "—");

/**
 * "ORD0092314 · OUT003 · Missing · 8 of 8 units" while waiting. Once answered,
 * units_affected is the final number not sent, so the line says what goes:
 * "… · Missing · 0 of 8 units go".
 */
function issueLine(issue: LoaderIssue): string {
  const total = issue.units_total;
  const units = !total
    ? `${issue.units_affected} units`
    : isIssueWaiting(issue)
      ? `${issue.units_affected} of ${total} units`
      : `${Math.max(total - issue.units_affected, 0)} of ${total} units go`;
  return [issue.order_number, issue.outlet_code, ISSUE_TYPE_LABELS[issue.issue_type], units].filter(Boolean).join(" · ");
}

/**
 * L8 · one flag, waiting on the Dispatcher or answered (Figma 3a–3c, T3a–T3c).
 * Read-only for the loader: the Dispatcher decides, the tablet shows it.
 */
export function IssueView({ id }: { id: number }) {
  const router = useRouter();
  const { user, dockLabel } = useLoaderShell();
  const dock = useStoredSession()?.session.dock;
  const state = useIssue(id, dock);
  const issue = state.status === "ready" ? state.issue : undefined;
  const offlineSince = state.status === "ready" && state.source === "cache" ? state.fetchedAt : undefined;

  const subtitle = [issue?.run_code, dockLabel, user.shortName].filter(Boolean).join(" · ");
  const checklistHref = issue ? `/loader/runs/${encodeURIComponent(issue.run_code)}` : "/loader";

  return (
    <LoaderScreen
      title="Issue decision"
      subtitle={subtitle}
      stripText={issue ? stripText(issue) : undefined}
      footer={issue && <IssueFooter issue={issue} onContinue={() => router.push(checklistHref)} />}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {issue ? (
          <>
            <header className="flex flex-col gap-1.5">
              <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
                <Link href="/loader/issues" className={linkClass}>
                  Issues
                </Link>
                <span aria-hidden>/</span>
                <span className="font-medium">{issue.order_number}</span>
              </nav>
              <h1 className="text-xl leading-[26px] font-semibold text-primary">{HEADING[issue.status]}</h1>
              <div className="flex flex-wrap items-center gap-1.5">
                <LoaderPill tone={STATUS_PILL[issue.status].tone}>{STATUS_PILL[issue.status].label}</LoaderPill>
                {offlineSince && (
                  <InfoChip tone="warning" icon={<WifiOff />}>
                    Offline · as of {formatTime(offlineSince)}
                  </InfoChip>
                )}
              </div>
              <p className="text-xs leading-[17px] text-muted-foreground">
                {issue.run_code} · flagged {time(issue.reported_at)} by {issue.reported_by}
              </p>
            </header>

            <div className="grid items-start gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <StatusCard issue={issue} />
                {(issue.quick_note_tag || issue.note) && (
                  <LoaderCard title="Your flag" description={`${issue.reported_by} · ${time(issue.reported_at)}`}>
                    {issue.quick_note_tag && <p className="text-sm font-semibold text-foreground">{issue.quick_note_tag}</p>}
                    {issue.note && <p className="text-sm text-foreground">{issue.note}</p>}
                  </LoaderCard>
                )}
              </div>
              <div className="flex flex-col gap-4">
                {!isIssueWaiting(issue) && <OutcomeCard issue={issue} />}
                <LoaderCard
                  title={isIssueWaiting(issue) ? "Options the Dispatcher has" : "Options the Dispatcher had"}
                  description={isIssueWaiting(issue) ? "The default applies if there’s no answer" : "So you can see the trade-off"}
                >
                  {issue.options.length > 0 ? (
                    <ul className="flex flex-col gap-3">
                      {issue.options.map((option) => (
                        <DecisionOption
                          key={option.label}
                          title={option.is_default ? `${option.label} · default` : option.label}
                          description={option.detail ?? ""}
                          chosen={option.is_chosen}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No options were sent with this flag.</p>
                  )}
                </LoaderCard>
              </div>
            </div>
          </>
        ) : state.status === "loading" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading issue {id}…
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card p-6 text-center">
            <p className="text-base font-semibold text-primary">
              {state.status === "not_found" ? "This issue no longer exists." : "This issue is not available offline."}
            </p>
            <p className="text-sm text-muted-foreground">
              {state.status === "not_found"
                ? "It may have been removed. Pick it from the Issues tab."
                : "This tablet has not opened it before. Reconnect to load it."}
            </p>
            <Link href="/loader/issues" className="text-sm font-medium text-info underline-offset-4 hover:underline">
              Back to Issues
            </Link>
          </div>
        )}
      </div>
    </LoaderScreen>
  );
}

function stripText(issue: LoaderIssue): string {
  switch (issue.status) {
    case "sent":
    case "seen":
      return `Sent to Dispatcher · Exceptions · ${time(issue.reported_at)}`;
    case "decided":
      return `Dispatcher decided · ${time(issue.decided_at)}`;
    case "default_applied":
      return `Decide-by ${time(issue.decide_by)} passed · default applied`;
  }
}

/** The pinned card of 3a / 3c: what was flagged, the tracker and what happens next. */
function StatusCard({ issue }: { issue: LoaderIssue }) {
  const waiting = isIssueWaiting(issue);
  const chosen = issue.options.find((o) => o.is_chosen)?.label;
  const fallback = issue.options.find((o) => o.is_default)?.label;
  const tone =
    issue.status === "default_applied"
      ? "border-warning bg-warning-muted"
      : issue.status === "decided"
        ? "border-success bg-success-muted"
        : "border-destructive/30 bg-destructive-muted";

  return (
    <section aria-label="Flag status" className={cn("flex flex-col gap-3 rounded-xl border p-4", tone)}>
      <div className="flex items-center gap-2">
        {issue.status === "decided" ? (
          <CircleCheck className="size-5 text-success" aria-hidden />
        ) : (
          <Hourglass className="size-5 text-foreground" aria-hidden />
        )}
        <h2 className="flex-1 text-base leading-[22px] font-semibold text-foreground">{HEADING[issue.status]}</h2>
      </div>
      <p className="text-xs leading-[17px] font-medium text-destructive-muted-foreground">{issueLine(issue)}</p>
      <ol aria-label="Flag tracker" className="grid grid-cols-3 gap-1 rounded-lg bg-card p-3">
        <TrackerStep state="done" label="Sent" time={time(issue.reported_at)} />
        <TrackerStep state={issue.seen_at ? "done" : "pending"} label="Seen" time={issue.seen_at ? time(issue.seen_at) : undefined} />
        {issue.status === "default_applied" ? (
          <TrackerStep state="done" label="Default" time={time(issue.decided_at ?? issue.decide_by)} />
        ) : issue.status === "decided" ? (
          <TrackerStep state="done" label="Decision" time={time(issue.decided_at)} />
        ) : (
          <TrackerStep state="pending" label="Decision" time={issue.decide_by ? `by ${time(issue.decide_by)}` : undefined} />
        )}
      </ol>
      {waiting ? (
        <>
          <p className="text-sm text-foreground">Keep loading the rest. The answer will appear here.</p>
          <p className="text-xs leading-[17px] text-muted-foreground">
            Decide-by {time(issue.decide_by)}.
            {fallback ? ` If there’s no answer, the agreed default applies: ${fallback.toLowerCase()}.` : ""}
          </p>
        </>
      ) : issue.status === "decided" ? (
        <p className="text-sm text-foreground">
          {issue.decided_by ?? "The Dispatcher"} chose <span className="font-semibold">{chosen ?? "an option"}</span> at{" "}
          {time(issue.decided_at)}.
        </p>
      ) : (
        <p className="text-sm text-foreground">
          No answer by {time(issue.decide_by)}, so the agreed default applied:{" "}
          <span className="font-semibold">{(chosen ?? fallback ?? "the default").toLowerCase()}</span>.
        </p>
      )}
    </section>
  );
}

/** 3b's "What you do": the chosen option, spelled out for the loader. */
function OutcomeCard({ issue }: { issue: LoaderIssue }) {
  const chosen = issue.options.find((o) => o.is_chosen);
  if (!chosen) return null;
  return (
    <section aria-label="What you do" className="flex flex-col gap-2.5 rounded-xl border border-success bg-success-muted p-4">
      <p className="text-sm font-semibold text-success-muted-foreground">What you do</p>
      <p className="text-base leading-[22px] font-semibold text-foreground">{chosen.label}</p>
      {chosen.detail && <p className="text-xs leading-[17px] text-foreground">{chosen.detail}</p>}
    </section>
  );
}

function IssueFooter({ issue, onContinue }: { issue: LoaderIssue; onContinue: () => void }) {
  const waiting = isIssueWaiting(issue);
  const text = waiting
    ? `Keep loading the rest. Release unlocks when the Dispatcher decides, or at ${time(issue.decide_by)} when the default applies.`
    : issue.status === "decided"
      ? "The flag is resolved. Release unlocks once the rest of the run is loaded."
      : "Default logged against the flag. Release unlocks once the rest of the run is loaded.";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 md:flex-row md:items-center md:gap-4">
      <p className="flex-1 text-[13px] text-muted-foreground">{text}</p>
      <LoaderButton variant={waiting ? "secondary" : "primary"} className="md:w-[300px]" onClick={onContinue}>
        {waiting ? `Back to ${issue.run_code}` : "Got it · continue loading"}
      </LoaderButton>
    </div>
  );
}
