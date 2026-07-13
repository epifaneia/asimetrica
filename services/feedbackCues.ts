import { Audio } from 'expo-av';
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
 * y se reproducen con replayAsync (sin re-crear el Sound en cada cue).
 */

type CueName = 'recording' | 'ack' | 'success' | 'error';

const CUE_ASSETS: Record<CueName, number> = {
  recording: require('../assets/sounds/cue_recording.wav'),
  ack: require('../assets/sounds/cue_ack.wav'),
  success: require('../assets/sounds/cue_success.wav'),
  error: require('../assets/sounds/cue_error.wav'),
};

const loaded: Partial<Record<CueName, Audio.Sound>> = {};
let preloading: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (preloading) return preloading;
  preloading = (async () => {
    for (const name of Object.keys(CUE_ASSETS) as CueName[]) {
      try {
        const { sound } = await Audio.Sound.createAsync(CUE_ASSETS[name], {
          shouldPlay: false,
          volume: 0.9,
        });
        loaded[name] = sound;
      } catch {
        /* sin asset no hay earcon; el háptico sigue funcionando */
      }
    }
  })();
  return preloading;
}

function playCue(name: CueName): void {
  void (async () => {
    try {
      await ensureLoaded();
      const sound = loaded[name];
      if (sound) await sound.replayAsync();
    } catch {
      /* nunca romper el flujo por un cue */
    }
  })();
}

/** Precarga opcional al arrancar la app (evita latencia en el primer cue). */
export function preloadFeedbackCues(): void {
  void ensureLoaded();
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
