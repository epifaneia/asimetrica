/**
 * Biblioteca de obra — todas las palancas de tuning en un solo sitio.
 *
 * Filosofía «jaula» (estilo NotebookLM): TODO documento subido es canon
 * vinculante para el analista. No hay clases de cara al usuario; la única
 * distinción es interna y automática:
 *   - docs pequeños → se inyectan ENTEROS (una hoja de estilo no puede
 *     depender de que el retriever la traiga: si falta, se viola),
 *   - docs grandes → chunking + embeddings + top-k por turno.
 */

// ---------------------------------------------------------------------------
// Chunking (prosa-consciente)
// ---------------------------------------------------------------------------

/** Tamaño objetivo de chunk, en caracteres (~250 tokens en español). */
export const CHUNK_TARGET_CHARS = 1000;
/** Solape entre chunks consecutivos (fracción del tamaño objetivo). */
export const CHUNK_OVERLAP_FRACTION = 0.15;

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** Dimensión reducida (MRL): 768 basta para retrieval y pesa 4× menos que 3072. */
export const EMBEDDING_DIMENSIONS = 768;
/** Tamaño de lote hacia batchEmbedContents (límite API: 100). */
export const EMBEDDING_BATCH_SIZE = 64;

// ---------------------------------------------------------------------------
// Inyección al analista (camino caliente del paseo)
// ---------------------------------------------------------------------------

/** Docs con ≤ este nº de caracteres se inyectan enteros (sin retrieval). */
export const FULL_INJECT_MAX_CHARS = 8_000;
/** Presupuesto total de inyección completa por carpeta; el exceso pasa a retrieval. */
export const FULL_INJECT_FOLDER_BUDGET_CHARS = 24_000;
/** Nº de chunks recuperados por turno. */
export const RETRIEVAL_TOP_K = 6;
/** Similitud coseno mínima para que un chunk entre (evita ruido en turnos off-topic). */
export const RETRIEVAL_MIN_SCORE = 0.5;
/** Presupuesto máximo de caracteres de chunks inyectados por turno. */
export const RETRIEVAL_BUDGET_CHARS = 16_000;

// ---------------------------------------------------------------------------
// Límites v1 (avisos visibles, no muros silenciosos)
// ---------------------------------------------------------------------------

/** Tamaño máximo de texto por documento (30 MB ≈ 20 novelas encuadernadas juntas). */
export const MAX_DOC_TEXT_CHARS = 30_000_000;
/** Aviso ámbar si el total de inyección completa de una carpeta supera esto. */
export const NUCLEO_WARN_CHARS = 15_000 * 4; // ~15k tokens
