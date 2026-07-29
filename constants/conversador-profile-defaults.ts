import type { AiProfileId } from '@/lib/conversador-profile';
import { AI_PROFILE_SYSTEM_PROMPTS } from '@/constants/ai-profile-prompts';

/**
 * Reglas comunes del paso «interlocutor» (solo texto para Kokoro).
 * El análisis profundo (paso 2) sigue usando `AI_PROFILE_SYSTEM_PROMPTS` en código.
 */
export const INTERLOCUTOR_BASE_INSTRUCTIONS = `Eres la voz hablada de una app de disertación. Recibes un análisis estructurado (markdown interno) y debes convertirlo en un monólogo natural en español, como si hablaras en voz alta a una sola persona.

Requisitos:
- Sin asteriscos, sin negritas ni formato que un TTS deba "leer".
- No leas listas en voz alta ni digas "punto uno". Los ordinales integrados en la
  prosa sí valen ("la primera…", "y la segunda…"): se escuchan bien y dan dónde
  agarrarse. Lo que no vale es recitar como un informe.
- Frases de longitud oral; usa comas y puntos para pausas naturales.
- Tono conversacional y directo, sin meta-comentarios sobre "el análisis anterior" o "como modelo".
- No añadas saludos de servicio al cliente a menos que encaje con el tono del contenido.`;

/** Nombre corto en UI de voz / estados (Expandir, Auditar…). */
export const DEFAULT_CONVERSADOR_DISPLAY_NAME: Record<AiProfileId, string> = {
  creativo: 'Expandir',
  auditor: 'Auditar',
  sistemico: 'Sistémico',
  destilador: 'Destilar',
};

export const DEFAULT_CONVERSADOR_DOCK_ICON: Record<AiProfileId, string> = {
  creativo: 'flash-outline',
  auditor: 'locate-outline',
  sistemico: 'git-network-outline',
  destilador: 'diamond-outline',
};

/**
 * Arte por defecto del dock: disco ámbar + glifo negro (mismo lenguaje que el
 * FAB, generados a juego). Son PNG opacos SIN alfa → siempre renderizar con
 * recorte circular (overflow hidden), o asoman las esquinas blancas.
 * Un override de icono del usuario (Ionicons) sigue teniendo prioridad.
 */
export const DEFAULT_CONVERSADOR_DOCK_IMAGE: Record<AiProfileId, number> = {
  creativo: require('../assets/images/profiles/creativo.png'),
  auditor: require('../assets/images/profiles/auditor.png'),
  sistemico: require('../assets/images/profiles/sistemico.png'),
  destilador: require('../assets/images/profiles/destilador.png'),
};

/** Iconos Ionicons permitidos para el dock (evita nombres inválidos en runtime). */
export const CONVERSADOR_ICON_OPTIONS = [
  'flash-outline',
  'locate-outline',
  'git-network-outline',
  'diamond-outline',
  'sparkles-outline',
  'bulb-outline',
  'compass-outline',
  'telescope-outline',
  'search-outline',
  'shield-checkmark-outline',
  'git-branch-outline',
  'layers-outline',
  'funnel-outline',
  'color-wand-outline',
  'chatbubble-ellipses-outline',
  'mic-outline',
] as const;

export type ConversadorDockIconName = (typeof CONVERSADOR_ICON_OPTIONS)[number];

export function getDefaultConversadorSystemPrompt(profile: AiProfileId): string {
  return `${INTERLOCUTOR_BASE_INSTRUCTIONS}\n\n---\n\n${AI_PROFILE_SYSTEM_PROMPTS[profile]}`;
}
