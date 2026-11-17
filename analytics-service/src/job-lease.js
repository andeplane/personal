// GCS generation preconditions provide a small cross-execution lease without
// granting the worker write access to either source database.
export async function withLease(bucket, name, ttlMs, work) {
  const file = bucket.file(`locks/${name}.json`);
  let priorGeneration = 0;
  if ((await file.exists())[0]) {
    const [metadata] = await file.getMetadata();
    priorGeneration = metadata.generation;
    const lease = JSON.parse(
      (await file.download({ generation: priorGeneration }))[0],
    );
    if (lease.expiresAt > Date.now())
      return { skipped: "another execution holds the lease" };
  }
  try {
    await file.save(JSON.stringify({ expiresAt: Date.now() + ttlMs }), {
      contentType: "application/json",
      preconditionOpts: { ifGenerationMatch: priorGeneration },
    });
  } catch (error) {
    if (error.code === 412)
      return { skipped: "another execution acquired the lease" };
    throw error;
  }
  const [owned] = await file.getMetadata();
  try {
    return await work();
  } finally {
    await file.delete({ ifGenerationMatch: owned.generation });
  }
}
