import { describe, expect, it } from "vitest";

import { readBodyWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

function body(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("bounded request body reader", () => {
  it("combines a body that stays inside the byte limit", async () => {
    const bytes = await readBodyWithLimit(body("nurse", "flow"), 9);
    expect(new TextDecoder().decode(bytes)).toBe("nurseflow");
  });

  it("rejects chunked bodies once the byte limit is exceeded", async () => {
    await expect(readBodyWithLimit(body("1234", "56"), 5)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});
