import * as FileSystem from 'expo-file-system/legacy';

import { useDiagnosticStore } from '@/stores/diagnostic-store';

/**
 * Cliente de bajo nivel para la Gemini Developer API (v1beta).
 * Único punto de salida HTTP a Gemini en la app: pipeline de disertación,
 * STT multimodal y fusión documental lo consumen.
 *
 * Robustez (asimetrica_pro): toda llamada lleva timeout (AbortController) y
 * un reintento automático con backoff ante errores transitorios (red caída,
 * 429, 5xx). Los errores definitivos (400/401/403/404) no se reintentan.
 * El usage (tokens in/out) se registra en el diagnóstico para estimar coste.
 */

export type Role = 'user' | 'model';

export type GeminiTextPart = { text: string };
export type GeminiInlinePart = { inlineData: { mimeType: string; data: string } };
export type GeminiPart = GeminiTextPart | GeminiInlinePart;

export type GeminiTurn = { role: Role; parts: GeminiPart[] };

/** Niveles de razonamiento extendido (Gemini 3+). Sustituye al antiguo `thinkingBudget`. */
export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export type GeminiCallParams = {
  apiKey: string;
  modelId: string;
  systemInstruction?: string;
  contents: GeminiTurn[];
  temperature?: number;
  maxOutputTokens?: number;
  thinkingLevel?: ThinkingLevel;
  /** Etiqueta para el log de diagnóstico (p. ej. 'sanitize', 'analyze', 'title-gen'). */
  stage?: string;
  /** Timeout por intento, en ms. Default 60 s (90 s para stages con audio). */
  timeoutMs?: number;
  /** Nº máximo de reintentos ante error transitorio. Default 1. */
  maxRetries?: number;
};

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 60_000;
const RETRY_BACKOFF_MS = 1_500;

type GeminiResponse = {
  error?: { message?: string; code?: number; status?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

/** HTTP definitivos: reintentar no va a arreglar una key mala o un modelo inexistente. */
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

export async function generateContent(params: GeminiCallParams): Promise<GeminiResult> {
  const {
    apiKey,
    modelId,
    systemInstruction,
    contents,
    temperature = 0.7,
    maxOutputTokens = 8192,
    thinkingLevel,
    stage,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = 1,
  } = params;

  const startMs = Date.now();
  const log = (ok: boolean, error?: string, extra?: { tokensIn?: number; tokensOut?: number; retries?: number }) => {
    if (!stage) return;
    useDiagnosticStore.getState().push({
      stage,
      model: modelId,
      latencyMs: Date.now() - startMs,
      ok,
      error,
      ...extra,
    });
  };

  if (!apiKey.trim()) {
    log(false, 'Falta Google API Key.');
    return { ok: false, error: 'Falta Google API Key.' };
  }
  if (!modelId.trim()) {
    log(false, 'Falta modelo Gemini.');
    return { ok: false, error: 'Falta modelo Gemini.' };
  }

  const url = `${BASE_URL}/${modelId}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

  const generationConfig: Record<string, unknown> = {
    temperature,
    maxOutputTokens,
  };
  if (thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel };
  }

  const body: Record<string, unknown> = {
    contents: contents.map((c) => ({ role: c.role, parts: c.parts })),
    generationConfig,
  };
  if (systemInstruction?.trim()) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  const payload = JSON.stringify(body);

  let lastError = 'Error desconocido.';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_MS * attempt);
    try {
      const res = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload },
        timeoutMs,
      );

      const data = (await res.json()) as GeminiResponse;
      if (!res.ok) {
        lastError = data.error?.message ?? `HTTP ${res.status}`;
        if (isFatalHttp(res.status)) {
          log(false, lastError, { retries: attempt });
          return { ok: false, error: lastError };
        }
        continue; // 429/5xx → reintento
      }
      const candidate = data.candidates?.[0];
      const reason = candidate?.finishReason;
      if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') {
        const error = `Generación detenida (${reason}).`;
        log(false, error, { retries: attempt });
        return { ok: false, error };
      }
      const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
      if (!text) {
        lastError = 'El modelo no devolvió texto.';
        continue; // respuesta vacía esporádica → merece reintento
      }
      const usage = data.usageMetadata;
      log(true, undefined, {
        tokensIn: usage?.promptTokenCount,
        tokensOut: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0) || undefined,
        retries: attempt || undefined,
      });
      return { ok: true, text };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      lastError = aborted
        ? `Timeout tras ${Math.round(timeoutMs / 1000)} s.`
        : e instanceof Error ? e.message : String(e);
      // red caída / timeout → reintento
    }
  }
  log(false, lastError, { retries: maxRetries });
  return { ok: false, error: lastError };
}

/**
 * Valida la API key y la disponibilidad de un modelo concreto con una
 * petición mínima. Para el botón "Probar conexión" de Ajustes: si un ID de
 * modelo no existe (los `*-preview` caducan), aquí se ve al instante.
 */
export async function probeModel(apiKey: string, modelId: string): Promise<GeminiResult> {
  return generateContent({
    apiKey,
    modelId,
    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    maxOutputTokens: 16,
    temperature: 0,
    stage: `probe:${modelId}`,
    timeoutMs: 20_000,
    maxRetries: 0,
  });
}

/** Lee un archivo local como base64 para incrustarlo en `inlineData` (audio multimodal). */
export async function fileToBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}
