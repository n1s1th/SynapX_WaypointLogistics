"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function NewIssueRedirectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const order = searchParams.get("order") || "";
    const target = order
      ? `/store/issues?order=${encodeURIComponent(order)}&report=true`
      : `/store/issues?report=true`;
    router.replace(target);
  }, [router, searchParams]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6 text-xs text-muted-foreground">
      Opening issue reporting form...
    </div>
  );
}

export default function NewIssuePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">Loading...</div>}>
      <NewIssueRedirectContent />
    </Suspense>
  );
}
