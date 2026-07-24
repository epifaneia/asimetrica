import { useDiagnosticStore } from '@/stores/diagnostic-store';
import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS } from '@/constants/library';

import { GEMINI_MODELS } from './geminiModels';

/**
 * Embeddings vía Gemini API (`batchEmbedContents`), misma key BYOK que el resto.
 *
 * Dos usos con task types distintos (mejora el retrieval asimétrico):
 *   - Ingesta de biblioteca: RETRIEVAL_DOCUMENT (lotes).
 *   - Query del turno en el paseo: RETRIEVAL_QUERY (uno, camino caliente).
 *
 * IMPORTANTE (MRL): con `outputDimensionality` < 3072 los vectores NO llegan
 * normalizados → se renormalizan aquí. Así el coseno queda en un producto
 * escalar simple en el momento del retrieval.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const BATCH_TIMEOUT_MS = 45_000;
const QUERY_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = 1_500;

export type EmbedResult =
  | { ok: true; vectors: Float32Array[] }
  | { ok: false; error: string };

type BatchEmbedResponse = {
  error?: { message?: string; code?: number };
  embeddings?: Array<{ values?: number[] }>;
};

function isFatalHttp(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function normalize(values: number[]): Float32Array {
  const v = new Float32Array(values);
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

async function embedBatch(params: {
  apiKey: string;
  texts: string[];
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
  timeoutMs: number;
  maxRetries: number;
  stage: string;
}): Promise<EmbedResult> {
  const { apiKey, texts, taskType, timeoutMs, maxRetries, stage } = params;
  const modelId = GEMINI_MODELS.embedding;

  const startMs = Date.now();
  const log = (ok: boolean, error?: string) => {
    useDiagnosticStore.getState().push({
      stage,
      model: modelId,
      latencyMs: Date.now() - startMs,
      ok,
      error,
    });
  };

  if (!apiKey.trim()) {
    log(false, 'Falta Google API Key.');
    return { ok: false, error: 'Falta Google API Key.' };
  }
  if (texts.length === 0) return { ok: true, vectors: [] };

  const url = `${BASE_URL}/${modelId}:batchEmbedContents?key=${encodeURIComponent(apiKey.trim())}`;
  const payload = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${modelId}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    })),
  });

  let lastError = 'Error desconocido.';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS * attempt);
    try {
      const res = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload },
        timeoutMs
      );
      const data = (await res.json()) as BatchEmbedResponse;
      if (!res.ok) {
        lastError = data.error?.message ?? `HTTP ${res.status}`;
        if (isFatalHttp(res.status)) {
          log(false, lastError);
          return { ok: false, error: lastError };
        }
        continue;
      }
      const embeddings = data.embeddings ?? [];
      if (embeddings.length !== texts.length) {
        lastError = `La API devolvió ${embeddings.length} embeddings para ${texts.length} textos.`;
        continue;
      }
      const vectors = embeddings.map((e) => normalize(e.values ?? []));
      if (vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        const bad = vectors.find((v) => v.length !== EMBEDDING_DIMENSIONS);
        log(false, `Dimensión inesperada: ${bad?.length}.`);
        return { ok: false, error: `Dimensión inesperada: ${bad?.length}.` };
      }
      log(true);
      return { ok: true, vectors };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      lastError = aborted
        ? `Timeout tras ${Math.round(timeoutMs / 1000)} s.`
        : e instanceof Error ? e.message : String(e);
    }
  }
  log(false, lastError);
  return { ok: false, error: lastError };
}

/** Ingesta: embebe un lote de chunks de documento (≤ EMBEDDING_BATCH_SIZE). */
export async function embedDocumentChunks(apiKey: string, texts: string[]): Promise<EmbedResult> {
  if (texts.length > EMBEDDING_BATCH_SIZE) {
    return { ok: false, error: `Lote de ${texts.length} > ${EMBEDDING_BATCH_SIZE}.` };
  }
  return embedBatch({
    apiKey,
    texts,
    taskType: 'RETRIEVAL_DOCUMENT',
    timeoutMs: BATCH_TIMEOUT_MS,
    maxRetries: 2,
    stage: 'library-embed',
  });
}

/** Camino caliente del paseo: embebe la aportación del turno. Rápido y sin insistir. */
export async function embedQuery(apiKey: string, text: string): Promise<
  { ok: true; vector: Float32Array } | { ok: false; error: string }
> {
  const res = await embedBatch({
    apiKey,
    texts: [text],
    taskType: 'RETRIEVAL_QUERY',
    timeoutMs: QUERY_TIMEOUT_MS,
    maxRetries: 1,
    stage: 'library-query',
  });
  if (!res.ok) return res;
  return { ok: true, vector: res.vectors[0] };
}
