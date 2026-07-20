import { fileToBase64, generateContent } from './geminiClient';
import { GEMINI_MODELS } from './geminiModels';

/**
 * STT vía Gemini multimodal: audio (.m4a / AAC en MP4) → texto literal.
 * El audio se envía inline en base64; los m4a típicos del recorder (16 kHz mono, 64 kbps,
 * < 1 MB por minuto) caben de sobra en el límite inline (20 MB).
 */

const STT_INSTRUCTION = `Transcribe el audio en español. Devuelve únicamente la transcripción literal, sin comentarios, sin etiquetas de hablante, sin marcas de tiempo. No corrijas muletillas ni reordenes frases (de eso se encarga el siguiente paso). Si no hay voz audible, responde con la cadena vacía.`;

/** Modo rápido: transcripción + sanitizado en UNA llamada (ahorra una ida y vuelta completa). */
const STT_CLEAN_INSTRUCTION = `Transcribe el audio en español y devuelve el texto YA LIMPIO, en un solo paso:
- Corrige errores típicos de transcripción de voz.
- Elimina muletillas y repeticiones vacías (eh, mmh, o sea repetido, vale vale…) sin borrar dudas o matiz intencional.
- Arregla gramática y puntuación mínima para que sea legible.
Reglas estrictas: no cambies el significado, la intención ni el tono emocional; no respondas al contenido, no opines, no amplíes ideas. Devuelve únicamente el texto limpio, sin comentarios, sin etiquetas de hablante, sin marcas de tiempo. Si no hay voz audible, responde con la cadena vacía.`;

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function transcribeAudioWithGemini(params: {
  apiKey: string;
  fileUri: string;
  modelId?: string;
  /** true → la transcripción llega ya sanitizada (el pipeline puede saltarse el stage 1). */
  sanitize?: boolean;
}): Promise<TranscribeResult> {
  const { apiKey, fileUri, modelId = GEMINI_MODELS.stt, sanitize = false } = params;
  if (!fileUri) {
    return { ok: false, error: 'URI de audio inválida.' };
  }

  let base64: string;
  try {
    base64 = await fileToBase64(fileUri);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const result = await generateContent({
    apiKey,
    modelId,
    systemInstruction: sanitize ? STT_CLEAN_INSTRUCTION : STT_INSTRUCTION,
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Transcribe este audio.' },
          { inlineData: { mimeType: 'audio/mp4', data: base64 } },
        ],
      },
    ],
    temperature: 0,
    maxOutputTokens: 4096,
    thinkingLevel: 'MINIMAL',
    stage: sanitize ? 'transcribe-clean' : 'transcribe-stt',
  });

  if (!result.ok) return result;
  const text = result.text.trim();
  if (!text) {
    return { ok: false, error: 'Transcripción vacía.' };
  }
  return { ok: true, text };
}
