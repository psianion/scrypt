// src/server/embeddings/engine.ts
//
// Lazy-loaded wrapper around @huggingface/transformers that produces
// L2-normalized float32 embeddings in batches. The model stays resident
// in the Bun process for the life of the server.
//
// Transformers.js is dynamically imported inside load() rather than at
// module top level because its module init code touches import.meta.url
// in a way that can throw in some Bun environments. Deferring the
// import also means modules that only need the type can include the
// engine without paying the model-load cost.

export interface EngineOptions {
  model: string;
  batchSize: number;
  cacheDir: string;
}

type FeaturePipeline = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export class EmbeddingEngine {
  private pipe: FeaturePipeline | null = null;
  private loading: Promise<FeaturePipeline> | null = null;

  constructor(private readonly opts: EngineOptions) {}

  get model(): string {
    return this.opts.model;
  }
  get batchSize(): number {
    return this.opts.batchSize;
  }

  private async load(): Promise<FeaturePipeline> {
    if (this.pipe) return this.pipe;
    if (!this.loading) {
      this.loading = (async () => {
        const transformers = await import("@huggingface/transformers");
        transformers.env.cacheDir = this.opts.cacheDir;
        transformers.env.allowLocalModels = true;
        return transformers.pipeline(
          "feature-extraction",
          this.opts.model,
        ) as unknown as FeaturePipeline;
      })();
    }
    this.pipe = await this.loading;
    return this.pipe;
  }

  async prewarm(): Promise<void> {
    const p = await this.load();
    await p(["ready"], { pooling: "mean", normalize: true });
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const p = await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.opts.batchSize) {
      const slice = texts.slice(i, i + this.opts.batchSize);
      const tensor = await p(slice, { pooling: "mean", normalize: true });
      const arr = tensor.tolist();
      for (const row of arr) out.push(new Float32Array(row));
    }
    return out;
  }
}
