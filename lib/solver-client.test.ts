import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  callSolver,
  SolverRejectedError,
  SolverUnavailableError,
} from "@/lib/solver-client";

const TOKEN = "solver-client-test-token-with-32-characters";
const PRIVATE_DETAIL = "EMP-SECRET-77 NursePrivate raw-token-Z";

describe("solver client error classification", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.SOLVER_API_TOKEN = TOKEN;
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("classifies a structured input rejection without retaining private detail", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            issue_count: 2,
            reason_codes: ["UNRESOLVED_REQUEST", "VACATION_MODE"],
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(callSolver("/generate", { method: "POST", body: "{}" })).rejects.toMatchObject({
      name: "SolverRejectedError",
      path: "/generate",
      status: 422,
      diagnostic: {
        kind: "input_problem",
        issueCount: 2,
        reasonCodes: ["UNRESOLVED_REQUEST", "VACATION_MODE"],
      },
    });
  });

  it("sanitizes legacy and Pydantic rejection bodies", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: {
              errors: [
                `${PRIVATE_DETAIL}: 'unexpected' needs review`,
                `${PRIVATE_DETAIL}: Vacation must use LOCKED mode`,
              ],
            },
          }),
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: [
              {
                type: "value_error",
                loc: ["body", "requests", 4, "raw_value"],
                msg: PRIVATE_DETAIL,
                input: { nickname: PRIVATE_DETAIL },
              },
            ],
          }),
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: {
              issue_count: 3,
              reason_codes: ["PAYLOAD_VALIDATION"],
              field_paths: ["requests[]", PRIVATE_DETAIL],
              issue_types: ["enum", PRIVATE_DETAIL],
            },
          }),
          { status: 422 },
        ),
      );

    const legacy = await callSolver("/generate").catch((error: unknown) => error);
    const schema = await callSolver("/generate").catch((error: unknown) => error);
    const structuredSchema = await callSolver("/generate").catch(
      (error: unknown) => error,
    );

    expect(legacy).toBeInstanceOf(SolverRejectedError);
    expect(schema).toBeInstanceOf(SolverRejectedError);
    expect(structuredSchema).toBeInstanceOf(SolverRejectedError);
    expect((legacy as SolverRejectedError).diagnostic.reasonCodes).toEqual([
      "UNRESOLVED_REQUEST",
      "VACATION_MODE",
    ]);
    expect((schema as SolverRejectedError).diagnostic).toEqual({
      kind: "schema_validation",
      issueCount: 1,
      reasonCodes: ["PAYLOAD_VALIDATION"],
      fieldPaths: ["requests[]"],
      issueTypes: ["value_error"],
    });
    expect((structuredSchema as SolverRejectedError).diagnostic).toEqual({
      kind: "schema_validation",
      issueCount: 3,
      reasonCodes: ["PAYLOAD_VALIDATION"],
      fieldPaths: ["requests[]"],
      issueTypes: ["enum"],
    });
    expect(JSON.stringify({ legacy, schema, structuredSchema })).not.toContain(
      PRIVATE_DETAIL,
    );
  });

  it("keeps upstream failures and transport errors retryable", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("unavailable", { status: 500 }))
      .mockRejectedValueOnce(new Error(PRIVATE_DETAIL));

    const upstream = await callSolver("/generate").catch((error: unknown) => error);
    const transport = await callSolver("/generate").catch((error: unknown) => error);

    expect(upstream).toBeInstanceOf(SolverUnavailableError);
    expect(upstream).toMatchObject({ status: 500 });
    expect(transport).toBeInstanceOf(SolverUnavailableError);
    expect(transport).not.toBeInstanceOf(SolverRejectedError);
  });

  it("returns HTTP-200 INFEASIBLE responses as ordinary solver results", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "INFEASIBLE", validation: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(callSolver<{ status: string }>("/generate")).resolves.toEqual({
      status: "INFEASIBLE",
      validation: null,
    });
  });
});
