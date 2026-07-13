import { getSystemPromptForProfile } from '@/constants/ai-profile-prompts';
import { resolveConversadorSystemPrompt } from '@/lib/conversador-profile';
import type { AiProfileId } from '@/lib/conversador-profile';
import type { ConversadorProfilesState } from '@/lib/conversador-profile';

import type { ChatTurn } from './aiService';
import { generateContent, type GeminiTurn } from './geminiClient';
import { GEMINI_MODELS, GEMINI_THINKING } from './geminiModels';
import { INTERLOCUTOR_TTS_FORMAT_RULE } from './geminiPipelineService';

/**
 * Continue-from cognitivo: lee una conversación cerrada y genera el primer turno
 * (rol `model`) en la voz del NUEVO perfil cognitivo, sintetizando lo previo y
 * dejando abierto por dónde continuar. Una sola llamada Pro.
 *
 * El resultado se guarda como primer mensaje de un doc nuevo: la nueva voz toma el hilo.
 */

const CONTINUATION_LAYER = `Vas a iniciar una conversación recogiendo el hilo de una sesión anterior con el usuario.

A continuación tienes la conversación origen completa. Tu tarea: producir UN único monólogo en TU voz cognitiva (no la del perfil anterior), que:
- Sintetice los puntos vivos del hilo desde tu mirada particular.
- Conserve los matices que merece la pena llevar a la siguiente sesión.
- No diga "como mencionaste antes" ni "en la conversación previa": es tu primer turno hablado en esta nueva sesión, no un resumen distante.
- Deje abierto por dónde quieres continuar (puedes plantear una tensión, una pregunta, o un ángulo nuevo desde tu rol).

Aplica las reglas TTS: prosa fluida, sin markdown, sin viñetas. 4 a 8 frases.`;

function historyToContents(history: ChatTurn[]): GeminiTurn[] {
  const dialogue = history
    .filter((m) => m.content.trim())
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'IA (perfil anterior)'}: ${m.content.trim()}`)
    .join('\n\n');
  return [{ role: 'user', parts: [{ text: dialogue || '(sin contenido)' }] }];
}

export async function generateContinuationSeed(params: {
  apiKey: string;
  sourceHistory: ChatTurn[];
  newProfile: AiProfileId;
  conversadorProfiles: ConversadorProfilesState;
}): Promise<{ ok: true; seedReply: string } | { ok: false; error: string }> {
  const { apiKey, sourceHistory, newProfile, conversadorProfiles } = params;

  if (!apiKey.trim()) return { ok: false, error: 'Falta Google API Key.' };
  if (sourceHistory.length === 0) {
    return { ok: false, error: 'La conversación origen está vacía.' };
  }

  const profileCore = getSystemPromptForProfile(newProfile);
  const interlocutorBase = resolveConversadorSystemPrompt(newProfile, conversadorProfiles);

  const system = [profileCore, interlocutorBase, INTERLOCUTOR_TTS_FORMAT_RULE, CONTINUATION_LAYER].join('\n\n');

  const result = await generateContent({
    apiKey,
    modelId: GEMINI_MODELS.corto, // mismo tier que Corto: Pro thinking MEDIUM.
    systemInstruction: system,
    contents: historyToContents(sourceHistory),
    temperature: 0.6,
    maxOutputTokens: 2048,
    thinkingLevel: GEMINI_THINKING.corto,
    stage: 'continue-from-seed',
  });

  if (!result.ok) return result;
  const seedReply = result.text.trim();
  if (!seedReply) return { ok: false, error: 'Continuación vacía.' };
  return { ok: true, seedReply };
}
