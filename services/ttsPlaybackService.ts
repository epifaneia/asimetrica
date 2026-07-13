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

let activePlayer: AudioPlayer | null = null;
let speechActive = false;

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

  const synth = await synthesizeWithGemini({ apiKey, text: trimmed, voiceName });
  if (!synth.ok) {
    if (settings.ttsEmergencyFallback) {
      await stopActiveTtsPlayback();
      speakWithSystemVoice(trimmed, finish);
      return;
    }
    finish('error');
    return;
  }

  await stopActiveTtsPlayback();
  await setPlaybackAudioMode();

  try {
    const player = createAudioPlayer({ uri: synth.audioUri });
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
        finish('natural');
      }
    });
    player.play();
  } catch {
    finish('error');
  }
}
