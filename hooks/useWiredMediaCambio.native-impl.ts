import { useKeyEventListener } from 'expo-key-event';
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

import { useDiagnosticStore } from '@/stores/diagnostic-store';

/**
 * Códigos KeyEvent Android típicos del cable (jack / USB-C con micrófono):
 * 79 HEADSETHOOK, 85 MEDIA_PLAY_PAUSE, 126 MEDIA_PLAY, 127 MEDIA_PAUSE.
 * Varios auriculares envían 79 u 85 según fabricante.
 */
const WIRED_MEDIA_CAMBIO_KEYS = new Set(['79', '85', '126', '127']);

/**
 * Botón del cable, Zero-UI completo:
 *   - Pulsación simple  → «Cambio» (inmediato, sin esperar ventana de doble).
 *   - Doble pulsación (2ª dentro de DOUBLE_MS) → «Corto».
 *
 * La 1ª pulsación de un doble YA disparó Cambio — y eso compone bien con la
 * máquina de estados: Cambio en RECORDING manda el turno a PROCESSING, y el
 * Corto que llega detrás encola el cierre tras ese turno. Doble-click siempre
 * significa "remata y cierra", sin sacar el móvil del bolsillo.
 *
 * Requiere **dev build** (`npx expo run:android`): el módulo nativo no carga en Expo Go.
 */
export function useWiredMediaCambio(opts: {
  enabled: boolean;
  onMediaCambio: () => void;
  onMediaCorto?: () => void;
}) {
  const { enabled, onMediaCambio, onMediaCorto } = opts;
  const lastPress = useRef(0);
  /**
   * Dedupe de rebote/auto-repeat del hardware. OJO: esta ventana se aplica ANTES
   * de decidir si es doble pulsación, así que si es demasiado ancha se come los
   * dobles y «Corto por cable» no funciona nunca. Un doble clic deliberado en un
   * botón de cable va a 80-200 ms; el rebote real de hardware, por debajo de 40.
   */
  const BOUNCE_MS = 45;
  /** Ventana de doble pulsación para Corto. */
  const DOUBLE_MS = 500;

  const listener = useCallback(
    (event: { eventType: string; key: string; repeat?: boolean }) => {
      if (!enabled || Platform.OS !== 'android') return;
      if (event.eventType !== 'press') return;
      const now = Date.now();
      const sinceLast = now - lastPress.current;

      // Traza en Diagnóstico de TODA pulsación (también las de teclas que no
      // reconocemos): sin esto, depurar el botón del cable es adivinar. `latencyMs`
      // es el hueco desde la pulsación anterior, que es justo el dato que decide
      // si algo se está tomando por rebote.
      useDiagnosticStore.getState().push({
        stage: `cable:${event.key}`,
        model: WIRED_MEDIA_CAMBIO_KEYS.has(event.key) ? 'reconocida' : 'IGNORADA',
        latencyMs: lastPress.current === 0 ? 0 : sinceLast,
        ok: true,
        error: event.repeat ? 'repeat' : undefined,
      });

      if (event.repeat) return;
      if (!WIRED_MEDIA_CAMBIO_KEYS.has(event.key)) return;
      if (sinceLast < BOUNCE_MS) return;
      lastPress.current = now;
      if (sinceLast < DOUBLE_MS && onMediaCorto) {
        onMediaCorto();
        return;
      }
      onMediaCambio();
    },
    [enabled, onMediaCambio, onMediaCorto]
  );

  useKeyEventListener(listener, {
    listenOnMount: Platform.OS === 'android' && enabled,
    preventReload: true,
    listenToRelease: false,
    captureModifiers: true,
  });
}
