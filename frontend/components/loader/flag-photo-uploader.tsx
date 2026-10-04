"use client";

import * as React from "react";
import { PHOTO_QUEUE_EVENT, uploadQueuedPhotos } from "@/lib/loader/offline/photo-queue";
import { useLoaderSync } from "./loader-sync-provider";

const RETRY_MS = 30_000;

/**
 * Sends queued flag photos (lib/loader/offline/photo-queue): after each sync,
 * when the tablet comes back online, when a photo is queued, and every 30 s.
 * Renders nothing.
 */
export function FlagPhotoUploader() {
  const { transport, sync } = useLoaderSync();

  React.useEffect(() => {
    if (!sync.online) return;
    const timer = window.setTimeout(() => void uploadQueuedPhotos(transport).catch(() => {}), 0);
    return () => window.clearTimeout(timer);
  }, [transport, sync.online, sync.lastSyncedAt]);

  React.useEffect(() => {
    const upload = () => void uploadQueuedPhotos(transport).catch(() => {});
    window.addEventListener(PHOTO_QUEUE_EVENT, upload);
    window.addEventListener("online", upload);
    const timer = window.setInterval(upload, RETRY_MS);
    return () => {
      window.removeEventListener(PHOTO_QUEUE_EVENT, upload);
      window.removeEventListener("online", upload);
      window.clearInterval(timer);
    };
  }, [transport]);

  return null;
}
