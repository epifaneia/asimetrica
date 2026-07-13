import { generateContent, type GeminiResult, type GeminiTurn } from './geminiClient';
import { GEMINI_MODELS } from './geminiModels';

/**
 * Servicios Gemini puntuales (no pertenecen al pipeline conversacional).
 * Hoy expone `mergeDissertationsWithGemini` (3-pass: outline → draft → polish).
 */

export type ChatTurn = {
  role: 'user' | 'model';
  content: string;
};

const OUTLINE_SYSTEM = `Eres un editor que prepara la fusión de varias notas o disertaciones en un único texto.
Tu salida en este paso es UN ESQUEMA en bullets: secciones, hilo argumental, dónde encajan los matices distintivos de cada fuente.
No redactes el texto unificado; solo el esquema. Markdown con encabezados y bullets está permitido.
No omitas matices distintivos de ninguna fuente, aunque parezcan colaterales.`;

const DRAFT_SYSTEM = `Eres un editor que escribe el documento unificado a partir de un esquema y de las fuentes originales.
Sigue el esquema dado. Integra las ideas en prosa cohesionada en español.
Reglas:
- Evita repetir literalmente párrafos que ya están cubiertos.
- Si hay contradicciones, intégralas con transiciones naturales o deja constancia breve del matiz.
- No añadas comentarios meta ("aquí tienes la fusión", "espero que te sirva").
- No incluyas el esquema en la salida; solo el texto final.`;

const POLISH_SYSTEM = `Eres un editor que pule un borrador unificado: suaviza transiciones, elimina repeticiones, conserva voces distintivas.
No reorganices el documento ni añadas contenido nuevo. Solo limpia.
Devuelve solo el texto pulido, sin comentarios.`;

function singleUserContents(text: string): GeminiTurn[] {
  return [{ role: 'user', parts: [{ text }] }];
}

export const MERGE_DISSERTATIONS_SYSTEM_PROMPT = OUTLINE_SYSTEM; // kept for compat con código viejo si lo hubiera

export async function mergeDissertationsWithGemini(params: {
  apiKey: string;
  modelId?: string;
  base: { title: string; body: string };
  others: { title: string; body: string }[];
}): Promise<GeminiResult> {
  const { apiKey, modelId = GEMINI_MODELS.fusion, base, others } = params;

  if (others.length === 0) {
    return { ok: false, error: 'Selecciona al menos otro documento para fusionar.' };
  }
  if (!apiKey.trim()) {
    return { ok: false, error: 'Falta Google API Key.' };
  }

  // Construye el bloque de fuentes una sola vez; lo usan los pasos 1 y 2.
  let sourcesBlock = `DOCUMENTO BASE — «${base.title.trim()}»\n\n${base.body.trim()}\n\n`;
  sourcesBlock += '---\n\nDOCUMENTOS ADICIONALES PARA INTEGRAR:\n\n';
  others.forEach((o, i) => {
    sourcesBlock += `### ${i + 1}. «${o.title.trim()}»\n\n${o.body.trim()}\n\n`;
  });

  // Stage 1 — outline
  const outlineRes = await generateContent({
    apiKey,
    modelId,
    systemInstruction: OUTLINE_SYSTEM,
    contents: singleUserContents(
      `Aquí están las fuentes:\n\n${sourcesBlock}\n\nDevuelve únicamente el esquema en bullets.`
    ),
    temperature: 0.4,
    maxOutputTokens: 4096,
    thinkingLevel: 'HIGH',
    stage: 'merge-outline',
  });
  if (!outlineRes.ok) return outlineRes;
  const outline = outlineRes.text.trim();

  // Stage 2 — draft
  const draftRes = await generateContent({
    apiKey,
    modelId,
    systemInstruction: DRAFT_SYSTEM,
    contents: singleUserContents(
      `ESQUEMA:\n\n${outline}\n\n---\n\nFUENTES:\n\n${sourcesBlock}\n\nRedacta ahora el documento unificado siguiendo el esquema.`
    ),
    temperature: 0.7,
    maxOutputTokens: 16384,
    thinkingLevel: 'HIGH',
    stage: 'merge-draft',
  });
  if (!draftRes.ok) return draftRes;
  const draft = draftRes.text.trim();

  // Stage 3 — polish
  const polishRes = await generateContent({
    apiKey,
    modelId,
    systemInstruction: POLISH_SYSTEM,
    contents: singleUserContents(`BORRADOR:\n\n${draft}`),
    temperature: 0.4,
    maxOutputTokens: 16384,
    thinkingLevel: 'MEDIUM',
    stage: 'merge-polish',
  });
  if (!polishRes.ok) return polishRes;

  return { ok: true, text: polishRes.text.trim() };
}
