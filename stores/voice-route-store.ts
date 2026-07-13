import { create } from 'zustand';

/** Dónde guardar el intercambio de voz al pulsar «Pausar y enviar». */
export type VoiceRouteTarget =
  | { kind: 'document'; documentId: string }
  | { kind: 'folder'; folderId: string }
  /** Inicio: primera carpeta por fecha de actualización. */
  | { kind: 'dashboard' }
  | null;

type State = {
  target: VoiceRouteTarget;
  setVoiceTarget: (t: VoiceRouteTarget) => void;
};

export const useVoiceRouteStore = create<State>((set) => ({
  /** Inicio: dock visible en el dashboard hasta que una pantalla lo sustituya. */
  target: { kind: 'dashboard' },
  setVoiceTarget: (t) => set({ target: t }),
}));
