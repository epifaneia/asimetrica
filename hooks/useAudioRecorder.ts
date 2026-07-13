// Migrado de expo-av (deprecated en SDK 54, crash "Player accessed on wrong thread"
// con la Nueva Arquitectura) a expo-audio. Este archivo y `ttsPlaybackService.ts`
// son el único punto de uso del recorder/reproductor, para que la migración quede
// localizada.
import {
  useAudioRecorder as useExpoAudioRecorder,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
  type RecordingOptions,
} from 'expo-audio';
import { useCallback, useEffect, useState } from 'react';

/** AAC en .m4a, 16 kHz mono, bitrate bajo — voz / subida ligera (alineado con Whisper). */
const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: false,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 64000,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    sampleRate: 16000,
  },
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    extension: '.m4a',
    sampleRate: 16000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

async function setRecordingMode(on: boolean): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: on,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'doNotMix',
    shouldRouteThroughEarpiece: false,
  });
}

export function useAudioRecorder() {
  // expo-audio gestiona el ciclo de vida del recorder (auto-release al desmontar).
  const recorder = useExpoAudioRecorder(RECORDING_OPTIONS);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startRecording = useCallback(async (): Promise<
    { ok: true } | { ok: false; message: string }
  > => {
    setError(null);
    try {
      // por si quedó una grabación a medias
      if (recorder.isRecording) {
        try {
          await recorder.stop();
        } catch {
          /* ignore */
        }
      }

      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        const msg = 'Permiso de micrófono denegado.';
        setError(msg);
        return { ok: false, message: msg };
      }

      await setRecordingMode(true);
      await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
      recorder.record();
      setIsRecording(true);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setIsRecording(false);
      await setRecordingMode(false).catch(() => {});
      return { ok: false, message: msg };
    }
  }, [recorder]);

  const stopRecording = useCallback(async (): Promise<
    { ok: true; uri: string } | { ok: false; uri: null; message?: string }
  > => {
    setIsRecording(false);

    if (!recorder.isRecording && !recorder.uri) {
      await setRecordingMode(false).catch(() => {});
      return { ok: false, uri: null };
    }

    try {
      await recorder.stop();
      const uri = recorder.uri;
      await setRecordingMode(false);
      if (!uri) {
        const msg = 'No se obtuvo ruta del audio.';
        setError(msg);
        return { ok: false, uri: null, message: msg };
      }
      return { ok: true, uri };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      await setRecordingMode(false).catch(() => {});
      return { ok: false, uri: null, message: msg };
    }
  }, [recorder]);

  useEffect(() => {
    return () => {
      // el recorder se libera solo; solo devolvemos el modo de audio a reposo.
      setRecordingMode(false).catch(() => {});
    };
  }, []);

  return { isRecording, startRecording, stopRecording, error, clearError: () => setError(null) };
}
