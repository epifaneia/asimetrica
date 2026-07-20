import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { AMBIENT_LOOP_SOURCE, AMBIENT_LOOP_VOLUME } from '@/constants/ambient-asset';

/**
 * Colchón sonoro en bucle mientras esperas la respuesta larga.
 *
 * Por qué ambiente y no voz: el habla compite con tu propia cabeza justo cuando
 * quizá sigues pensando; una textura de fondo no. Y los sonidos ambientes se
 * habitúan bien, mientras que el habla repetida se hace insufrible.
 *
 * Si `AMBIENT_LOOP_SOURCE` es `null` (sin asset), todo esto es no-op silencioso.
 */

let player: AudioPlayer | null = null;

export function startAmbientLoop(): void {
  if (AMBIENT_LOOP_SOURCE === null) return;
  try {
    if (!player) {
      player = createAudioPlayer(AMBIENT_LOOP_SOURCE);
      player.loop = true;
      player.volume = AMBIENT_LOOP_VOLUME;
    }
    if (!player.playing) {
      player.seekTo(0).catch(() => {});
      player.play();
    }
  } catch {
    /* el colchón nunca puede romper la sesión */
  }
}

export function stopAmbientLoop(): void {
  if (!player) return;
  try {
    player.pause();
  } catch {
    /* ignore */
  }
}

/** Libera el reproductor (fin de sesión). El asset se recarga solo al siguiente uso. */
export function releaseAmbientLoop(): void {
  if (!player) return;
  try {
    player.pause();
    player.remove();
  } catch {
    /* ignore */
  }
  player = null;
}
