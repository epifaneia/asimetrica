// TODO(expo-av): expo-av está deprecated desde SDK 53. Migrar a expo-audio (recorder + Sound)
//                cuando estabilicen su API. Mantener este archivo y `ttsPlaybackService.ts` como
//                único punto de uso para que la migración sea localizada.
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import type { RecordingOptions } from 'expo-av/build/Audio/Recording.types';
import { useCallback, useEffect, useRef, useState } from 'react';

/** AAC en .m4a, 16 kHz mono, bitrate bajo — voz / subida ligera (alineado con Whisper). */
function buildRecordingOptions(): RecordingOptions {
  return {
    isMeteringEnabled: false,
    android: {
      extension: '.m4a',
      outputFormat: Audio.AndroidOutputFormat.MPEG_4,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 64000,
    },
    ios: {
      extension: '.m4a',
      outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
      audioQuality: Audio.IOSAudioQuality.MEDIUM,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 64000,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 64000,
    },
  };
}

async function setRecordingMode(on: boolean): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: on,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    shouldDuckAndroid: true,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    playThroughEarpieceAndroid: false,
  });
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<InstanceType<typeof Audio.Recording> | null>(null);

  const startRecording = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    setError(null);
    try {
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
        recordingRef.current = null;
      }

      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        const msg = 'Permiso de micrófono denegado.';
        setError(msg);
        return { ok: false, message: msg };
      }

      await setRecordingMode(true);

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(buildRecordingOptions());
      await rec.startAsync();
      recordingRef.current = rec;
      setIsRecording(true);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      recordingRef.current = null;
      setIsRecording(false);
      await setRecordingMode(false).catch(() => {});
      return { ok: false, message: msg };
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<
    { ok: true; uri: string } | { ok: false; uri: null; message?: string }
  > => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);

    if (!rec) {
      await setRecordingMode(false).catch(() => {});
      return { ok: false, uri: null };
    }

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
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
  }, []);

  useEffect(() => {
    return () => {
      const r = recordingRef.current;
      if (r) {
        r.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      setRecordingMode(false).catch(() => {});
    };
  }, []);

  return { isRecording, startRecording, stopRecording, error, clearError: () => setError(null) };
}
