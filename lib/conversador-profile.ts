export type AiProfileId = 'creativo' | 'auditor' | 'sistemico' | 'destilador';

export const AI_PROFILE_ORDER: AiProfileId[] = [
  'creativo',
  'auditor',
  'sistemico',
  'destilador',
];
import {
  CONVERSADOR_ICON_OPTIONS,
  DEFAULT_CONVERSADOR_DISPLAY_NAME,
  DEFAULT_CONVERSADOR_DOCK_ICON,
  DEFAULT_CONVERSADOR_DOCK_IMAGE,
  getDefaultConversadorSystemPrompt,
} from '@/constants/conversador-profile-defaults';

export function buildConversadorProfileEntryFromForm(
  profile: AiProfileId,
  name: string,
  icon: string,
  prompt: string
): ConversadorProfileOverride | null {
  const out: ConversadorProfileOverride = {};
  const nt = (name.trim() || DEFAULT_CONVERSADOR_DISPLAY_NAME[profile]).trim();
  if (nt !== DEFAULT_CONVERSADOR_DISPLAY_NAME[profile]) {
    out.displayName = nt;
  }
  const ic = icon.trim();
  if (ic && ic !== DEFAULT_CONVERSADOR_DOCK_ICON[profile]) {
    out.iconName = ic;
  }
  const pt = prompt.trim();
  const defPrompt = getDefaultConversadorSystemPrompt(profile);
  if (pt && pt !== defPrompt) {
    out.conversadorSystemPrompt = pt;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export type ConversadorProfileOverride = {
  displayName?: string;
  iconName?: string;
  conversadorSystemPrompt?: string;
};

export type ConversadorProfilesState = Partial<
  Record<AiProfileId, ConversadorProfileOverride>
>;

function isAllowedIcon(name: string): name is (typeof CONVERSADOR_ICON_OPTIONS)[number] {
  return (CONVERSADOR_ICON_OPTIONS as readonly string[]).includes(name);
}

export function resolveConversadorDisplayName(
  profile: AiProfileId,
  state: ConversadorProfilesState | undefined
): string {
  const t = state?.[profile]?.displayName?.trim();
  return t || DEFAULT_CONVERSADOR_DISPLAY_NAME[profile];
}

export function resolveConversadorDockIcon(
  profile: AiProfileId,
  state: ConversadorProfilesState | undefined
): string {
  const raw = state?.[profile]?.iconName?.trim();
  if (raw && isAllowedIcon(raw)) return raw;
  return DEFAULT_CONVERSADOR_DOCK_ICON[profile];
}

/** Qué pintar en el dock: arte PNG por defecto, o el Ionicons que eligió el usuario. */
export type ConversadorDockVisual =
  | { kind: 'image'; source: number }
  | { kind: 'icon'; name: string };

/**
 * El arte a medida solo aplica mientras el usuario no haya personalizado el
 * icono: su elección explícita (Ionicons) siempre gana sobre nuestro default.
 */
export function resolveConversadorDockVisual(
  profile: AiProfileId,
  state: ConversadorProfilesState | undefined
): ConversadorDockVisual {
  const raw = state?.[profile]?.iconName?.trim();
  if (raw && isAllowedIcon(raw)) return { kind: 'icon', name: raw };
  return { kind: 'image', source: DEFAULT_CONVERSADOR_DOCK_IMAGE[profile] };
}

export function resolveConversadorSystemPrompt(
  profile: AiProfileId,
  state: ConversadorProfilesState | undefined
): string {
  const t = state?.[profile]?.conversadorSystemPrompt?.trim();
  return t || getDefaultConversadorSystemPrompt(profile);
}
