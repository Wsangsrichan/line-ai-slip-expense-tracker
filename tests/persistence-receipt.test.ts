import { describe, expect, it } from "vitest";
import { SignedPendingSlipStore } from "../src/services/persistence.js";

describe("cross-invocation upload receipt", () => {
  it("can be consumed by a new store instance without trusting client ownership", async () => {
    const firstInvocation = new SignedPendingSlipStore("test-only-placeholder-key");
    const uploadId = await firstInvocation.createPending("user-a", "dummy://slips/user-a/image", "hash-a");
    const secondInvocation = new SignedPendingSlipStore("test-only-placeholder-key");

    await expect(secondInvocation.consume("user-a", uploadId)).resolves.toEqual({
      storageRef: "dummy://slips/user-a/image",
      contentHash: "hash-a",
    });
    await expect(secondInvocation.consume("user-b", uploadId)).resolves.toBeNull();
    await expect(secondInvocation.consume("user-a", `${uploadId}tampered`)).resolves.toBeNull();
  });
});
