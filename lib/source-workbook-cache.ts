import "server-only";

import type { SourceWorkbookTemplate } from "@/lib/source-workbook-template";
import { TemporaryCache } from "@/lib/temporary-cache";

const runtime = globalThis as typeof globalThis & {
  nurseFlowTemplates?: TemporaryCache<SourceWorkbookTemplate>;
};
const templates = runtime.nurseFlowTemplates ??= new TemporaryCache<SourceWorkbookTemplate>(
  4,
  8 * 60 * 60 * 1000,
);

export function cacheSourceWorkbookTemplate(
  sessionId: string,
  periodId: string,
  template: SourceWorkbookTemplate,
) {
  templates.set(JSON.stringify([sessionId, periodId, template.sourceHash]), template);
}

export function getSourceWorkbookTemplate(sessionId: string, periodId: string, sourceHash: string) {
  return templates.get(JSON.stringify([sessionId, periodId, sourceHash]));
}
