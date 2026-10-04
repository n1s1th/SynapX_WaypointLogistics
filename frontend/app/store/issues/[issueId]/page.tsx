"use client";

import { useEffect, use } from "react";
import { useRouter } from "next/navigation";

export default function SingleIssueRedirectPage({
  params,
}: {
  params: Promise<{ issueId: string }>;
}) {
  const resolvedParams = use(params);
  const issueId = resolvedParams.issueId;
  const router = useRouter();

  useEffect(() => {
    if (issueId) {
      router.replace(`/store/issues?search=${encodeURIComponent(issueId)}`);
    } else {
      router.replace("/store/issues");
    }
  }, [issueId, router]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6 text-xs text-muted-foreground">
      Opening issue details for {issueId}...
    </div>
  );
}
