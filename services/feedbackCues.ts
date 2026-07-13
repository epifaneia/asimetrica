import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

/**
 * Cues de feedback: SONIDO (por los auriculares) + háptico. En un Zero-UI de
 * bolsillo la vibración no siempre se percibe (mochila, movimiento); el earcon
 * por el cable es el canal fiable. Cuatro señales, estilo radio:
 *
 *   - playRecordingCue: mic ABIERTO, habla ("adelante", dos tonos ascendentes)
 *   - playAckCue:       turno recibido, procesando (tick corto)
 *   - playPositiveCue:  operación correcta (arpegio breve)
 *   - playNegativeCue:  algo falló, mira la pantalla (descendente grave)
 *
 * Los WAV viven en assets/sounds (24 kHz mono, <0,5 s). Se precargan una vez
 * (un AudioPlayer por cue) y se reproducen con seek(0)+play, sin re-crear nada.
 */

type CueName = 'recording' | 'ack' | 'success' | 'error';

const CUE_ASSETS: Record<CueName, number> = {
  recording: require('../assets/sounds/cue_recording.wav'),
  ack: require('../assets/sounds/cue_ack.wav'),
  success: require('../assets/sounds/cue_success.wav'),
  error: require('../assets/sounds/cue_error.wav'),
};

const loaded: Partial<Record<CueName, AudioPlayer>> = {};
let preloaded = false;

function ensureLoaded(): void {
  if (preloaded) return;
  preloaded = true;
  for (const name of Object.keys(CUE_ASSETS) as CueName[]) {
    try {
      const player = createAudioPlayer(CUE_ASSETS[name]);
      player.volume = 0.9;
      loaded[name] = player;
    } catch {
      /* sin asset no hay earcon; el háptico sigue funcionando */
    }
  }
}

function playCue(name: CueName): void {
  try {
    ensureLoaded();
    const player = loaded[name];
    if (player) {
      // rebobinar por si ya sonó antes; play() arranca desde el inicio.
      player.seekTo(0).catch(() => {});
      player.play();
    }
  } catch {
    /* nunca romper el flujo por un cue */
  }
}

/** Precarga opcional al arrancar la app (evita latencia en el primer cue). */
export function preloadFeedbackCues(): void {
  ensureLoaded();
}

export function playRecordingCue(): void {
  playCue('recording');
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function playAckCue(): void {
  playCue('ack');
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function playPositiveCue(): void {
  playCue('success');
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function playNegativeCue(): void {
  playCue('error');
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
