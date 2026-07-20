import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import * as Speech from 'expo-speech';

import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { synthesizeWithGemini } from './geminiTtsService';

/**
 * TTS primario por API Gemini. Si la síntesis cloud falla (red, cuota, modelo)
 * y el usuario tiene activada la "voz de emergencia" (Ajustes, default ON),
 * cae a `expo-speech` (TTS del sistema, gratis y offline): voz peor, pero la
 * sesión de campo NO se rompe. Con el fallback desactivado, `reason: 'error'`
 * y cue ❌ como antes.
 */

export type TtsEndReason = 'natural' | 'error' | 'stopped';

const DEFAULT_VOICE = 'Kore';

/**
 * Respuestas largas se trocean en cabeza (~primeras frases) + resto: la cabeza se
 * sintetiza y suena YA mientras el resto se sintetiza en paralelo. Baja la espera
 * percibida sin cortes audibles (el corte cae en un límite de frase).
 */
const TTS_HEAD_TARGET_CHARS = 240;

let activePlayer: AudioPlayer | null = null;
let speechActive = false;
/** Cada stop/arranque invalida las continuaciones en vuelo del troceado. */
let playbackGeneration = 0;

/** Divide en [cabeza, resto] por límite de frase pasado el target. Resto `null` si no compensa trocear. */
function splitForTts(text: string): [string, string | null] {
  if (text.length <= TTS_HEAD_TARGET_CHARS * 1.8) return [text, null];
  const boundary = /[.!?…]+["»)]?(?:\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text))) {
    const end = m.index + m[0].length;
    if (end >= TTS_HEAD_TARGET_CHARS) {
      const head = text.slice(0, end).trim();
      const tail = text.slice(end).trim();
      return tail ? [head, tail] : [text, null];
    }
  }
  return [text, null];
}

async function setPlaybackAudioMode(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'duckOthers',
    shouldRouteThroughEarpiece: false,
  });
}

export async function stopActiveTtsPlayback(): Promise<void> {
  playbackGeneration++;
  if (speechActive) {
    speechActive = false;
    try {
      await Speech.stop();
    } catch {
      /* ignore */
    }
  }
  if (activePlayer) {
    try {
      activePlayer.pause();
      activePlayer.remove();
    } catch {
      /* ignore */
    }
    activePlayer = null;
  }
}

/** Voz del sistema como plan B. Devuelve por callback igual que el path primario. */
function speakWithSystemVoice(text: string, finish: (reason: TtsEndReason) => void): void {
  speechActive = true;
  try {
    Speech.speak(text, {
      language: 'es-ES',
      rate: 1.0,
      onDone: () => {
        if (!speechActive) return; // parado manualmente: el caller ya gestionó el corte
        speechActive = false;
        finish('natural');
      },
      onStopped: () => {
        speechActive = false;
      },
      onError: () => {
        if (!speechActive) return;
        speechActive = false;
        finish('error');
      },
    });
  } catch {
    speechActive = false;
    finish('error');
  }
}

export async function playDissertationTts(
  text: string,
  onPlaybackFinished: (reason: TtsEndReason) => void
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    onPlaybackFinished('natural');
    return;
  }

  const settings = useUserSettingsStore.getState();
  const apiKey = resolveGoogleApiKey(settings.googleApiKey);
  const voiceName = settings.ttsVoiceId.trim() || DEFAULT_VOICE;

  let endOnce = false;
  const finish = (reason: TtsEndReason) => {
    if (endOnce) return;
    endOnce = true;
    onPlaybackFinished(reason);
  };

  // Cabeza + resto en paralelo: la cabeza empieza a sonar en cuanto llega su audio.
  const [headText, tailText] = splitForTts(trimmed);
  const tailPromise = tailText
    ? synthesizeWithGemini({ apiKey, text: tailText, voiceName })
    : null;

  const head = await synthesizeWithGemini({ apiKey, text: headText, voiceName });
  if (!head.ok) {
    if (settings.ttsEmergencyFallback) {
      await stopActiveTtsPlayback();
      speakWithSystemVoice(trimmed, finish);
      return;
    }
    finish('error');
    return;
  }

  await stopActiveTtsPlayback();
  const gen = playbackGeneration;
  await setPlaybackAudioMode();

  const playFile = (audioUri: string, onNaturalEnd: () => void) => {
    try {
      const player = createAudioPlayer({ uri: audioUri });
      activePlayer = player;
      const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish) {
          sub.remove();
          if (activePlayer === player) activePlayer = null;
          try {
            player.remove();
          } catch {
            /* ignore */
          }
          onNaturalEnd();
        }
      });
      player.play();
    } catch {
      finish('error');
    }
  };

  playFile(head.audioUri, () => {
    if (gen !== playbackGeneration) return; // interrumpido: el caller ya gestionó el corte
    if (!tailPromise) {
      finish('natural');
      return;
    }
    void tailPromise.then((tail) => {
      if (gen !== playbackGeneration) return;
      if (!tail.ok) {
        if (settings.ttsEmergencyFallback) {
          speakWithSystemVoice(tailText!, finish);
        } else {
          finish('error');
        }
        return;
      }
      playFile(tail.audioUri, () => {
        if (gen !== playbackGeneration) return;
        finish('natural');
      });
    });
  });
}
