// tests/server/embeddings/engine.test.ts
//
// The real-model tests are heavy (~33MB download on first run, ~2s warm
// inference). They are opt-in via SCRYPT_TEST_HEAVY=1. The cheap tests
// (empty batch, no model load) always run.
import { test, expect, describe } from "bun:test";
import { EmbeddingEngine } from "../../../src/server/embeddings/engine";

const HEAVY = process.env.SCRYPT_TEST_HEAVY === "1";

describe("EmbeddingEngine", () => {
  test("embedBatch([]) returns [] without loading the model", async () => {
    const eng = new EmbeddingEngine({
      model: "Xenova/bge-small-en-v1.5",
      batchSize: 4,
      cacheDir: "/tmp/scrypt-embed-test-cache",
    });
    const out = await eng.embedBatch([]);
    expect(out).toEqual([]);
  });

  test.skipIf(!HEAVY)(
    "embedBatch returns unit-norm vectors of the configured dim",
    async () => {
      const eng = new EmbeddingEngine({
        model: "Xenova/bge-small-en-v1.5",
        batchSize: 4,
        cacheDir: "/tmp/scrypt-embed-test-cache",
      });
      const vectors = await eng.embedBatch([
        "Short Note\n\nreinforcement learning with policy gradients",
        "Short Note\n\na cat sat on the mat",
      ]);
      expect(vectors.length).toBe(2);
      expect(vectors[0].length).toBe(384);
      let sumSq = 0;
      for (let i = 0; i < vectors[0].length; i++) sumSq += vectors[0][i] ** 2;
      const norm = Math.sqrt(sumSq);
      expect(norm).toBeGreaterThan(0.99);
      expect(norm).toBeLessThan(1.01);
    },
  );

  test.skipIf(!HEAVY)(
    "semantically related texts have higher cosine than unrelated",
    async () => {
      const eng = new EmbeddingEngine({
        model: "Xenova/bge-small-en-v1.5",
        batchSize: 4,
        cacheDir: "/tmp/scrypt-embed-test-cache",
      });
      const [q, related, unrelated] = await eng.embedBatch([
        "reinforcement learning",
        "policy gradient methods in RL",
        "baking sourdough at home",
      ]);
      const dot = (a: Float32Array, b: Float32Array) => {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += a[i] * b[i];
        return s;
      };
      expect(dot(q, related)).toBeGreaterThan(dot(q, unrelated));
    },
  );
});
