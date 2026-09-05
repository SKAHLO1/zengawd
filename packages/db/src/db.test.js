import { describe, expect, it } from "vitest";
import { openDb, intentRequests, newId, nowIso } from "./index";
describe("db", () => {
    it("migrates and round-trips an intent_requests row verbatim", () => {
        const db = openDb(":memory:");
        const id = newId();
        const payload = JSON.stringify({ query: "x", nested: { a: [1, 2, 3] } });
        db.insert(intentRequests)
            .values({
            id,
            intent: "TOKEN_HOLDER_COUNT",
            requestedConfidence: 0.6,
            deadlineMs: 4000,
            status: "ok",
            minerId: "7302",
            returnedConfidence: 0.95,
            latencyMs: 123,
            costUsd: 0.01,
            settlementTxHash: "0xabc",
            requestPayload: payload,
            responsePayload: payload,
            createdAt: nowIso(),
        })
            .run();
        const rows = db.select().from(intentRequests).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.requestPayload).toBe(payload);
        expect(rows[0]?.minerId).toBe("7302");
    });
});
//# sourceMappingURL=db.test.js.map