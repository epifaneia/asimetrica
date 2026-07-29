import { generateContent } from './geminiClient';
import { GEMINI_MODELS } from './geminiModels';

/**
 * Recap de espera activa: confirma que te ha escuchado bien MIENTRAS el analista
 * (Pro, thinking HIGH) sigue pensando. No es un paso del pipeline: corre en
 * paralelo y su resultado no alimenta a nadie más.
 *
 * Dos bloques, por orden de valor de aborto:
 *   - ANCLAS: términos literales del texto (nombres, cifras, tecnicismos). Es lo
 *     que de verdad verifica el STT.
 *   - BULLETS: las ideas que has dicho, para re-anclarte tras 3 minutos hablando.
 *
 * Regla crítica — EXTRACTIVO, NO ABSTRACTIVO. Si el modelo te parafrasea bonito,
 * te sonará bien aunque el STT se comiera un nombre propio, y el recap te daría
 * FALSA TRANQUILIDAD justo donde querías verdad. Por eso las anclas se piden
 * literales y sin corregir.
 */

const RECAP_SYSTEM = `Eres un confirmador de escucha. Recibes la transcripción de alguien que ha hablado en voz alta y devuelves una confirmación de lo que ha dicho. NO respondes al contenido, no opinas, no añades ideas nuevas, no saludas, no haces preguntas.

Formato de salida EXACTO, sin markdown ni asteriscos:

ANCLAS: term1 | term2 | term3
- idea uno
- idea dos
- idea tres

Reglas:
- ANCLAS: entre 3 y 6 términos COPIADOS LITERALMENTE de la transcripción (nombres propios, cifras, tecnicismos, palabras raras). NO los corrijas, NO los normalices, NO los traduzcas: sirven para que el hablante detecte fallos de transcripción. Si la transcripción dice algo raro, cópialo raro.
- BULLETS: entre 3 y 7 líneas que empiecen por "- ", cada una una idea que el hablante haya dicho, usando SUS palabras siempre que puedas. Frases cortas y orales (las va a leer un motor de voz).
- No inventes nada que no esté en la transcripción.
- Usa el mismo idioma que la transcripción.`;

export type RecapResult =
  | { ok: true; anchors: string[]; bullets: string[] }
  | { ok: false; error: string };

export async function generateRecap(params: {
  apiKey: string;
  text: string;
}): Promise<RecapResult> {
  const { apiKey, text } = params;
  const raw = text.trim();
  if (!raw) return { ok: false, error: 'Texto vacío.' };
  if (!apiKey.trim()) return { ok: false, error: 'Falta Google API Key.' };

  const res = await generateContent({
    apiKey,
    modelId: GEMINI_MODELS.recap,
    systemInstruction: RECAP_SYSTEM,
    contents: [{ role: 'user', parts: [{ text: raw }] }],
    temperature: 0.2,
    maxOutputTokens: 1024,
    thinkingLevel: 'MINIMAL',
    stage: 'recap',
    // Corre contra el reloj del analista: si tarda más que él, ya no sirve.
    timeoutMs: 20_000,
    maxRetries: 0,
  });

  if (!res.ok) return { ok: false, error: res.error };

  const parsed = parseRecap(res.text);
  if (!parsed.anchors.length && !parsed.bullets.length) {
    return { ok: false, error: 'Recap vacío o no parseable.' };
  }
  return { ok: true, ...parsed };
}

/**
 * Parseo tolerante: si el modelo se sale del formato, preferimos degradar a
 * "algo que leer" antes que romper la espera activa. Un recap imperfecto vale
 * más que un silencio de 60 segundos.
 */
function parseRecap(text: string): { anchors: string[]; bullets: string[] } {
  const anchors: string[] = [];
  const bullets: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/[*_`]/g, '').trim();
    if (!line) continue;

    const anchorMatch = line.match(/^ANCLAS\s*:\s*(.+)$/i);
    if (anchorMatch) {
      for (const a of anchorMatch[1].split(/[|,;]/)) {
        const t = a.trim();
        if (t) anchors.push(t);
      }
      continue;
    }

    const bulletMatch = line.match(/^[-•–]\s*(.+)$/);
    if (bulletMatch) {
      const t = bulletMatch[1].trim();
      if (t) bullets.push(t);
      continue;
    }
  }

  // Fallback: ni anclas ni viñetas reconocidas → usar las frases sueltas.
  if (!anchors.length && !bullets.length) {
    for (const line of text.split('\n')) {
      const t = line.replace(/[*_`]/g, '').trim();
      if (t && !/^ANCLAS/i.test(t)) bullets.push(t);
    }
  }

  return { anchors: anchors.slice(0, 6), bullets: bullets.slice(0, 7) };
}
