"use client";

import { useEffect } from "react";

/** Registers the app-shell service worker in production only (no data caching — D-25). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability is a convenience; the app works without a service worker.
    });
  }, []);
  return null;
}
