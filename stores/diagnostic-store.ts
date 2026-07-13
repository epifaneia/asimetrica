import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Buffer rolling de las últimas N llamadas a Gemini. Pensado para depurar
 * sin consola: cuando algo no funciona en producción (BYOK), el usuario abre
 * Ajustes → Diagnóstico y ve qué stage falló y qué dijo el API.
 *
 * No guarda transcripciones ni respuestas, solo metadata: timestamp, stage,
 * modelo, latencia, ok/error, mensaje de error si lo hay.
 */

export type DiagnosticEntry = {
  id: string;
  timestamp: string;
  stage: string;
  model?: string;
  latencyMs: number;
  ok: boolean;
  error?: string;
  /** Tokens de entrada/salida reportados por la API (usageMetadata), si los hay. */
  tokensIn?: number;
  tokensOut?: number;
  /** Nº de reintentos que hicieron falta para completar la llamada. */
  retries?: number;
};

const MAX_ENTRIES = 100;

type State = {
  entries: DiagnosticEntry[];
  push: (entry: Omit<DiagnosticEntry, 'id' | 'timestamp'>) => void;
  clear: () => void;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useDiagnosticStore = create<State>()(
  persist(
    (set, get) => ({
      entries: [],
      push: (entry) => {
        const next: DiagnosticEntry = {
          id: newId(),
          timestamp: new Date().toISOString(),
          ...entry,
        };
        const all = [next, ...get().entries].slice(0, MAX_ENTRIES);
        set({ entries: all });
      },
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'asimetrica-diagnostic',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ entries: s.entries }),
    }
  )
);
