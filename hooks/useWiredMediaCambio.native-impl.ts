import { useKeyEventListener } from 'expo-key-event';
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

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
  /** Dedupe de rebote/auto-repeat del hardware. */
  const BOUNCE_MS = 140;
  /** Ventana de doble pulsación para Corto. */
  const DOUBLE_MS = 500;

  const listener = useCallback(
    (event: { eventType: string; key: string; repeat?: boolean }) => {
      if (!enabled || Platform.OS !== 'android') return;
      if (event.eventType !== 'press') return;
      if (event.repeat) return;
      if (!WIRED_MEDIA_CAMBIO_KEYS.has(event.key)) return;
      const now = Date.now();
      const sinceLast = now - lastPress.current;
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
