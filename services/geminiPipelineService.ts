import { getSystemPromptForProfile } from '@/constants/ai-profile-prompts';
import type { AiProfileId } from '@/lib/conversador-profile';

import type { ChatTurn } from './aiService';
import { generateContent, type GeminiTurn } from './geminiClient';
import { GEMINI_MODELS, GEMINI_THINKING } from './geminiModels';

/**
 * Pipeline de disertación en Gemini con tier por stage:
 *
 *   1 Sanitiza   · Flash Lite, MINIMAL  · limpieza plana de transcripción.
 *   2 Analiza    · Pro,        HIGH     · análisis cognitivo profundo (consumo interno, markdown).
 *   3 Interlocutor · Flash,    LOW      · convierte el análisis en monólogo hablado para TTS.
 *
 *   4 Corto (finale) · Pro,    MEDIUM   · latido final del perfil cuando el usuario cierra sesión.
 */

export type GeminiPipelineStage = 'sanitize' | 'analyze' | 'interlocutor';

const SANITIZER_SYSTEM = `Eres un sanitizador de texto dictado o transcrito. Tu única tarea:
- Corregir errores típicos de transcripción de voz y de teclado.
- Eliminar muletillas y repeticiones vacías (eh, mmh, o sea repetido, vale vale…) sin borrar dudas o matiz intencional.
- Arreglar gramática y puntuación mínima para que sea legible.
Reglas estrictas:
- No cambies el significado, la intención ni el tono emocional.
- No respondas al contenido, no opines, no amplíes ideas, no hagas preguntas al usuario.
- Devuelve solo el texto limpio, sin comentarios ni prefijos.`;

const ANALYST_LAYER = `Arriba va tu identidad de perfil cognitivo. Tu salida en ESTE paso es solo para consumo interno (pasará a otra capa).
Produce un análisis estructurado y profundo en español. Puedes usar markdown con encabezados y listas para organizar el pensamiento.
Sé extenso donde aporte valor: matices, riesgos, supuestos, contraargumentos, implicaciones y tensiones abiertas.
No escribas el monólogo hablado final para el usuario; no te dirijas en segunda persona como si fueras la voz de la app. Enfócate en el razonamiento analítico.`;

/** Inyectado al final del system del interlocutor (salida oral / TTS). */
export const INTERLOCUTOR_TTS_FORMAT_RULE = `IMPORTANTE: Tu respuesta será leída por un motor de texto a voz (TTS). Debes responder usando exclusivamente prosa natural y fluida. ESTÁ TERMINANTEMENTE PROHIBIDO usar listas, viñetas (bullet points), emojis, asteriscos, palabras en negrita o caracteres especiales de Markdown. Usa puntos y comas para marcar las pausas respiratorias.`;

/** Capa de cierre que transforma cualquier respuesta en un latido final del perfil. */
export const CORTO_CLOSING_LAYER = `El usuario ha pulsado «Corto»: la conversación termina ahora.
Tu tarea: una nota final breve (3 a 6 frases), fiel a tu rol cognitivo. NO hagas resumen.
NO digas "para terminar" ni "en resumen". Deja un latido final que cristalice tu rol:
- Si eres analítico/auditor: el hueco lógico que se queda abierto.
- Si eres sistémico: la conexión que enmarca lo dicho.
- Si eres creativo: una imagen o analogía que se queda.
- Si eres destilador: la tesis nuclear, en una frase.
Aplica las reglas TTS: prosa fluida, sin markdown, sin viñetas.`;

function historyToGeminiContents(history: ChatTurn[]): GeminiTurn[] {
  const out: GeminiTurn[] = [];
  for (const m of history) {
    const text = m.content.trim();
    if (!text) continue;
    out.push({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text }] });
  }
  return out;
}

/** Gemini exige alternancia user/model. Fusiona turnos `user` consecutivos en un solo bloque. */
function collapseConsecutiveUsers(turns: GeminiTurn[]): GeminiTurn[] {
  const out: GeminiTurn[] = [];
  let userBuf = '';
  const flush = () => {
    if (userBuf) {
      out.push({ role: 'user', parts: [{ text: userBuf }] });
      userBuf = '';
    }
  };
  for (const t of turns) {
    const text = (t.parts.find((p): p is { text: string } => 'text' in p))?.text ?? '';
    if (t.role === 'user') {
      userBuf = userBuf ? `${userBuf}\n\n—\n\n${text}` : text;
    } else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out;
}

export type GeminiPipelineResult =
  | { ok: true; sanitizedUser: string; analysis: string; finalReply: string }
  | { ok: false; error: string; stage: GeminiPipelineStage };

export type GeminiPipelineParams = {
  apiKey: string;
  rawUserText: string;
  history: ChatTurn[];
  profile: AiProfileId;
  /** System prompt del paso interlocutor (texto para voz). */
  interlocutorSystemPrompt: string;
  /** Si true, añade `CORTO_CLOSING_LAYER` al system del interlocutor (último turno antes de cerrar). */
  closingMode?: boolean;
  /** Notifica cada paso antes de su llamada HTTP. */
  onStage?: (stage: GeminiPipelineStage) => void;
  /** Tras sanitizar (STT listo): texto usuario ya usable en UI / historial. */
  onSanitizedUser?: (sanitizedText: string) => void;
};

export async function runGeminiDissertationPipeline(
  params: GeminiPipelineParams
): Promise<GeminiPipelineResult> {
  const {
    apiKey,
    rawUserText,
    history,
    profile,
    interlocutorSystemPrompt,
    closingMode = false,
    onStage,
    onSanitizedUser,
  } = params;

  const raw = rawUserText.trim();
  if (!raw) {
    return { ok: false, error: 'El texto del usuario está vacío.', stage: 'sanitize' };
  }
  if (!apiKey.trim()) {
    return { ok: false, error: 'Falta Google API Key.', stage: 'sanitize' };
  }

  // Stage 1 — sanitiza.
  onStage?.('sanitize');
  const s1 = await generateContent({
    apiKey,
    modelId: GEMINI_MODELS.sanitize,
    systemInstruction: SANITIZER_SYSTEM,
    contents: [{ role: 'user', parts: [{ text: raw }] }],
    temperature: 0.2,
    maxOutputTokens: 4096,
    thinkingLevel: 'MINIMAL',
    stage: 'sanitize',
  });
  if (!s1.ok) {
    return { ok: false, error: s1.error, stage: 'sanitize' };
  }
  const sanitizedUser = s1.text.trim() || raw;
  onSanitizedUser?.(sanitizedUser);

  // Stage 2 — análisis cognitivo profundo (consumo interno).
  onStage?.('analyze');
  const profileCore = getSystemPromptForProfile(profile);
  const analystSystem = `${profileCore}\n\n${ANALYST_LAYER}`;

  const analystTail = collapseConsecutiveUsers([
    ...historyToGeminiContents(history),
    {
      role: 'user',
      parts: [{ text: `Nueva aportación del usuario (ya sanitizada):\n\n${sanitizedUser}` }],
    },
  ]);

  const s2 = await generateContent({
    apiKey,
    modelId: GEMINI_MODELS.analyze,
    systemInstruction: analystSystem,
    contents: analystTail,
    temperature: 0.65,
    maxOutputTokens: 8192,
    thinkingLevel: GEMINI_THINKING.analyze,
    stage: 'analyze',
  });
  if (!s2.ok) {
    return { ok: false, error: s2.error, stage: 'analyze' };
  }
  const analysis = s2.text.trim();
  if (!analysis) {
    return { ok: false, error: 'El analista devolvió texto vacío.', stage: 'analyze' };
  }

  // Stage 3 — interlocutor: análisis denso → monólogo hablado.
  onStage?.('interlocutor');
  const interlocutorBase = interlocutorSystemPrompt.trim();
  if (!interlocutorBase) {
    return { ok: false, error: 'Falta system prompt del conversador.', stage: 'interlocutor' };
  }
  const interlocutorSystemFull = [
    interlocutorBase,
    INTERLOCUTOR_TTS_FORMAT_RULE,
    closingMode ? CORTO_CLOSING_LAYER : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const historyWithNewUser: ChatTurn[] = [
    ...history,
    { role: 'user', content: sanitizedUser },
  ];
  const interlocutorTail = collapseConsecutiveUsers([
    ...historyToGeminiContents(historyWithNewUser),
    {
      role: 'user',
      parts: [{
        text: `El análisis estructurado del paso anterior es el siguiente. Intégralo en un único monólogo hablado, coherente con todo el historial previo:\n\n${analysis}`,
      }],
    },
  ]);

  const s3 = await generateContent({
    apiKey,
    modelId: GEMINI_MODELS.interlocutor,
    systemInstruction: interlocutorSystemFull,
    contents: interlocutorTail,
    temperature: 0.55,
    maxOutputTokens: 4096,
    thinkingLevel: GEMINI_THINKING.interlocutor,
    stage: closingMode ? 'interlocutor-closing' : 'interlocutor',
  });
  if (!s3.ok) {
    return { ok: false, error: s3.error, stage: 'interlocutor' };
  }
  const finalReply = s3.text.trim();
  if (!finalReply) {
    return { ok: false, error: 'El interlocutor devolvió texto vacío.', stage: 'interlocutor' };
  }

  return { ok: true, sanitizedUser, analysis, finalReply };
}
