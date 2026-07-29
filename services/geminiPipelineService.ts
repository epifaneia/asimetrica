import { getSystemPromptForProfile } from '@/constants/ai-profile-prompts';
import type { AiProfileId } from '@/lib/conversador-profile';

import type { ChatTurn } from './aiService';
import {
  generateContent,
  generateContentStream,
  type GeminiResult,
  type GeminiTurn,
} from './geminiClient';
import { GEMINI_MODELS, GEMINI_THINKING } from './geminiModels';

/**
 * Pipeline de disertación en Gemini con tier por stage:
 *
 *   1 Sanitiza   · Flash Lite, MINIMAL  · limpieza plana de transcripción.
 *   2 Analiza    · Pro,        HIGH     · análisis cognitivo profundo (consumo interno, markdown).
 *   3 Interlocutor · Flash,    LOW      · convierte el análisis en monólogo hablado para TTS.
 *
 *   4 Corto (finale) · Pro,    MEDIUM   · latido final del perfil cuando el usuario cierra sesión.
 *
 * Modo ágil (`fastMode`, Ajustes, y el default): el stage 1 desaparece (la
 * transcripción llega ya sanitizada en la misma llamada STT) y el stage 2 corre con
 * thinking MEDIUM en vez de HIGH. Nada más: misma riqueza de análisis, mismo límite
 * de salida, mismas ideas. Lo único que se negocia es cuánto razona por dentro.
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

/**
 * Capa común del analista: solo FORMATO e idioma. El registro lo lleva la
 * identidad del perfil, y son responsabilidades que no se solapan — por eso no
 * hace falta declarar jerarquía entre las dos.
 *
 * Lo que se retiró y por qué:
 *   - «Puedes usar markdown con encabezados y listas»: la estructura tipográfica
 *     vive en la disposición del texto, y la voz no tiene disposición. Al
 *     pronunciarse desaparece y el oyente deja de saber dónde empieza cada cosa.
 *     Los ordinales dichos en prosa guardan la estructura EN LAS PALABRAS y
 *     sobreviven al viaje intactos.
 *   - «Sé extenso: matices, RIESGOS, supuestos, CONTRAARGUMENTOS…»: esto exigía
 *     crítica a los CUATRO perfiles, así que el de abrir evaluaba por decreto
 *     aunque su identidad dijera lo contrario (comprobado: metía «riesgo» y
 *     «problema» en una prueba real). Era la causa de que los perfiles se
 *     difuminaran entre sí.
 *   - «en español»: fijar el idioma aquí dejaba la app inservible para quien no
 *     lo hable.
 *
 * Se dice el motivo y no solo la regla: con el motivo, el modelo deduce solo que
 * tampoco valen las tablas, ni los esquemas, ni las flechas. Con la regla a secas
 * cumple la letra y se inventa otro formato invisible.
 */
const ANALYST_LAYER = `Esto que escribas se va a leer en voz alta. Si te apetece estructurar en listas o tablas, recuerda que no se ven; los ordinales dichos en prosa («hay tres tensiones aquí; la primera…») sí se oyen.

Escribe en el idioma del usuario, y no le hables a él: esto lo recoge otra capa antes de llegar a la persona.`;

/**
 * PRINCIPIO: el modo cambia cuánto PIENSA el analista (thinking level), nunca
 * cuánto DICE.
 *
 * El modo rápido llevaba una capa que le ordenaba «céntrate en 2-3 ideas y omite
 * lo secundario». Eso no comprimía: BORRABA contenido, y se percibía como que la
 * IA había perdido el hilo de la conversación (aunque el historial completo sí
 * viaja en cada turno). Perder ideas es un contra grave para esta app, así que la
 * capa se retira: los segundos se recortan por arquitectura (STT+sanitiza en una
 * llamada, troceado del TTS, streaming) y quitando GRASA al interlocutor, no
 * quitando pensamiento.
 *
 * Y el reparto del coste importa: el análisis es INTERNO (nunca se pronuncia),
 * así que su longitud casi no añade espera. La respuesta hablada sí — cada
 * carácter son ~0,067 s de audio y ~0,05 s de síntesis. Se recorta ahí, y sin
 * tocar las ideas.
 */

/** Inyectado al final del system del interlocutor (salida oral / TTS). */
export const INTERLOCUTOR_TTS_FORMAT_RULE = `IMPORTANTE: Tu respuesta será leída por un motor de texto a voz (TTS). Debes responder usando exclusivamente prosa natural y fluida. ESTÁ TERMINANTEMENTE PROHIBIDO usar listas, viñetas (bullet points), emojis, asteriscos, palabras en negrita o caracteres especiales de Markdown. Usa puntos y comas para marcar las pausas respiratorias.

DENSIDAD ORAL: cada segundo que hablas es un segundo que el usuario espera escuchando, así que no gastes ninguno en relleno. PROHIBIDO: preámbulos y frases de arranque ("Vamos a ver…", "Es interesante que…"), recapitular o parafrasear lo que el usuario acaba de decir (ya lo sabe), meta-comentarios sobre el análisis o sobre ti mismo, y cierres de cortesía. Entra directo en la primera idea.
Esto NO significa decir menos: TODAS las ideas de valor del análisis deben aparecer. Se recorta la grasa, nunca el contenido.

ORDINALES SÍ: puedes decir "la primera", "la segunda", "por un lado / por otro" cuando ayuden a seguirte el hilo — eso se escucha bien y le da al oyente dónde agarrarse. Lo que no haces es recitar como un informe: nada de "punto uno", "apartado dos" ni leer una lista en voz alta.`;

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
  /**
   * Modo rápido (Ajustes → pipelineMode 'rapido'): asume que `rawUserText` llega YA sanitizado
   * (STT+sanitiza fusionados en la transcripción), y corre el analista con thinking MEDIUM
   * y salida acotada. El modo profundo es el comportamiento original.
   */
  fastMode?: boolean;
  /**
   * Bloque de jaula (biblioteca de obra) para el system del ANALISTA. El
   * interlocutor NO lo recibe: su trabajo es traducir a registro oral, no saber.
   * Vacío o ausente = pipeline idéntico al de antes de existir la biblioteca.
   */
  libraryBlock?: string;
  /** Notifica cada paso antes de su llamada HTTP. */
  onStage?: (stage: GeminiPipelineStage) => void;
  /**
   * Frases completas del interlocutor a medida que se escriben. Permite arrancar
   * la síntesis de la primera frase sin esperar a que termine de generar el resto
   * (que son 10-20 s de regalo, sumados a los ~11 s de suelo del TTS).
   */
  onInterlocutorSentence?: (sentence: string) => void;
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
    fastMode = false,
    libraryBlock,
    onStage,
    onSanitizedUser,
    onInterlocutorSentence,
  } = params;

  const raw = rawUserText.trim();
  if (!raw) {
    return { ok: false, error: 'El texto del usuario está vacío.', stage: 'sanitize' };
  }
  if (!apiKey.trim()) {
    return { ok: false, error: 'Falta Google API Key.', stage: 'sanitize' };
  }

  // Stage 1 — sanitiza. En modo rápido no hay llamada: la transcripción ya vino limpia
  // (STT+sanitiza fusionados), así que el texto pasa directo.
  let sanitizedUser: string;
  if (fastMode) {
    sanitizedUser = raw;
    onSanitizedUser?.(sanitizedUser);
  } else {
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
    sanitizedUser = s1.text.trim() || raw;
    onSanitizedUser?.(sanitizedUser);
  }

  // Stage 2 — análisis cognitivo (consumo interno). El modo mueve las palancas de latencia.
  onStage?.('analyze');
  const profileCore = getSystemPromptForProfile(profile);
  // Mismo system en los dos modos: lo único que cambia es el thinking level.
  // La jaula va al final, después del rol y de la capa de análisis.
  const analystSystem = [profileCore, ANALYST_LAYER, libraryBlock?.trim() || '']
    .filter(Boolean)
    .join('\n\n');

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
    // Sin recorte de salida en ningún modo: el análisis es interno y es donde
    // viven las ideas. El cap de 3072 del modo rápido truncaba pensamiento.
    maxOutputTokens: 8192,
    thinkingLevel: fastMode ? 'MEDIUM' : GEMINI_THINKING.analyze,
    stage: fastMode ? 'analyze-medium' : 'analyze',
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

  // Streaming solo cuando alguien escucha las frases; si no, misma llamada de
  // siempre (el turno de Corto, por ejemplo, no reproduce voz).
  const s3Params = {
    apiKey,
    modelId: GEMINI_MODELS.interlocutor,
    systemInstruction: interlocutorSystemFull,
    contents: interlocutorTail,
    temperature: 0.55,
    maxOutputTokens: 4096,
    thinkingLevel: GEMINI_THINKING.interlocutor,
    stage: closingMode ? 'interlocutor-closing' : 'interlocutor',
  };

  let s3: GeminiResult;
  if (onInterlocutorSentence) {
    let buffer = '';
    s3 = await generateContentStream({
      ...s3Params,
      stage: `${s3Params.stage}-stream`,
      onDelta: (piece) => {
        buffer += piece;
        // Se emite por FRASES, no por trozos del stream: cortar el TTS a mitad de
        // frase suena roto, y las frases son justo la unidad que la cola de
        // síntesis necesita.
        for (;;) {
          const m = buffer.match(/^[\s\S]*?[.!?…]+["»)\]]?(\s+|$)/);
          if (!m) break;
          const sentence = m[0].trim();
          buffer = buffer.slice(m[0].length);
          if (sentence) onInterlocutorSentence(sentence);
        }
      },
    });
    // Cola sin puntuación final: también cuenta.
    const tail = buffer.trim();
    if (s3.ok && tail) onInterlocutorSentence(tail);
  } else {
    s3 = await generateContent(s3Params);
  }
  if (!s3.ok) {
    return { ok: false, error: s3.error, stage: 'interlocutor' };
  }
  const finalReply = s3.text.trim();
  if (!finalReply) {
    return { ok: false, error: 'El interlocutor devolvió texto vacío.', stage: 'interlocutor' };
  }

  return { ok: true, sanitizedUser, analysis, finalReply };
}
