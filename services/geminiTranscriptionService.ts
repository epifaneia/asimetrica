import { fileToBase64, generateContent } from './geminiClient';
import { GEMINI_MODELS } from './geminiModels';

/**
 * STT vía Gemini multimodal: audio (.m4a / AAC en MP4) → texto literal.
 * El audio se envía inline en base64; los m4a típicos del recorder (16 kHz mono, 64 kbps,
 * < 1 MB por minuto) caben de sobra en el límite inline (20 MB).
 */

const STT_INSTRUCTION = `Transcribe el audio en español. Devuelve únicamente la transcripción literal, sin comentarios, sin etiquetas de hablante, sin marcas de tiempo. No corrijas muletillas ni reordenes frases (de eso se encarga el siguiente paso). Si no hay voz audible, responde con la cadena vacía.`;

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function transcribeAudioWithGemini(params: {
  apiKey: string;
  fileUri: string;
  modelId?: string;
}): Promise<TranscribeResult> {
  const { apiKey, fileUri, modelId = GEMINI_MODELS.stt } = params;
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
    systemInstruction: STT_INSTRUCTION,
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
    stage: 'transcribe-stt',
  });

  if (!result.ok) return result;
  const text = result.text.trim();
  if (!text) {
    return { ok: false, error: 'Transcripción vacía.' };
  }
  return { ok: true, text };
}
