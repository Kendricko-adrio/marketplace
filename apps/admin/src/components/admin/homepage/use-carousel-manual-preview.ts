"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  describePreviewState,
  mergePreviewCache,
  type CarouselPreviewCache,
  type CarouselPreviewSourceRow,
  type PreviewFailureReason,
  type PreviewState,
} from "@/lib/carousel-manual-preview";

/**
 * Resolves the cards for the manual carousel preview. Cards come from the
 * rows the product picker already loaded (seeded by the form) and, for picks
 * the picker never loaded in this session — e.g. the products of a saved
 * section — from the existing product-detail endpoint, one id at a time with
 * bounded concurrency.
 *
 * The returned cards follow `ids`, so paging/searching the picker never
 * changes what the preview shows, and a late response for a removed pick is
 * not rendered.
 */

const MAX_CONCURRENT_LOOKUPS = 4;

export interface UseCarouselManualPreviewInput {
  /** False for filter-mode carousels and other section types. */
  enabled: boolean;
  /** Selected product ids in display order. */
  ids: string[];
  /** Rows the picker has loaded; they become cards without a lookup. */
  seedRows: CarouselPreviewSourceRow[];
}

export interface CarouselManualPreview extends PreviewState {
  /** Clears temporary failures and looks them up again. */
  retry: () => void;
}

export function useCarouselManualPreview({
  enabled,
  ids,
  seedRows,
}: UseCarouselManualPreviewInput): CarouselManualPreview {
  const cacheRef = useRef<CarouselPreviewCache>({});
  const failuresRef = useRef<Record<string, PreviewFailureReason>>({});
  const [cache, setCache] = useState<CarouselPreviewCache>({});
  const [failures, setFailures] = useState<
    Record<string, PreviewFailureReason>
  >({});
  const [attempt, setAttempt] = useState(0);

  const commitCache = useCallback((next: CarouselPreviewCache) => {
    if (next === cacheRef.current) return;
    cacheRef.current = next;
    setCache(next);
  }, []);

  const recordFailure = useCallback((id: string, reason: PreviewFailureReason) => {
    if (failuresRef.current[id] === reason) return;
    const next = { ...failuresRef.current, [id]: reason };
    failuresRef.current = next;
    setFailures(next);
  }, []);

  const clearFailure = useCallback((id: string) => {
    if (!failuresRef.current[id]) return;
    const next = { ...failuresRef.current };
    delete next[id];
    failuresRef.current = next;
    setFailures(next);
  }, []);

  // Picker rows are cards we already have: cache them so the selection survives
  // paging and searching.
  useEffect(() => {
    if (!enabled || seedRows.length === 0) return;
    commitCache(mergePreviewCache(cacheRef.current, seedRows));
  }, [enabled, seedRows, commitCache]);

  const idsKey = ids.join(",");

  useEffect(() => {
    if (!enabled) return;

    // Ids are read from the stable key so the Effect re-runs when the
    // selection or its order changes, not on every render of a new array.
    const selectedIds = idsKey.length > 0 ? idsKey.split(",") : [];
    const missing = selectedIds.filter(
      (id) => !cacheRef.current[id] && !failuresRef.current[id]
    );
    if (missing.length === 0) return;

    // React docs' recommended guard: a cleaned-up Effect ignores its results,
    // so an outdated lookup cannot repopulate a pick the admin removed.
    let ignore = false;
    const controllers: AbortController[] = [];
    const queue = [...missing];

    const lookup = async () => {
      while (queue.length > 0 && !ignore) {
        const id = queue.shift();
        if (!id) return;

        const controller = new AbortController();
        controllers.push(controller);

        try {
          const response = await fetch(`/api/admin/products/${id}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (ignore) return;

          if (response.ok) {
            const body = (await response.json()) as {
              success?: boolean;
              data?: CarouselPreviewSourceRow | null;
            };
            if (ignore) return;
            const row = body?.data;
            if (body?.success && row && row.id === id) {
              commitCache(mergePreviewCache(cacheRef.current, [row]));
              clearFailure(id);
              continue;
            }
            recordFailure(id, "failed");
            continue;
          }

          // Out of scope or gone: the product is not the admin's to preview.
          recordFailure(
            id,
            response.status === 403 || response.status === 404
              ? "unavailable"
              : "failed"
          );
        } catch {
          // Aborted lookups are the cleanup path, not a failure to report.
          if (ignore) return;
          recordFailure(id, "failed");
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_LOOKUPS, queue.length) },
      lookup
    );
    void Promise.all(workers);

    return () => {
      ignore = true;
      for (const controller of controllers) controller.abort();
    };
  }, [enabled, idsKey, attempt, commitCache, recordFailure, clearFailure]);

  const retry = useCallback(() => {
    const next = { ...failuresRef.current };
    let changed = false;
    for (const [id, reason] of Object.entries(next)) {
      if (reason === "failed") {
        delete next[id];
        changed = true;
      }
    }
    if (changed) {
      failuresRef.current = next;
      setFailures(next);
    }
    setAttempt((value) => value + 1);
  }, []);

  // An unresolved pick is either being looked up right now or is queued for
  // it; deriving this from the cache and the failures keeps the "loading" state
  // honest without mirroring it in another state variable.
  const unresolved = enabled
    ? ids.filter((id) => !cache[id] && !failures[id])
    : [];

  const state = enabled
    ? describePreviewState({
        ids,
        cache,
        pending: unresolved,
        failures: Object.entries(failures).map(([id, reason]) => ({
          id,
          reason,
        })),
      })
    : {
        status: "empty" as const,
        products: [],
        message: null,
        canRetry: false,
      };

  return { ...state, retry };
}
