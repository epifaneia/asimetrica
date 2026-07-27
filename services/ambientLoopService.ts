import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import {
  AMBIENT_LOOP_SOURCE,
  AMBIENT_RAMP_MS,
} from '@/constants/ambient-asset';

/**
 * Cama sonora continua de la sesión.
 *
 * NO se arranca y se para por fases: se crea al abrir sesión, suena en bucle
 * hasta cerrarla, y solo cambia de VOLUMEN con rampas. Dos razones medidas:
 *   - La síntesis de Gemini TTS va a ~0,6-0,9x tiempo real, así que hay huecos
 *     de 10-20 s inevitables. Con cama, dejan de parecer que la app ha muerto.
 *   - Parar y arrancar el audio crea un escalón audible en cada transición.
 *
 * Con el player siempre vivo, la pista nunca rebobina: se desvanece y vuelve
 * por donde iba.
 *
 * Si `AMBIENT_LOOP_SOURCE` es `null` (sin asset), todo esto es no-op silencioso.
 */

let player: AudioPlayer | null = null;
let rampTimer: ReturnType<typeof setInterval> | null = null;
let currentLevel = 0;

const RAMP_STEP_MS = 40;

function applyLevel(v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  currentLevel = clamped;
  if (!player) return;
  try {
    player.volume = clamped;
  } catch {
    /* la cama nunca puede romper la sesión */
  }
}

function clearRamp(): void {
  if (rampTimer) {
    clearInterval(rampTimer);
    rampTimer = null;
  }
}

/** Crea la cama y la deja sonando a volumen 0. Idempotente. */
export function ensureAmbientBed(): void {
  if (AMBIENT_LOOP_SOURCE === null) return;
  if (player) return;
  try {
    const p = createAudioPlayer(AMBIENT_LOOP_SOURCE);
    p.loop = true;
    p.volume = 0;
    player = p;
    currentLevel = 0;
    p.play();
  } catch {
    player = null;
  }
}

/** Lleva la cama a `target` con una rampa (evita el escalón del salto seco). */
export function setAmbientLevel(target: number, rampMs: number = AMBIENT_RAMP_MS): void {
  if (!player) return;
  clearRamp();
  const from = currentLevel;
  const delta = target - from;
  if (Math.abs(delta) < 0.005 || rampMs <= 0) {
    applyLevel(target);
    return;
  }
  const steps = Math.max(1, Math.round(rampMs / RAMP_STEP_MS));
  let k = 0;
  rampTimer = setInterval(() => {
    k++;
    applyLevel(from + (delta * k) / steps);
    if (k >= steps) clearRamp();
  }, RAMP_STEP_MS);
}

/** Fin de sesión: para la cama y libera el reproductor. */
export function releaseAmbientBed(): void {
  clearRamp();
  currentLevel = 0;
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch {
    /* ignore */
  }
  player = null;
}
