import test from "node:test";
import assert from "node:assert/strict";
import { withLease } from "../src/job-lease.js";
test("a second worker skips active lease and failed work releases its lease", async () => {
  let value = null,
    generation = 0;
  const file = {
    exists: async () => [value !== null],
    getMetadata: async () => [{ generation: String(generation) }],
    download: async () => [Buffer.from(value)],
    async save(next, { preconditionOpts }) {
      if (Number(preconditionOpts.ifGenerationMatch) !== generation)
        throw Object.assign(new Error("conflict"), { code: 412 });
      value = next;
      generation++;
    },
    async delete({ ifGenerationMatch }) {
      assert.equal(Number(ifGenerationMatch), generation);
      value = null;
      generation = 0;
    },
  };
  const bucket = { file: () => file };
  await assert.rejects(
    () =>
      withLease(bucket, "sync", 60000, async () => {
        const second = await withLease(bucket, "sync", 60000, async () =>
          assert.fail("must not run concurrently"),
        );
        assert.equal(second.skipped, "another execution holds the lease");
        throw new Error("worker failed");
      }),
    /worker failed/,
  );
  assert.equal(value, null);
  assert.equal(await withLease(bucket, "sync", 60000, async () => 42), 42);
});
