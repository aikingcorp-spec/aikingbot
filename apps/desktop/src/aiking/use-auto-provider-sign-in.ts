// Copyright (c) 2026 AIKING.
import { useEffect, useRef } from "react";

/** One install continues into one official sign-in, including React's development effect replay. */
export function useAutoProviderSignIn(instanceId: string, enabled: boolean, start: () => Promise<void>): void {
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || started.current === instanceId) return;
    started.current = instanceId;
    void start();
  }, [instanceId, enabled, start]);
}
