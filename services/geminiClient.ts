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
  /**
   * Herramientas para el modelo. Hoy solo se usa `[{ google_search: {} }]` para el
   * perfil de investigación. Verificado contra la API: añade ~11 s en Pro y ~6 s
   * en Flash, y devuelve `groundingMetadata` con las búsquedas que hizo y las
   * fuentes que citó (se registran en Diagnóstico).
   */
  tools?: Record<string, unknown>[];
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
    /** Presente cuando el modelo usó la herramienta de búsqueda. */
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
    };
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
    tools,
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
  if (tools?.length) {
    body.tools = tools;
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
      // Si hubo búsqueda web, se registran las consultas y las fuentes: el autor
      // tiene que poder ver de dónde salió lo que le están contando.
      const gm = candidate?.groundingMetadata;
      let grounding: string | undefined;
      if (gm) {
        const queries = (gm.webSearchQueries ?? []).slice(0, 4).join(' · ');
        const sources = [
          ...new Set((gm.groundingChunks ?? []).map((c) => c.web?.title).filter(Boolean)),
        ].slice(0, 6);
        grounding = `buscó: ${queries || '—'} | fuentes: ${sources.join(', ') || 'ninguna'}`;
      }
      log(true, grounding, {
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
 * Igual que `generateContent`, pero avisando del texto a medida que llega
 * (`streamGenerateContent` con `alt=sse`).
 *
 * Existe por una razón concreta: el TTS de Gemini tarda ~0,75x el tiempo real del
 * audio, así que esperar el texto COMPLETO del interlocutor antes de empezar a
 * sintetizar regala 15-20 s de silencio. Con esto, la primera frase entra al TTS
 * en cuanto está escrita.
 *
 * Sin reintento: un stream cortado a medias no se puede reanudar sin duplicar
 * texto ya hablado. El llamante decide si cae al camino no-streaming.
 */
export async function generateContentStream(
  params: GeminiCallParams & { onDelta: (chunk: string) => void }
): Promise<GeminiResult> {
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
    onDelta,
  } = params;

  const startMs = Date.now();
  const log = (ok: boolean, error?: string) => {
    if (!stage) return;
    useDiagnosticStore.getState().push({
      stage,
      model: modelId,
      latencyMs: Date.now() - startMs,
      ok,
      error,
    });
  };

  if (!apiKey.trim()) return { ok: false, error: 'Falta Google API Key.' };
  if (!modelId.trim()) return { ok: false, error: 'Falta modelo Gemini.' };

  const url = `${BASE_URL}/${modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey.trim())}`;
  const generationConfig: Record<string, unknown> = { temperature, maxOutputTokens };
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  const body: Record<string, unknown> = {
    contents: contents.map((c) => ({ role: c.role, parts: c.parts })),
    generationConfig,
  };
  if (systemInstruction?.trim()) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  /**
   * XMLHttpRequest y no `fetch`: en React Native el fetch es un polyfill sobre XHR
   * y NO expone `res.body` como stream legible, así que `await res.text()` espera
   * la respuesta completa — un streaming de mentira que no adelantaría ni un
   * segundo. XHR sí va acumulando `responseText` y avisando por `onprogress`, que
   * es lo que de verdad permite empezar a sintetizar la primera frase.
   */
  return new Promise<GeminiResult>((resolve) => {
    let full = '';
    /** Cuánto de `responseText` se ha consumido ya. */
    let cursor = 0;
    /** Resto de línea incompleta entre eventos de progreso. */
    let carry = '';
    let settled = false;

    const finish = (r: GeminiResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const consume = (text: string) => {
      carry += text;
      const lines = carry.split('\n');
      carry = lines.pop() ?? ''; // la última puede estar a medias
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as GeminiResponse;
          const piece = evt.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
          if (piece) {
            full += piece;
            onDelta(piece);
          }
        } catch {
          /* evento partido: llegará completo en el siguiente progreso */
        }
      }
    };

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = timeoutMs;

    xhr.onprogress = () => {
      const text = xhr.responseText ?? '';
      if (text.length <= cursor) return;
      const fresh = text.slice(cursor);
      cursor = text.length;
      consume(fresh);
    };

    xhr.onload = () => {
      const text = xhr.responseText ?? '';
      if (text.length > cursor) {
        consume(text.slice(cursor));
        cursor = text.length;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg = `HTTP ${xhr.status}`;
        try {
          const data = JSON.parse(text) as GeminiResponse;
          msg = data.error?.message ?? msg;
        } catch {
          /* cuerpo no-JSON */
        }
        log(false, msg);
        finish({ ok: false, error: msg });
        return;
      }
      const out = full.trim();
      if (!out) {
        log(false, 'El modelo no devolvió texto.');
        finish({ ok: false, error: 'El modelo no devolvió texto.' });
        return;
      }
      log(true);
      finish({ ok: true, text: out });
    };

    xhr.onerror = () => {
      log(false, 'Error de red.');
      finish({ ok: false, error: 'Error de red.' });
    };
    xhr.ontimeout = () => {
      const msg = `Timeout tras ${Math.round(timeoutMs / 1000)} s.`;
      log(false, msg);
      finish({ ok: false, error: msg });
    };

    xhr.send(JSON.stringify(body));
  });
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
