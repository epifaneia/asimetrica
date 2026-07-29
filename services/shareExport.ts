import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type { Dissertation } from '@/stores/folders-store';

import { generateContent } from './geminiClient';
import { GEMINI_MODELS } from './geminiModels';

/**
 * Compartir por la hoja del sistema: Drive, NotebookLM, WhatsApp, Gmail,
 * Obsidian… lo que el usuario tenga instalado.
 *
 * Sin OAuth, sin consola de Google, sin verificación, sin cuotas y sin políticas
 * que puedan romperlo. Lo único que no puede hacer (y por eso el auto-export a
 * Drive sigue existiendo) es subir SOLO, sin que toques el móvil.
 *
 * FORMATO: `.txt` con estructura TIPOGRÁFICA, no markdown. El markdown es
 * sintaxis para máquinas y en WhatsApp o Gmail se lee como basura (`## Tesis`,
 * `**esto**`); y no hace falta, porque NotebookLM y cualquier LLM entienden
 * igual de bien una estructura hecha con mayúsculas y sangrías. Un solo formato
 * sirve para las dos audiencias, y `.txt` lo abre cualquier cosa.
 *
 * Convenciones: encabezados en MAYÚSCULAS, una línea de separación, atribución
 * con guion largo (`TÚ —` / `AUDITAR —`) y viñetas con `-`.
 */

const RULE = '─'.repeat(36);

function formatDate(iso: string): string {
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Quita sintaxis markdown que el modelo pueda colar pese a la instrucción. */
export function stripMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // encabezados ATX
        .replace(/\*\*(.+?)\*\*/g, '$1') // negrita
        .replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*(?=\s|$)/g, '$1$2') // cursiva con *
        .replace(/(^|\s)_(?!\s)(.+?)(?<!\s)_(?=\s|$)/g, '$1$2') // cursiva con _
        .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // código
        .replace(/^\s{0,3}[*+]\s+/, '- ') // viñetas * o + → -
        .replace(/^\s{0,3}>\s?/, '') // citas
        .trimEnd()
    )
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function header(title: string, dateIso: string, profileName?: string): string {
  const bits = ['Asimétrica', formatDate(dateIso)];
  if (profileName) bits.push(profileName);
  return `${title.trim() || 'Sin título'}\n${bits.filter(Boolean).join(' · ')}\n${RULE}\n`;
}

/** Transcripción TAL CUAL: los turnos en orden, con autoría visible. */
export function buildPlainTranscript(doc: Dissertation, profileName?: string): string {
  const speaker = (profileName ?? 'Interlocutor').toUpperCase();
  const turns = doc.messages.length
    ? doc.messages
    : doc.body.trim()
      ? [{ role: 'user' as const, content: doc.body }]
      : [];

  const body = turns
    .map((m) => `${m.role === 'user' ? 'TÚ' : speaker} —\n\n${m.content.trim()}`)
    .join('\n\n\n');

  return `${header(doc.title, doc.updatedAt, profileName)}\n${body || 'Sin contenido.'}\n`;
}

/** Varias disertaciones seguidas (carpeta / biblioteca). */
export function buildPlainCollection(
  collectionName: string,
  docs: Dissertation[],
  profileNameFor?: (doc: Dissertation) => string | undefined
): string {
  const head = `${collectionName.trim() || 'Colección'}\nAsimétrica · ${formatDate(
    new Date().toISOString()
  )} · ${docs.length} conversacion${docs.length === 1 ? '' : 'es'}\n${RULE}\n`;
  const parts = docs.map((d) => {
    const t = buildPlainTranscript(d, profileNameFor?.(d));
    return t.trim();
  });
  return `${head}\n${parts.join(`\n\n\n${RULE}\n\n`)}\n`;
}

// ---------------------------------------------------------------------------
// Reestructurado
// ---------------------------------------------------------------------------

/**
 * Una transcripción cruda es una fuente MALA para NotebookLM: va llena de
 * muletillas orales y del ir y venir de los turnos. Esto la convierte en un
 * documento organizado por temas.
 *
 * Regla intocable: la AUTORÍA NO SE FUNDE. Si el resumen mezcla tus ideas con
 * las del interlocutor en un texto limpio, dentro de seis meses no sabrás qué
 * pensaste tú y qué te sugirió la máquina — y en una herramienta para pensar eso
 * es grave, sobre todo si el destino es NotebookLM y luego preguntas sobre "tus"
 * fuentes.
 */
const RESTRUCTURE_SYSTEM = `Reorganizas la transcripción de una disertación hablada en un documento legible. NO eres un interlocutor: no opinas, no añades ideas, no respondes a nada.

Formato de salida EXACTO, en texto plano. PROHIBIDO markdown: sin almohadillas, sin asteriscos, sin comillas invertidas, sin negritas. Los encabezados van en MAYÚSCULAS.

TESIS

(2-4 frases: la idea central que sostiene el autor, con SUS palabras siempre que puedas.)

TEMAS

1. (Nombre del tema)

TÚ —

(lo que aportó el autor sobre este tema)

INTERLOCUTOR —

(lo que aportó la IA: objeción, ramificación, matiz)

2. (siguiente tema)

...

PREGUNTAS ABIERTAS

- (cuestiones que quedaron sin resolver)

HILOS SIN CERRAR

- (ideas que se apuntaron y no se desarrollaron)

Reglas estrictas:
- Organiza por TEMAS, no por orden cronológico de los turnos: agrupa lo que se dijo del mismo asunto aunque estuviera desperdigado.
- LA AUTORÍA NUNCA SE FUNDE. Lo que dijo el autor va bajo "TÚ —" y lo que dijo la IA bajo "INTERLOCUTOR —". Jamás atribuyas al autor algo que dijo la IA, ni al revés.
- Limpia muletillas y repeticiones de la oralidad, pero conserva el vocabulario y las expresiones propias del autor.
- No inventes contenido que no esté en la transcripción. Si una sección se queda vacía, omítela.
- Usa el mismo idioma que la transcripción.`;

export type RestructureResult = { ok: true; text: string } | { ok: false; error: string };

export async function restructureDissertation(params: {
  apiKey: string;
  doc: Dissertation;
  profileName?: string;
}): Promise<RestructureResult> {
  const { apiKey, doc, profileName } = params;
  const transcript = buildPlainTranscript(doc, profileName);
  if (!transcript.trim()) return { ok: false, error: 'La conversación está vacía.' };

  const res = await generateContent({
    apiKey,
    modelId: GEMINI_MODELS.interlocutor,
    systemInstruction: RESTRUCTURE_SYSTEM,
    contents: [{ role: 'user', parts: [{ text: transcript }] }],
    temperature: 0.3,
    maxOutputTokens: 8192,
    thinkingLevel: 'LOW',
    stage: 'restructure',
  });
  if (!res.ok) return { ok: false, error: res.error };

  const body = stripMarkdown(res.text);
  if (!body) return { ok: false, error: 'El reestructurado salió vacío.' };
  return { ok: true, text: `${header(doc.title, doc.updatedAt, profileName)}\n${body}\n` };
}

// ---------------------------------------------------------------------------
// Compartir
// ---------------------------------------------------------------------------

/** Nombre de archivo seguro para cualquier sistema de ficheros / app receptora. */
function safeFileName(title: string): string {
  const base = title
    // NFD separa la tilde de la vocal, y el filtro de abajo se lleva la tilde
    // suelta: «Disertación» → «Disertacion» en vez de «Disertacin».
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return base || 'asimetrica';
}

export type ShareResult = { ok: true } | { ok: false; error: string };

/** Escribe el .txt en cache y abre la hoja de compartir del sistema. */
export async function shareAsTextFile(title: string, content: string): Promise<ShareResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'Este dispositivo no permite compartir.' };
    }
    const uri = `${FileSystem.cacheDirectory ?? ''}${safeFileName(title)}.txt`;
    await FileSystem.writeAsStringAsync(uri, content);
    await Sharing.shareAsync(uri, {
      mimeType: 'text/plain',
      dialogTitle: title,
      UTI: 'public.plain-text',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
