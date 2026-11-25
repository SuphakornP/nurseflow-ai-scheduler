import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoResponse } from "@/components/demo-data";
import { cacheSchedule, getCachedCandidate } from "@/lib/schedule-cache";

describe("generated candidate cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps same-period generations distinct and private to the login", () => {
    const first = createDemoResponse();
    const second = { ...first, versions: [{ ...first.versions[0], id: "second-run" }] };
    const periodId = first.dataset.period.id;
    const firstId = first.versions[0].id;
    cacheSchedule("login-1", first);
    cacheSchedule("login-1", second);

    expect(getCachedCandidate("login-1", periodId, firstId)?.version).toBe(first.versions[0]);
    expect(getCachedCandidate("login-1", periodId, "second-run")?.version).toBe(second.versions[0]);
    expect(getCachedCandidate("login-2", periodId, firstId)).toBeNull();
    expect(getCachedCandidate("login-1", "wrong-period", firstId)).toBeNull();
  });

  it("expires candidates after 30 minutes and evicts the oldest above capacity", () => {
    vi.useFakeTimers();
    const schedule = createDemoResponse();
    const periodId = schedule.dataset.period.id;
    for (let i = 0; i < 13; i++) {
      cacheSchedule("login-3", {
        ...schedule,
        versions: [{ ...schedule.versions[0], id: String(i) }],
      });
    }

    expect(getCachedCandidate("login-3", periodId, "0")).toBeNull();
    expect(getCachedCandidate("login-3", periodId, "1")).not.toBeNull();
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(getCachedCandidate("login-3", periodId, "12")).toBeNull();
  });
});
