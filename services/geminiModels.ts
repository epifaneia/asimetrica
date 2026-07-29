import type { ThinkingLevel } from './geminiClient';

/**
 * Configuración de modelo y razonamiento por stage del pipeline.
 * Cada stage tiene una palanca independiente vía `EXPO_PUBLIC_GEMINI_*`.
 *
 * Defaults razonados:
 *   - STT y Sanitiza: Flash Lite (ASR mejorado, latencia mínima, coste casi cero).
 *   - Analiza: Pro con thinking HIGH (frontier reasoning; el corazón del producto).
 *   - Interlocutor: Flash con thinking LOW (traducción de registro, no análisis).
 *   - Corto: Pro con thinking MEDIUM (latido final del perfil, no análisis nuevo).
 *   - Fusión documental: Pro (operación poco frecuente, prima la calidad).
 */

const env = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : undefined;
};

const THINKING_VALUES: ThinkingLevel[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

function parseThinking(raw: string | undefined): ThinkingLevel | undefined {
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  return (THINKING_VALUES as string[]).includes(upper) ? (upper as ThinkingLevel) : undefined;
}

// IDs reales (v1beta, mayo 2026):
//   - Flash Lite es GA estable: `gemini-3.1-flash-lite`.
//   - Pro y Flash 3 siguen en preview: sufijo `-preview` obligatorio.
//   - TTS preview: `gemini-3.1-flash-tts-preview` (audio out con responseModalities=AUDIO).
export const GEMINI_MODELS = {
  stt: env('EXPO_PUBLIC_GEMINI_STT_MODEL') ?? 'gemini-3.1-flash-lite',
  sanitize: env('EXPO_PUBLIC_GEMINI_SANITIZE_MODEL') ?? 'gemini-3.1-flash-lite',
  analyze: env('EXPO_PUBLIC_GEMINI_ANALYZE_MODEL') ?? 'gemini-3.1-pro-preview',
  interlocutor: env('EXPO_PUBLIC_GEMINI_INTERLOCUTOR_MODEL') ?? 'gemini-3-flash-preview',
  // Recap de espera activa: corre EN PARALELO al analista, así que manda la latencia.
  // Flash Lite: llega en 1-3 s, que es lo único que importa aquí.
  recap: env('EXPO_PUBLIC_GEMINI_RECAP_MODEL') ?? 'gemini-3.1-flash-lite',
  corto: env('EXPO_PUBLIC_GEMINI_CORTO_MODEL') ?? 'gemini-3.1-pro-preview',
  fusion: env('EXPO_PUBLIC_GEMINI_FUSION_MODEL') ?? 'gemini-3.1-pro-preview',
  tts: env('EXPO_PUBLIC_GEMINI_TTS_MODEL') ?? 'gemini-3.1-flash-tts-preview',
  // Biblioteca de obra (jaula): embeddings para retrieval. GA estable desde 2025.
  embedding: env('EXPO_PUBLIC_GEMINI_EMBEDDING_MODEL') ?? 'gemini-embedding-001',
} as const;

/**
 * Agente de investigación profunda. NO es un modelo de `generateContent`: se usa
 * por la Interactions API, en background y con sondeo (ver deepResearchService).
 *
 * Existen dos tiers: `deep-research-preview-04-2026` (rápido, ~1-3 $ por
 * investigación) y `deep-research-max-preview-04-2026` (exhaustivo, ~3-7 $). Se
 * usa el primero por decisión de producto — el caro queda descartado, pero se
 * puede cambiar por env sin tocar código si algún día compensa.
 *
 * Lleva `preview` y fecha en el nombre, así que caduca: el botón «Probar conexión»
 * de Ajustes es el sitio donde se nota antes de un paseo.
 */
export const GEMINI_RESEARCH_AGENT =
  env('EXPO_PUBLIC_GEMINI_RESEARCH_AGENT') ?? 'deep-research-preview-04-2026';

export const GEMINI_THINKING = {
  analyze: parseThinking(env('EXPO_PUBLIC_GEMINI_ANALYZE_THINKING')) ?? 'HIGH',
  interlocutor: parseThinking(env('EXPO_PUBLIC_GEMINI_INTERLOCUTOR_THINKING')) ?? 'LOW',
  corto: parseThinking(env('EXPO_PUBLIC_GEMINI_CORTO_THINKING')) ?? 'MEDIUM',
} as const;
