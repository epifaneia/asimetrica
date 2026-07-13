import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { useWiredMediaCambio as NativeWiredMediaCambio } from './useWiredMediaCambio.native-impl';

/**
 * Wrapper que aísla `expo-key-event` (módulo nativo de terceros que no carga en Expo Go).
 * En Expo Go / iOS / web devuelve un no-op; solo en build nativo Android se hace `require()`
 * de la implementación real, evitando que el `requireNativeModule("ExpoKeyEvent")` se evalúe
 * al arrancar el bundle.
 */

type Options = { enabled: boolean; onMediaCambio: () => void; onMediaCorto?: () => void };

const isExpoGo = Constants.appOwnership === 'expo';

const noop = (_opts: Options): void => {};

const impl: typeof NativeWiredMediaCambio =
  !isExpoGo && Platform.OS === 'android'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./useWiredMediaCambio.native-impl').useWiredMediaCambio as typeof NativeWiredMediaCambio)
    : (noop as typeof NativeWiredMediaCambio);

export function useWiredMediaCambio(opts: Options) {
  impl(opts);
}
