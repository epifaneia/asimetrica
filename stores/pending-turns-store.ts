import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { AiProfileId } from '@/lib/conversador-profile';

/**
 * Resiliencia de campo: NADA se pierde.
 *
 * - `pending`: turnos de voz cuyo pipeline falló (red caída, Gemini KO). El
 *   audio .m4a se ha movido de cache a documentDirectory antes de encolar, así
 *   que sobrevive a reinicios. Se reprocesan desde el banner del dashboard
 *   (services/pendingTurnsService).
 * - `activeSession`: sello de sesión de campo en curso. Se pone al arrancar
 *   sesión y se limpia en el cierre LIMPIO; si al arrancar la app existe,
 *   la app murió a mitad de sesión → el dashboard ofrece retomar la conversación.
 */

export type PendingTurn = {
  id: string;
  createdAt: string;
  /** Audio .m4a ya movido a almacenamiento persistente (documentDirectory). */
  audioUri: string;
  profile: AiProfileId;
  /** Disertación destino; null si el fallo fue en el PRIMER turno (aún sin doc). */
  docId: string | null;
  /** Carpeta destino para crear el doc si docId es null. */
  folderId: string | null;
  closingMode: boolean;
};

/**
 * Investigacion profunda lanzada y todavia viva en el servidor. Se PERSISTE
 * porque tarda minutos (el agente admite hasta una hora): si el paseo sigue, si
 * la app se va a segundo plano o si muere, el sondeo se reanuda al volver. En
 * memoria se perderia un informe ya pagado.
 */
export type ResearchJob = {
  id: string;
  createdAt: string;
  /** id de la interaccion en la Interactions API. */
  interactionId: string;
  /** Encargo tal como se dijo, para el titulo si la sintesis falla. */
  brief: string;
  /** Carpeta a cuya biblioteca aterriza el informe. */
  folderId: string | null;
};

export type ActiveSessionMark = {
  profile: AiProfileId;
  docId: string | null;
  startedAt: string;
};

type State = {
  pending: PendingTurn[];
  activeSession: ActiveSessionMark | null;
  research: ResearchJob[];
  /**
   * Cierres de sesión («Corto») corriendo en background. NO se persiste: si la
   * app muere a mitad, el turno sigue en `pending` (se encola ANTES de arrancar),
   * así que el banner de pendientes lo recoge. Esto solo cambia el texto que se
   * muestra mientras vuela.
   */
  closingInFlight: number;
  addPending: (turn: Omit<PendingTurn, 'id' | 'createdAt'>) => string;
  removePending: (id: string) => void;
  markSessionActive: (mark: ActiveSessionMark) => void;
  updateSessionDocId: (docId: string) => void;
  clearSessionMark: () => void;
  beginClosingTurn: () => void;
  endClosingTurn: () => void;
  addResearch: (job: Omit<ResearchJob, 'id' | 'createdAt'>) => void;
  removeResearch: (id: string) => void;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const usePendingTurnsStore = create<State>()(
  persist(
    (set, get) => ({
      pending: [],
      activeSession: null,
      research: [],
      closingInFlight: 0,
      addPending: (turn) => {
        const id = newId();
        set({
          pending: [...get().pending, { ...turn, id, createdAt: new Date().toISOString() }],
        });
        return id;
      },
      removePending: (id) => set({ pending: get().pending.filter((t) => t.id !== id) }),
      markSessionActive: (mark) => set({ activeSession: mark }),
      updateSessionDocId: (docId) =>
        set((s) => (s.activeSession ? { activeSession: { ...s.activeSession, docId } } : s)),
      clearSessionMark: () => set({ activeSession: null }),
      beginClosingTurn: () => set({ closingInFlight: get().closingInFlight + 1 }),
      endClosingTurn: () => set({ closingInFlight: Math.max(0, get().closingInFlight - 1) }),
      addResearch: (job) =>
        set({
          research: [
            ...get().research,
            { ...job, id: newId(), createdAt: new Date().toISOString() },
          ],
        }),
      removeResearch: (id) =>
        set({ research: get().research.filter((r) => r.id !== id) }),
    }),
    {
      name: 'asimetrica-pending-turns',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        pending: s.pending,
        activeSession: s.activeSession,
        research: s.research,
      }),
    }
  )
);
