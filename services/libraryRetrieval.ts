import {
  FULL_INJECT_FOLDER_BUDGET_CHARS,
  RETRIEVAL_BUDGET_CHARS,
  RETRIEVAL_MIN_CHUNKS_FOR_MARGIN,
  RETRIEVAL_MIN_MARGIN,
  RETRIEVAL_RELATIVE_DROP,
  RETRIEVAL_TOP_K,
} from '@/constants/library';
import { useDiagnosticStore } from '@/stores/diagnostic-store';
import { getActiveDocsForFolder, useLibraryStore, type LibraryDoc } from '@/stores/library-store';

import { embedQuery } from './geminiEmbeddingService';
import { readChunks, readDocText, readEmbeddings, type IngestChunk } from './libraryIngestService';

/**
 * Recuperación de la jaula: qué trozos de la obra del autor entran en el análisis
 * de ESTE turno.
 *
 * Dos caminos según el tamaño del documento, y la distinción es interna (al autor
 * nunca se le pregunta nada al subir):
 *   - Documento pequeño (una hoja de estilo, un esqueleto) → entra COMPLETO. No
 *     puede depender de que el retriever lo traiga: si no llega, se incumple.
 *   - Documento grande (una novela) → embeddings + top-k por similitud.
 *
 * La consulta no es solo el turno de ahora: incluye el turno anterior del autor,
 * porque un turno referencial suelto ("y eso cómo encaja con lo de antes") no
 * tiene sustantivos con los que buscar y recuperaría ruido.
 *
 * Solo alimenta al ANALISTA. El interlocutor no la ve: su trabajo es traducir a
 * registro oral, no saber.
 */

export type RetrievedChunk = {
  docId: string;
  docTitle: string;
  chunkIndex: number;
  score: number;
  text: string;
};

export type LibraryContext = {
  /** Bloque listo para inyectar en el system del analista. Vacío si no hay jaula. */
  block: string;
  /** Para Diagnóstico: qué entró y con qué puntuación. */
  fullDocs: { title: string; chars: number }[];
  chunks: RetrievedChunk[];
  /** Documentos completos que NO cupieron en el presupuesto (nunca en silencio). */
  skippedFullDocs: string[];
};

const EMPTY: LibraryContext = { block: '', fullDocs: [], chunks: [], skippedFullDocs: [] };

/** Caché en memoria de la sesión: el coseno del 2º turno en adelante es instantáneo. */
type CachedDoc = { key: string; chunks: IngestChunk[]; vectors: Float32Array };
const cache = new Map<string, CachedDoc>();

/** La clave incluye el progreso de ingesta: si el doc se reindexa, el caché muere. */
function cacheKey(doc: LibraryDoc): string {
  return `${doc.nChunks}:${doc.embeddedChunks}:${doc.chars}`;
}

async function loadDoc(doc: LibraryDoc): Promise<CachedDoc | null> {
  const key = cacheKey(doc);
  const hit = cache.get(doc.id);
  if (hit && hit.key === key) return hit;

  const [chunks, vectors] = await Promise.all([readChunks(doc.id), readEmbeddings(doc.id)]);
  if (!chunks || !vectors) return null;
  const dims = Math.floor(vectors.length / Math.max(1, chunks.length));
  if (dims === 0) return null;
  const entry: CachedDoc = { key, chunks, vectors };
  cache.set(doc.id, entry);
  return entry;
}

export function clearLibraryCache(): void {
  cache.clear();
}

/** Coseno = producto escalar: los vectores se guardan ya normalizados en la ingesta. */
function dot(a: Float32Array, aOff: number, b: Float32Array, dims: number): number {
  let sum = 0;
  for (let i = 0; i < dims; i++) sum += a[aOff + i] * b[i];
  return sum;
}

/**
 * Construye el contexto de jaula para un turno. Devuelve `EMPTY` si la carpeta no
 * tiene documentos activos — en ese caso no se hace NI UNA llamada extra, y el
 * pipeline queda exactamente como antes de existir la biblioteca.
 */
export async function buildLibraryContext(params: {
  apiKey: string;
  folderId: string | null;
  /** Turno actual del autor, ya sanitizado. */
  queryText: string;
  /** Turno anterior del autor, para que los turnos referenciales recuperen bien. */
  previousUserText?: string;
}): Promise<LibraryContext> {
  const { apiKey, folderId, queryText, previousUserText } = params;
  if (!folderId || !apiKey.trim()) return EMPTY;

  const active = getActiveDocsForFolder(useLibraryStore.getState().docs, folderId);
  if (active.length === 0) return EMPTY;

  // --- Documentos pequeños: completos, hasta agotar presupuesto ---------------
  const fullDocs: { title: string; chars: number }[] = [];
  const skippedFullDocs: string[] = [];
  const fullTexts: string[] = [];
  let fullBudget = FULL_INJECT_FOLDER_BUDGET_CHARS;

  const smallFirst = active.filter((d) => d.nChunks === 0).sort((a, b) => a.chars - b.chars);
  for (const doc of smallFirst) {
    const text = await readDocText(doc.id);
    if (!text) continue;
    if (text.length > fullBudget) {
      skippedFullDocs.push(doc.title);
      continue;
    }
    fullBudget -= text.length;
    fullDocs.push({ title: doc.title, chars: text.length });
    fullTexts.push(`--- ${doc.title} ---\n${text}`);
  }

  // --- Documentos grandes: top-k por similitud --------------------------------
  const big = active.filter((d) => d.nChunks > 0);
  const chunks: RetrievedChunk[] = [];
  /** Cuánto despuntaba el mejor sobre la mediana: va a Diagnóstico para afinar. */
  let margin: number | null = null;

  if (big.length > 0) {
    const query = [previousUserText?.trim(), queryText.trim()]
      .filter(Boolean)
      .join('\n\n')
      .slice(-2000);

    const q = await embedQuery(apiKey, query);
    if (q.ok) {
      const dims = q.vector.length;
      const scored: RetrievedChunk[] = [];
      for (const doc of big) {
        const loaded = await loadDoc(doc);
        if (!loaded) continue;
        const n = Math.min(loaded.chunks.length, Math.floor(loaded.vectors.length / dims));
        for (let i = 0; i < n; i++) {
          scored.push({
            docId: doc.id,
            docTitle: doc.title,
            chunkIndex: i,
            score: dot(loaded.vectors, i * dims, q.vector, dims),
            text: loaded.chunks[i].text,
          });
        }
      }
      scored.sort((a, b) => b.score - a.score);

      /**
       * Criterio RELATIVO, no absoluto (ver el razonamiento medido en
       * constants/library.ts). Si el mejor no despunta sobre la mediana, este turno
       * no va de la obra y NO se recupera nada: mejor sin jaula que con seis
       * pasajes al azar presentados como canon relevante.
       */
      if (scored.length > 0) {
        const median = scored[Math.floor(scored.length / 2)].score;
        const best = scored[0].score;
        const enoughToJudge = scored.length >= RETRIEVAL_MIN_CHUNKS_FOR_MARGIN;
        const relevant = !enoughToJudge || best - median >= RETRIEVAL_MIN_MARGIN;

        if (relevant) {
          const floor = best - RETRIEVAL_RELATIVE_DROP;
          let budget = RETRIEVAL_BUDGET_CHARS;
          for (const c of scored) {
            if (chunks.length >= RETRIEVAL_TOP_K) break;
            if (c.score < floor) break; // ordenado: en cuanto uno cae, los demás también
            if (c.text.length > budget) continue;
            budget -= c.text.length;
            chunks.push(c);
          }
        }
        margin = best - median;
      }
    }
  }

  if (fullTexts.length === 0 && chunks.length === 0) {
    logContext({ fullDocs, chunks, skippedFullDocs }, margin);
    return { ...EMPTY, skippedFullDocs };
  }

  // --- Bloque para el system del analista -------------------------------------
  const sections: string[] = [
    `=== JAULA: OBRA DEL AUTOR ===
Lo que sigue son documentos que el autor ha fijado como CANON VINCULANTE para esta carpeta: su obra, su esqueleto, sus normas. No son sugerencias.

Reglas:
- Respeta el canon. Si la aportación de hoy CONTRADICE algo del canon, SEÑÁLALO explícitamente: esa tensión es información valiosa para el autor y no te toca a ti resolverla en silencio.
- Cita el canon cuando te apoyes en él ("en tu capítulo tal dices…"), para que el autor sepa de dónde viene lo que le cuentas.`,
  ];

  if (fullTexts.length > 0) {
    sections.push(`--- DOCUMENTOS COMPLETOS ---\n${fullTexts.join('\n\n')}`);
  }
  if (chunks.length > 0) {
    sections.push(
      `--- FRAGMENTOS RECUPERADOS POR RELEVANCIA ---
Son EXTRACTOS PARCIALES de documentos largos: puede faltarles contexto alrededor. Apóyate en ellos, pero NO inventes contenido de la obra que no esté aquí. Si para responder bien necesitarías más obra de la que tienes delante, dilo en vez de rellenar.

${chunks
  .map((c) => `[${c.docTitle} · fragmento ${c.chunkIndex + 1}]\n${c.text}`)
  .join('\n\n')}`
    );
  }

  const block = sections.join('\n\n');
  logContext({ fullDocs, chunks, skippedFullDocs }, margin);
  return { block, fullDocs, chunks, skippedFullDocs };
}

/**
 * Traza en Diagnóstico qué entró en la jaula. Para el autor es la diferencia entre
 * magia y sospecha; para afinar k y umbral, la única herramienta que hay.
 */
function logContext(ctx: Omit<LibraryContext, 'block'>, margin: number | null): void {
  const parts: string[] = [];
  if (margin !== null) {
    // El margen sobre la mediana es LA cifra para afinar RETRIEVAL_MIN_MARGIN con
    // obra real: si turnos claramente sobre la obra salen con margen bajo, hay que
    // bajarlo; si entra ruido, subirlo.
    parts.push(`margen ${margin.toFixed(3)} (mín ${RETRIEVAL_MIN_MARGIN})`);
  }
  if (ctx.fullDocs.length) {
    parts.push(`completos: ${ctx.fullDocs.map((d) => `${d.title} (${d.chars}c)`).join(', ')}`);
  }
  if (ctx.chunks.length) {
    parts.push(
      `fragmentos: ${ctx.chunks
        .map((c) => `${c.docTitle}#${c.chunkIndex + 1}@${c.score.toFixed(2)}`)
        .join(', ')}`
    );
  }
  if (ctx.skippedFullDocs.length) {
    parts.push(`FUERA por presupuesto: ${ctx.skippedFullDocs.join(', ')}`);
  }
  useDiagnosticStore.getState().push({
    stage: 'library-context',
    model: `${ctx.fullDocs.length} doc + ${ctx.chunks.length} frag`,
    latencyMs: 0,
    ok: true,
    error: parts.length ? parts.join(' · ') : 'sin jaula activa',
  });
}
