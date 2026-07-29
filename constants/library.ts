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

/**
 * SINOPSIS: se genera una vez por documento en la ingesta y se inyecta SIEMPRE,
 * pase lo que pase con el retrieval.
 *
 * No es solo para que funcione «resúmemelo» (una pregunta sobre el documento
 * entero no se parece a ningún fragmento concreto, así que el criterio de margen
 * la deja en cero). El arreglo de fondo es otro: sin sinopsis, cuando el retrieval
 * no recupera nada el modelo NO SABE NI QUE EL DOCUMENTO EXISTE — no puede decir
 * «eso no está en tu material» porque no sabe qué material hay.
 *
 * Y es diez veces más barato que inyectar documentos enteros: tres sinopsis son
 * ~600 tokens por turno frente a ~7.500 de tres documentos completos. Los
 * embeddings siguen haciendo el trabajo pesado.
 */
export const SYNOPSIS_MAX_CHARS = 800;

/** Docs con ≤ este nº de caracteres se inyectan enteros (sin retrieval). */
export const FULL_INJECT_MAX_CHARS = 8_000;
/** Presupuesto total de inyección completa por carpeta; el exceso pasa a retrieval. */
export const FULL_INJECT_FOLDER_BUDGET_CHARS = 24_000;
/** Nº máximo de chunks recuperados por turno. */
export const RETRIEVAL_TOP_K = 6;

/**
 * NO hay umbral absoluto de similitud, y esto está medido, no supuesto.
 *
 * `gemini-embedding-001` no devuelve valores calibrados: dos textos cualesquiera
 * en español ya puntúan 0,55-0,60 solo por compartir idioma. Con un umbral
 * absoluto de 0,5, en una prueba real con 6 capítulos de novela pasaban 6 de 6
 * tanto para «el naufragio del pesquero» (correcto) como para «renovar el seguro
 * del coche» (nada que ver). O sea: un turno fuera de tema le habría inyectado al
 * analista seis pasajes al azar de la obra como si fueran canon relevante.
 *
 * Lo que SÍ discrimina es la FORMA de la distribución. Con consulta pertinente el
 * primero despunta sobre la mediana (medido: +0,067 y +0,116); con consulta ajena
 * la distribución es plana (+0,0095).
 */
/** El primero debe despuntar esto sobre la mediana, o no se recupera NADA. */
export const RETRIEVAL_MIN_MARGIN = 0.04;
/** Ya dentro, se admite lo que caiga a esta distancia del mejor. */
export const RETRIEVAL_RELATIVE_DROP = 0.05;
/** Con menos chunks que esto la mediana no es fiable: se salta la comprobación. */
export const RETRIEVAL_MIN_CHUNKS_FOR_MARGIN = 4;
/** Presupuesto máximo de caracteres de chunks inyectados por turno. */
export const RETRIEVAL_BUDGET_CHARS = 16_000;

// ---------------------------------------------------------------------------
// Límites v1 (avisos visibles, no muros silenciosos)
// ---------------------------------------------------------------------------

/** Tamaño máximo de texto por documento (30 MB ≈ 20 novelas encuadernadas juntas). */
export const MAX_DOC_TEXT_CHARS = 30_000_000;
/** Aviso ámbar si el total de inyección completa de una carpeta supera esto. */
export const NUCLEO_WARN_CHARS = 15_000 * 4; // ~15k tokens
