import type { ChatTurn } from './aiService';
import { generateContent, type GeminiTurn } from './geminiClient';
import { GEMINI_MODELS } from './geminiModels';

/**
 * Generador de título contextual para una conversación cerrada.
 * Modelo Flash Lite, MINIMAL thinking — taxonomía pura, no análisis. Coste despreciable.
 */

const TITLE_SYSTEM = `Tu única tarea: leer la conversación y devolver un título corto en español, de entre 3 y 7 palabras, que capture la tesis o tema central.
Devuelve solo el título. Sin comillas, sin punto final, sin prefijos. No expliques nada.`;

function historyToContents(history: ChatTurn[]): GeminiTurn[] {
  // Aplanamos a un solo bloque user para evitar lidiar con alternancia en una llamada de taxonomía.
  const dialogue = history
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'IA'}: ${m.content.trim()}`)
    .join('\n\n');
  if (!dialogue) {
    return [{ role: 'user', parts: [{ text: '(sin contenido)' }] }];
  }
  return [{ role: 'user', parts: [{ text: dialogue }] }];
}

export async function generateDissertationTitle(params: {
  apiKey: string;
  history: ChatTurn[];
}): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const { apiKey, history } = params;
  if (!apiKey.trim()) return { ok: false, error: 'Falta Google API Key.' };

  const result = await generateContent({
    apiKey,
    modelId: GEMINI_MODELS.sanitize, // Flash Lite es suficiente: trabajo de taxonomía, no análisis.
    systemInstruction: TITLE_SYSTEM,
    contents: historyToContents(history),
    temperature: 0.3,
    // Budget generoso: en Gemini 3, los thinking tokens también descuentan de
    // maxOutputTokens. Si lo dejamos tight (~64) el modelo puede agotarse antes
    // de emitir el título visible. 1024 tokens deja holgura sin penalizar coste.
    maxOutputTokens: 1024,
    // Sin thinkingLevel: para titulación no aporta y arriesga consumir budget.
    stage: 'title-gen',
  });

  if (!result.ok) return result;

  // Saneo defensivo + tolerante: nos quedamos con la primera línea no vacía y le
  // quitamos comillas/puntuación final. Si el modelo se desvía y devuelve un
  // párrafo, cogemos lo que parezca el título y seguimos.
  const firstNonEmptyLine =
    result.text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  let title = firstNonEmptyLine;
  title = title.replace(/^["'«»]+|["'«»]+$/g, '').trim();
  title = title.replace(/^(t[íi]tulo|tema)\s*[:\-—]\s*/i, '').trim();
  title = title.replace(/[.!?]+$/g, '').trim();
  if (title.length > 100) title = title.slice(0, 100);
  if (!title) return { ok: false, error: 'Título vacío.' };
  return { ok: true, title };
}
