import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import {
  CHUNK_OVERLAP_FRACTION,
  CHUNK_TARGET_CHARS,
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  FULL_INJECT_MAX_CHARS,
  MAX_DOC_TEXT_CHARS,
} from '@/constants/library';
import { useLibraryStore, type LibraryDoc, type LibraryDocKind } from '@/stores/library-store';

import { embedDocumentChunks } from './geminiEmbeddingService';
import { extractPdfText } from './pdfTextExtraction';

/**
 * Ingesta de la biblioteca de obra: fuente → texto → chunks → embeddings.
 *
 * REANUDABLE por diseño (mismo patrón que la bandeja de pendientes): cada fase
 * persiste su resultado en disco y su avance en el store ANTES de pasar a la
 * siguiente. Si la app muere a mitad, `resumeUnfinishedIngestions()` retoma
 * desde la última fase completada — incluido a mitad del embebido (los
 * vectores ya calculados no se repagan).
 *
 * Layout en disco (documentDirectory/library/<docId>/):
 *   source.<ext>     copia del archivo original (el URI del picker es volátil)
 *   text.txt         texto extraído completo (los docs pequeños se inyectan de aquí)
 *   chunks.json      [{ i, text, offset }] — solo docs grandes
 *   embeddings.bin   Float32Array plano en base64 (nChunks × EMBEDDING_DIMENSIONS)
 *
 * Sin sqlite (decisión de proyecto): binarios a filesystem, metadatos a Zustand.
 */

export type IngestChunk = { i: number; text: string; offset: number };

const libraryRoot = () => `${FileSystem.documentDirectory ?? ''}library/`;
export const libraryDocDir = (docId: string) => `${libraryRoot()}${docId}/`;

/** Guard anti doble ejecución (p. ej. reintento manual + resume automático). */
const ingesting = new Set<string>();

// ---------------------------------------------------------------------------
// Chunker prosa-consciente (puro, exportado para test)
// ---------------------------------------------------------------------------

/**
 * Trocea respetando párrafos: acumula párrafos hasta ~CHUNK_TARGET_CHARS y
 * arrastra un solape de cola entre chunks consecutivos (la continuidad ayuda
 * al retrieval en narrativa). Un párrafo gigante (transcripciones, prosa sin
 * saltos) se parte por frases.
 */
export function chunkProse(text: string): IngestChunk[] {
  const target = CHUNK_TARGET_CHARS;
  const overlapChars = Math.round(target * CHUNK_OVERLAP_FRACTION);

  const paragraphs: { text: string; offset: number }[] = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]*)*/g; // bloques separados por línea(s) en blanco
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = m[0].trim();
    if (t) paragraphs.push({ text: t, offset: m.index });
  }

  // Párrafos más largos que 1.5× el objetivo se subdividen por frases.
  const units: { text: string; offset: number }[] = [];
  for (const p of paragraphs) {
    if (p.text.length <= target * 1.5) {
      units.push(p);
      continue;
    }
    const sentences = p.text.match(/[^.!?…]+[.!?…]+["»)]?\s*|[^.!?…]+$/g) ?? [p.text];
    let buf = '';
    let bufStart = p.offset;
    let consumed = 0;
    for (const s of sentences) {
      if (buf.length + s.length > target && buf.trim()) {
        units.push({ text: buf.trim(), offset: bufStart });
        bufStart = p.offset + consumed;
        buf = '';
      }
      buf += s;
      consumed += s.length;
    }
    if (buf.trim()) units.push({ text: buf.trim(), offset: bufStart });
  }

  const chunks: IngestChunk[] = [];
  let current = '';
  let currentOffset = 0;
  const push = () => {
    const t = current.trim();
    if (t) chunks.push({ i: chunks.length, text: t, offset: currentOffset });
  };
  for (const u of units) {
    if (!current) {
      current = u.text;
      currentOffset = u.offset;
      continue;
    }
    if (current.length + u.text.length + 2 > target) {
      push();
      // Solape: cola del chunk anterior como cabeza del siguiente.
      const tail = current.slice(-overlapChars);
      current = `${tail}\n\n${u.text}`;
      currentOffset = u.offset;
    } else {
      current = `${current}\n\n${u.text}`;
    }
  }
  push();
  return chunks;
}

// ---------------------------------------------------------------------------
// Helpers binarios (Float32Array ⇄ base64, troceado para no reventar btoa)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return globalThis.btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function writeEmbeddings(docId: string, vectors: Float32Array): Promise<void> {
  const bytes = new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength);
  await FileSystem.writeAsStringAsync(`${libraryDocDir(docId)}embeddings.bin`, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function readEmbeddings(docId: string): Promise<Float32Array | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(`${libraryDocDir(docId)}embeddings.bin`, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToBytes(b64);
    return new Float32Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 4));
  } catch {
    return null;
  }
}

export async function readChunks(docId: string): Promise<IngestChunk[] | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(`${libraryDocDir(docId)}chunks.json`);
    return JSON.parse(raw) as IngestChunk[];
  } catch {
    return null;
  }
}

export async function readDocText(docId: string): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(`${libraryDocDir(docId)}text.txt`);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Alta + máquina de estados
// ---------------------------------------------------------------------------

export function detectKind(fileName: string): LibraryDocKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  if (lower.endsWith('.pdf')) return 'pdf';
  return null;
}

/**
 * Registra el documento y deja una copia estable de la fuente (el URI que da
 * el picker apunta a caché volátil). Devuelve el id, con la ingesta ya lanzada
 * en background.
 */
export async function addLibraryDocument(params: {
  apiKey: string;
  pickerUri: string;
  fileName: string;
}): Promise<{ ok: true; docId: string } | { ok: false; error: string }> {
  const kind = detectKind(params.fileName);
  if (!kind) return { ok: false, error: 'Formato no soportado (txt, md, pdf).' };

  const docId = Crypto.randomUUID();
  const dir = libraryDocDir(docId);
  try {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.copyAsync({ from: params.pickerUri, to: `${dir}source.${kind}` });
  } catch (e) {
    return { ok: false, error: `No se pudo copiar el archivo: ${e instanceof Error ? e.message : e}` };
  }

  const title = params.fileName.replace(/\.(txt|md|markdown|pdf)$/i, '').trim() || params.fileName;
  useLibraryStore.getState().addDoc({
    id: docId,
    title,
    sourceName: params.fileName,
    kind,
    createdAt: new Date().toISOString(),
  });

  void runIngestion(docId, params.apiKey);
  return { ok: true, docId };
}

/** Reanuda ingestas que quedaron a medias (arranque de la pantalla Biblioteca). */
export function resumeUnfinishedIngestions(apiKey: string): void {
  for (const d of useLibraryStore.getState().docs) {
    if (d.status !== 'listo' && d.status !== 'error') {
      void runIngestion(d.id, apiKey);
    }
  }
}

export async function runIngestion(docId: string, apiKey: string): Promise<void> {
  if (ingesting.has(docId)) return;
  ingesting.add(docId);
  const patch = (p: Partial<Omit<LibraryDoc, 'id'>>) => useLibraryStore.getState().patchDoc(docId, p);

  try {
    let doc = useLibraryStore.getState().docs.find((d) => d.id === docId);
    if (!doc) return;

    // Reintento tras error: reanudar desde la última fase con artefacto persistido,
    // NO desde cero — los embeddings ya calculados están pagados y no se repiten.
    if (doc.status === 'error') {
      if (doc.nChunks > 0) {
        patch({ status: 'embebiendo', errorMessage: null });
      } else if (doc.chars > 0) {
        patch({ status: 'troceando', errorMessage: null });
      } else {
        patch({ status: 'pendiente', errorMessage: null });
      }
      doc = useLibraryStore.getState().docs.find((d) => d.id === docId);
      if (!doc) return;
    }

    // ---- Fase 1: extracción --------------------------------------------------
    if (doc.status === 'pendiente' || doc.status === 'extrayendo') {
      patch({ status: 'extrayendo', errorMessage: null });

      let text: string;
      if (doc.kind === 'pdf') {
        // Gemini multimodal transcribe el PDF: una vez, en la ingesta. Los turnos
        // del paseo no pagan nada de esto.
        const ext = await extractPdfText({
          apiKey,
          fileUri: `${libraryDocDir(docId)}source.pdf`,
        });
        if (!ext.ok) {
          patch({ status: 'error', errorMessage: ext.error });
          return;
        }
        text = ext.text;
      } else {
        try {
          text = await FileSystem.readAsStringAsync(`${libraryDocDir(docId)}source.${doc.kind}`);
        } catch (e) {
          patch({ status: 'error', errorMessage: `No se pudo leer la fuente: ${e instanceof Error ? e.message : e}` });
          return;
        }
      }
      text = text.replace(/\r\n/g, '\n').trim();
      if (!text) {
        patch({ status: 'error', errorMessage: 'El archivo está vacío.' });
        return;
      }
      if (text.length > MAX_DOC_TEXT_CHARS) {
        patch({ status: 'error', errorMessage: `Documento demasiado grande (>${Math.round(MAX_DOC_TEXT_CHARS / 1_000_000)} M caracteres).` });
        return;
      }
      await FileSystem.writeAsStringAsync(`${libraryDocDir(docId)}text.txt`, text);
      patch({ status: 'troceando', chars: text.length });
    }

    // ---- Fase 2: chunking ------------------------------------------------------
    doc = useLibraryStore.getState().docs.find((d) => d.id === docId);
    if (!doc) return;
    if (doc.status === 'troceando') {
      const text = await readDocText(docId);
      if (text === null) {
        patch({ status: 'error', errorMessage: 'Texto extraído no encontrado.' });
        return;
      }
      // Documento pequeño → inyección completa, sin chunks ni embeddings: LISTO.
      if (text.length <= FULL_INJECT_MAX_CHARS) {
        patch({ status: 'listo', nChunks: 0, embeddedChunks: 0 });
        return;
      }
      const chunks = chunkProse(text);
      await FileSystem.writeAsStringAsync(`${libraryDocDir(docId)}chunks.json`, JSON.stringify(chunks));
      patch({ status: 'embebiendo', nChunks: chunks.length, embeddedChunks: 0 });
    }

    // ---- Fase 3: embeddings (reanudable por lote) -------------------------------
    doc = useLibraryStore.getState().docs.find((d) => d.id === docId);
    if (!doc || doc.status !== 'embebiendo') return;

    const chunks = await readChunks(docId);
    if (!chunks) {
      patch({ status: 'error', errorMessage: 'chunks.json no encontrado.' });
      return;
    }

    // Retomar embeddings previos si los hay (app muerta a mitad).
    const all = new Float32Array(chunks.length * EMBEDDING_DIMENSIONS);
    let done = 0;
    if (doc.embeddedChunks > 0) {
      const prev = await readEmbeddings(docId);
      const usable = prev ? Math.min(doc.embeddedChunks, Math.floor(prev.length / EMBEDDING_DIMENSIONS)) : 0;
      if (prev && usable > 0) {
        all.set(prev.subarray(0, usable * EMBEDDING_DIMENSIONS));
        done = usable;
      }
    }

    while (done < chunks.length) {
      const batch = chunks.slice(done, done + EMBEDDING_BATCH_SIZE);
      const res = await embedDocumentChunks(apiKey, batch.map((c) => c.text));
      if (!res.ok) {
        // El progreso queda persistido: el reintento continúa desde `done`.
        patch({ status: 'error', errorMessage: `Embeddings (chunk ${done}/${chunks.length}): ${res.error}` });
        return;
      }
      for (let j = 0; j < res.vectors.length; j++) {
        all.set(res.vectors[j], (done + j) * EMBEDDING_DIMENSIONS);
      }
      done += batch.length;
      await writeEmbeddings(docId, all.subarray(0, done * EMBEDDING_DIMENSIONS) as Float32Array);
      patch({ embeddedChunks: done });
    }

    patch({ status: 'listo' });
  } finally {
    ingesting.delete(docId);
  }
}

/** Borra el documento: archivos y metadatos. */
export async function deleteLibraryDocument(docId: string): Promise<void> {
  useLibraryStore.getState().removeDoc(docId);
  try {
    await FileSystem.deleteAsync(libraryDocDir(docId), { idempotent: true });
  } catch {
    /* los huérfanos en disco no rompen nada; se limpiarían en re-instalación */
  }
}
