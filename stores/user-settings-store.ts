import type {
  AiProfileId,
  ConversadorProfileOverride,
  ConversadorProfilesState,
} from '@/lib/conversador-profile';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

/**
 * Modo del pipeline de análisis:
 *   - 'profundo': el original (STT + sanitiza en dos llamadas, Pro thinking HIGH, análisis largo).
 *   - 'rapido': STT+sanitiza fusionados en UNA llamada, thinking MEDIUM y análisis acotado.
 * Mismo pipeline conceptual; el modo solo mueve las palancas de latencia.
 */
export type PipelineMode = 'profundo' | 'rapido';

type UserSettingsState = {
  /** API key de Google (Gemini Developer API). Misma palanca para todos los stages. */
  googleApiKey: string;
  conversadorProfiles: ConversadorProfilesState;
  /** ID de cliente OAuth (tipo «Aplicación de escritorio»); opcional si usas EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID. */
  googleOAuthClientId: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  googleAccessExpiryMs: number;
  /** ID de voz `expo-speech` fijado por el usuario. Vacío → auto-pick (neural si está disponible). */
  ttsVoiceId: string;
  /** Voz del sistema (expo-speech) como plan B si el TTS Gemini falla. Default ON. */
  ttsEmergencyFallback: boolean;
  /** Al cerrar sesión de campo, exportar la disertación a Google Docs automáticamente. Default OFF. */
  autoExportOnClose: boolean;
  /**
   * Velocidad vs profundidad del análisis por turno. Default 'rapido': en campo
   * gana por goleada — con el recap y la cama cubriendo la espera, más cognición
   * añade menos de lo que quita en latencia, precio y fricción.
   */
  pipelineMode: PipelineMode;
  /**
   * Espera activa: mientras el analista piensa, el sistema recapitula lo que has
   * dicho (perfil → anclas → bullets → colchón). Default ON.
   * Para saltarlo SOLO en un turno no hace falta venir aquí: pulsa el botón del
   * cable mientras habla. Este toggle es el apagado permanente.
   */
  recapEnabled: boolean;
  setGoogleApiKey: (key: string) => void;
  setGoogleOAuthClientId: (id: string) => void;
  clearGoogleOAuth: () => void;
  setConversadorProfileEntry: (id: AiProfileId, entry: ConversadorProfileOverride | null) => void;
  clearConversadorProfile: (id: AiProfileId) => void;
  setTtsVoiceId: (id: string) => void;
  setTtsEmergencyFallback: (on: boolean) => void;
  setAutoExportOnClose: (on: boolean) => void;
  setPipelineMode: (mode: PipelineMode) => void;
  setRecapEnabled: (on: boolean) => void;
};

/** BYOK Google: ajustes o `EXPO_PUBLIC_GOOGLE_API_KEY` (legacy: `EXPO_PUBLIC_GEMINI_API_KEY`). */
export function resolveGoogleApiKey(stored: string): string {
  const t = stored.trim();
  if (t) return t;
  return (
    process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim() ||
    process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() ||
    ''
  );
}

const PERSIST_VERSION = 3;

/**
 * Almacenamiento híbrido: el estado va a AsyncStorage COMO SIEMPRE, salvo los
 * secretos (API key y tokens OAuth), que viven cifrados en el keystore del
 * sistema vía expo-secure-store. Instalaciones antiguas con los secretos en
 * AsyncStorage plano se migran solas en la primera lectura (se mueven al
 * keystore y se purgan del JSON plano).
 */
const SECRET_FIELDS = ['googleApiKey', 'googleAccessToken', 'googleRefreshToken'] as const;
const SECURE_KEY = 'asimetrica-secrets';

type PersistEnvelope = { state?: Record<string, unknown>; version?: number };

async function readSecrets(): Promise<Record<string, string>> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const hybridSecureStorage: StateStorage = {
  getItem: async (name) => {
    const [rawPub, secrets] = await Promise.all([AsyncStorage.getItem(name), readSecrets()]);
    if (!rawPub) return null;
    try {
      const envelope = JSON.parse(rawPub) as PersistEnvelope;
      const state = envelope.state ?? {};
      // Migración desde instalaciones con secretos en plano: al keystore y purga.
      const leaked = SECRET_FIELDS.filter((f) => typeof state[f] === 'string' && state[f]);
      if (leaked.length) {
        for (const f of leaked) secrets[f] = state[f] as string;
        await SecureStore.setItemAsync(SECURE_KEY, JSON.stringify(secrets));
        for (const f of SECRET_FIELDS) delete state[f];
        await AsyncStorage.setItem(name, JSON.stringify({ ...envelope, state }));
      }
      for (const f of SECRET_FIELDS) state[f] = secrets[f] ?? '';
      return JSON.stringify({ ...envelope, state });
    } catch {
      return rawPub;
    }
  },
  setItem: async (name, value) => {
    try {
      const envelope = JSON.parse(value) as PersistEnvelope;
      const state = { ...(envelope.state ?? {}) };
      const secrets: Record<string, string> = {};
      for (const f of SECRET_FIELDS) {
        if (typeof state[f] === 'string') secrets[f] = state[f] as string;
        delete state[f];
      }
      await Promise.all([
        AsyncStorage.setItem(name, JSON.stringify({ ...envelope, state })),
        SecureStore.setItemAsync(SECURE_KEY, JSON.stringify(secrets)),
      ]);
    } catch {
      await AsyncStorage.setItem(name, value);
    }
  },
  removeItem: async (name) => {
    await Promise.all([
      AsyncStorage.removeItem(name),
      SecureStore.deleteItemAsync(SECURE_KEY).catch(() => {}),
    ]);
  },
};

export const useUserSettingsStore = create<UserSettingsState>()(
  persist(
    (set) => ({
      googleApiKey: '',
      conversadorProfiles: {},
      googleOAuthClientId: '',
      googleAccessToken: '',
      googleRefreshToken: '',
      googleAccessExpiryMs: 0,
      ttsVoiceId: '',
      ttsEmergencyFallback: true,
      autoExportOnClose: false,
      pipelineMode: 'rapido',
      recapEnabled: true,
      setGoogleApiKey: (key) => set({ googleApiKey: key }),
      setGoogleOAuthClientId: (id) => set({ googleOAuthClientId: id.trim() }),
      setTtsVoiceId: (id) => set({ ttsVoiceId: id.trim() }),
      setTtsEmergencyFallback: (on) => set({ ttsEmergencyFallback: on }),
      setAutoExportOnClose: (on) => set({ autoExportOnClose: on }),
      setPipelineMode: (mode) => set({ pipelineMode: mode }),
      setRecapEnabled: (on) => set({ recapEnabled: on }),
      clearGoogleOAuth: () =>
        set({
          googleAccessToken: '',
          googleRefreshToken: '',
          googleAccessExpiryMs: 0,
        }),
      setConversadorProfileEntry: (id, entry) =>
        set((s) => {
          const next = { ...s.conversadorProfiles };
          if (!entry || Object.keys(entry).length === 0) {
            delete next[id];
          } else {
            next[id] = entry;
          }
          return { conversadorProfiles: next };
        }),
      clearConversadorProfile: (id) =>
        set((s) => {
          const next = { ...s.conversadorProfiles };
          delete next[id];
          return { conversadorProfiles: next };
        }),
    }),
    {
      name: 'guardaespaldas-user-settings',
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => hybridSecureStorage),
      partialize: (s) => ({
        googleApiKey: s.googleApiKey,
        conversadorProfiles: s.conversadorProfiles,
        googleOAuthClientId: s.googleOAuthClientId,
        googleAccessToken: s.googleAccessToken,
        googleRefreshToken: s.googleRefreshToken,
        googleAccessExpiryMs: s.googleAccessExpiryMs,
        ttsVoiceId: s.ttsVoiceId,
        ttsEmergencyFallback: s.ttsEmergencyFallback,
        autoExportOnClose: s.autoExportOnClose,
        pipelineMode: s.pipelineMode,
        recapEnabled: s.recapEnabled,
      }),
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== 'object') return persisted as UserSettingsState;
        if (version >= PERSIST_VERSION) return persisted as UserSettingsState;

        const p = persisted as Record<string, unknown>;
        // v0 → v1: descartar groqApiKey, mover geminiApiKey → googleApiKey.
        const googleApiKey =
          (typeof p.googleApiKey === 'string' && p.googleApiKey) ||
          (typeof p.geminiApiKey === 'string' && p.geminiApiKey) ||
          '';
        // v1 → v2: añadir ttsVoiceId vacío (auto-pick voz del sistema).
        // v2 → v3: ttsVoiceId pasa de IDs de sistema a nombres Gemini ('Kore', 'Aoede', ...).
        //          Los valores antiguos ya no son válidos: limpiar a vacío para fallback al
        //          default 'Kore'. El usuario puede reelegir desde Ajustes.
        const ttsVoiceId = version >= 3 && typeof p.ttsVoiceId === 'string' ? p.ttsVoiceId : '';
        const next: Record<string, unknown> = { ...p, googleApiKey, ttsVoiceId };
        delete next.groqApiKey;
        delete next.geminiApiKey;
        return next as UserSettingsState;
      },
    }
  )
);
