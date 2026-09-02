"use client";

import { useEffect, useSyncExternalStore } from "react";
import { registerWebMCP } from "@/lib/webmcp/register";

let available = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: boolean) {
  if (available === next) return;
  available = next;
  listeners.forEach((listener) => listener());
}

export function useWebMCP(): boolean {
  const isAvailable = useSyncExternalStore(subscribe, () => available, () => false);
  useEffect(() => {
    const registration = registerWebMCP();
    publish(registration.available);
    return () => {
      registration.dispose();
      publish(false);
    };
  }, []);
  return isAvailable;
}
