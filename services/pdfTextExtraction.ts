import * as FileSystem from 'expo-file-system/legacy';

import { generateContent, fileToBase64 } from './geminiClient';
import { GEMINI_MODELS } from './geminiModels';

/**
 * Extracción de texto de PDF con Gemini multimodal (misma clave BYOK).
 *
 * En el móvil no hay una librería decente de parseo de PDF, y el propio modelo lo
 * hace bien. Ocurre UNA vez por documento, en la ingesta; los turnos del paseo no
 * pagan nada de esto.
 *
 * AVISO al autor (lo da la pantalla de Biblioteca): solo viaja el TEXTO. Mapas,
 * tablas complejas e ilustraciones se pierden — para un PDF rico en imágenes esto
 * puede dejar fuera lo importante.
 *
 * Troceado por páginas: un PDF largo no cabe en una respuesta, así que se pide en
 * tramos y se cose. `inlineData` aguanta bien PDFs de tamaño razonable; por encima
 * de ~15 MB haría falta la Files API, y eso se avisa en vez de fallar en silencio.
 */

const EXTRACT_SYSTEM = `Extraes el texto de un documento PDF. Devuelves ÚNICAMENTE el texto, tal como está.

Reglas:
- No resumas, no reescribas, no corrijas, no comentes. Transcripción fiel.
- Conserva los saltos de párrafo. Une las palabras cortadas por guion al final de línea.
- Omite encabezados y pies repetidos en cada página, y los números de página sueltos.
- Si una página es una imagen sin texto legible, escribe una sola línea: [página sin texto]
- No añadas marcadores, ni títulos, ni numeración que no esté en el original.`;

/** Por encima de esto, inlineData deja de ser razonable y hay que avisar. */
const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** Páginas por llamada: tramos cortos para no topar con el límite de salida. */
const PAGES_PER_CALL = 12;
/**
 * El PDF viaja COMPLETO en cada tramo (inlineData), así que un documento gordo
 * troceado en muchas llamadas se convierte en cientos de MB de subida. Este techo
 * lo corta con un mensaje claro en vez de dejar al usuario esperando y gastando
 * datos. (La solución fina sería la Files API: subir una vez y referenciar por
 * URI en cada llamada. Queda como mejora aislada.)
 */
const MAX_TOTAL_UPLOAD_BYTES = 40 * 1024 * 1024;
/** Tope de tramos por si el recuento de páginas se va arriba. */
const MAX_RANGES = 40;

export type PdfExtractResult =
  | { ok: true; text: string; pages: number }
  | { ok: false; error: string };

/**
 * Cuántas páginas tiene el PDF, leyendo la cabecera del propio archivo. Barato y
 * sin red; si no se puede determinar, se procesa como un solo tramo.
 */
function countPagesFromBase64(base64: string): number | null {
  try {
    const bin = globalThis.atob(base64);
    // Dos pistas independientes, porque ninguna es fiable sola: `/Type /Page`
    // desaparece si el PDF comprime los objetos en streams, y `/Count` también
    // aparece en el árbol de marcadores. Verificado contra PDFs reales: cuando
    // ambas existen coinciden exactamente. Se toma la mayor, y el bucle de
    // extracción para en cuanto un tramo vuelve vacío, así que pasarse no cuesta.
    const typePage = (bin.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    let maxCount = 0;
    for (const m of bin.matchAll(/\/Count\s+(\d+)/g)) {
      maxCount = Math.max(maxCount, Number(m[1]));
    }
    const n = Math.max(typePage, maxCount);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Un tramo que solo trae marcadores de página vacía = ya pasamos del final. */
function isEmptyRange(text: string): boolean {
  const clean = text
    .replace(/\[página sin texto\]/gi, '')
    .replace(/\s+/g, '')
    .trim();
  return clean.length === 0;
}

export async function extractPdfText(params: {
  apiKey: string;
  fileUri: string;
  /** Progreso por tramos, para la barra de la pantalla de Biblioteca. */
  onProgress?: (done: number, total: number) => void;
}): Promise<PdfExtractResult> {
  const { apiKey, fileUri, onProgress } = params;
  if (!apiKey.trim()) return { ok: false, error: 'Falta Google API Key.' };

  const info = await FileSystem.getInfoAsync(fileUri).catch(() => null);
  if (!info?.exists) return { ok: false, error: 'El PDF no está donde debería.' };
  if ((info.size ?? 0) > MAX_PDF_BYTES) {
    return {
      ok: false,
      error: `El PDF pesa ${Math.round((info.size ?? 0) / 1e6)} MB; el límite es ${MAX_PDF_BYTES / 1e6} MB. Divídelo o pásalo a texto.`,
    };
  }

  let base64: string;
  try {
    base64 = await fileToBase64(fileUri);
  } catch (e) {
    return { ok: false, error: `No se pudo leer el PDF: ${e instanceof Error ? e.message : e}` };
  }

  const pages = countPagesFromBase64(base64);
  const size = info.size ?? 0;

  // Documento corto y con recuento fiable: una sola llamada y listo.
  const singleCall = pages !== null && pages <= PAGES_PER_CALL;
  if (!singleCall) {
    // Sin recuento fiable se trocea igualmente y se para al llegar al final: es lo
    // que evita el fallo peligroso (un PDF con objetos comprimidos daría 0 páginas
    // y se truncaría en silencio a 8192 tokens de una única llamada).
    const estimatedRanges = pages ? Math.ceil(pages / PAGES_PER_CALL) : 4;
    if (size * estimatedRanges > MAX_TOTAL_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `Este PDF (${Math.round(size / 1e6)} MB${pages ? `, ${pages} págs.` : ''}) habría que subirlo ${estimatedRanges} veces para trocearlo. Divídelo o pásalo a texto.`,
      };
    }
  }

  const parts: string[] = [];
  const totalRanges = singleCall ? 1 : pages ? Math.ceil(pages / PAGES_PER_CALL) : MAX_RANGES;

  for (let i = 0; i < Math.min(totalRanges, MAX_RANGES); i++) {
    const from = i * PAGES_PER_CALL + 1;
    const to = from + PAGES_PER_CALL - 1;
    const instruction = singleCall
      ? 'Extrae el texto de TODO el documento.'
      : `Extrae el texto ÚNICAMENTE de las páginas ${from} a ${to}, ambas incluidas. Ignora el resto del documento por completo. Si el documento se acaba antes de la página ${from}, responde con la cadena vacía.`;

    const res = await generateContent({
      apiKey,
      modelId: GEMINI_MODELS.stt, // Flash Lite: multimodal, barato y de sobra para transcribir
      systemInstruction: EXTRACT_SYSTEM,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64 } },
            { text: instruction },
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: 8192,
      thinkingLevel: 'MINIMAL',
      stage: 'pdf-extract',
      timeoutMs: 180_000,
      maxRetries: 1,
    });
    if (!res.ok) {
      // Con varios tramos ya cosidos, quedarse con lo conseguido es mejor que
      // perderlo todo por un fallo de red en la página 40.
      if (parts.length > 0) break;
      return { ok: false, error: `Páginas ${from}-${to}: ${res.error}` };
    }

    const chunk = res.text.trim();
    if (isEmptyRange(chunk)) break; // pasamos del final del documento
    parts.push(chunk);
    onProgress?.(i + 1, Math.min(totalRanges, MAX_RANGES));
  }

  const text = parts.filter(Boolean).join('\n\n').trim();
  if (!text) return { ok: false, error: 'No se extrajo texto (¿PDF de imágenes escaneadas?).' };
  return { ok: true, text, pages: pages ?? 0 };
}
