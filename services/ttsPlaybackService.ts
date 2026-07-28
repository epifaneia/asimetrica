import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';

import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { synthesizeWithGemini, type TtsResult } from './geminiTtsService';

/**
 * TTS primario por API Gemini. Si la síntesis cloud falla (red, cuota, modelo)
 * y el usuario tiene activada la "voz de emergencia" (Ajustes, default ON),
 * cae a `expo-speech` (TTS del sistema, gratis y offline): voz peor, pero la
 * sesión de campo NO se rompe.
 *
 * ---------------------------------------------------------------------------
 * COLA DE TROZOS — por qué, con números medidos
 * ---------------------------------------------------------------------------
 * Gemini TTS sintetiza a ~0,6-0,9x TIEMPO REAL: 1.274 caracteres (86 s de
 * audio) tardan ~52 s en generarse. Con el troceado anterior (cabeza ~240 +
 * resto monolítico) eso daba un HUECO MEDIDO DE 17 s de silencio absoluto tras
 * la cabeza — 100 s en respuestas largas. Parecía que la app se había muerto.
 *
 * La clave es que a 0,6-0,9x, mientras suena un trozo se puede generar MÁS
 * audio del que ese trozo dura. Así que:
 *   - Trozos CRECIENTES: el primero corto (primera palabra cuanto antes; el
 *     suelo de esta API es ~10 s y no se puede bajar), los siguientes mayores.
 *   - Los tres primeros se piden EN PARALELO; después, al empezar a sonar el
 *     trozo i se pide el i+3. Así siempre hay margen sin pagar por audio que
 *     quizá nunca suene (si interrumpes, se desperdician 2 trozos como mucho).
 *   - Cortes SIEMPRE en final de frase: la costura es un cambio de entonación,
 *     no un tajo. Con la cama sonando debajo, apenas se percibe.
 *
 * Efecto lateral bueno: cada trozo es pequeño, así que el round-trip base64 →
 * WAV (que en el monolito costaba ~1 s de hilo JS bloqueado) baja a ~100 ms.
 */

export type TtsEndReason = 'natural' | 'error' | 'stopped';

const DEFAULT_VOICE = 'Kore';

/** Objetivo de caracteres por trozo: rampa creciente, luego régimen estable. */
const TTS_CHUNK_TARGETS = [150, 320, 480];
const TTS_CHUNK_TARGET_STEADY = 560;
/** Una cola más corta que esto se fusiona con el trozo anterior (no vale una llamada). */
const TTS_CHUNK_MIN_TAIL = 80;
/** Trozos pedidos por delante del que suena. */
const PREFETCH_DEPTH = 3;

let activePlayer: AudioPlayer | null = null;
let speechActive = false;
/** Cada stop/arranque invalida las continuaciones en vuelo de la cola. */
let playbackGeneration = 0;
/** Resuelve el `playOne` en curso cuando se corta desde fuera. */
let cancelActivePlay: (() => void) | null = null;

/**
 * Trocea el texto en límites de frase con objetivos crecientes.
 * Función pura — con tests en el scratchpad del proyecto.
 */
export function splitIntoTtsChunks(text: string): string[] {
  const t = text.trim();
  if (!t) return [];

  const boundary = /[.!?…]+["»)\]]?(?:\s+|$)/g;
  const ends: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(t))) ends.push(m.index + m[0].length);
  if (ends.length === 0 || ends[ends.length - 1] < t.length) ends.push(t.length);

  const chunks: string[] = [];
  let start = 0;
  for (const end of ends) {
    const target = TTS_CHUNK_TARGETS[chunks.length] ?? TTS_CHUNK_TARGET_STEADY;
    if (end - start >= target) {
      const piece = t.slice(start, end).trim();
      if (piece) chunks.push(piece);
      start = end;
    }
  }
  const rest = t.slice(start).trim();
  if (rest) {
    if (rest.length < TTS_CHUNK_MIN_TAIL && chunks.length > 0) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${rest}`.trim();
    } else {
      chunks.push(rest);
    }
  }
  return chunks.length > 0 ? chunks : [t];
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
  cancelActivePlay?.();
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

/** Los WAV de un paseo largo son decenas de MB: se tiran en cuanto suenan. */
function discardAudioFile(uri: string): void {
  void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

/** Reproduce un archivo. Resuelve 'ended' al terminar, 'cancelled' si se cortó. */
function playOne(uri: string, gen: number, onError: () => void): Promise<'ended' | 'cancelled'> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: 'ended' | 'cancelled') => {
      if (settled) return;
      settled = true;
      cancelActivePlay = null;
      resolve(r);
    };
    // Sin esto, un corte desde fuera dejaría esta promesa colgada para siempre
    // (pause+remove NO emite didJustFinish).
    cancelActivePlay = () => settle('cancelled');
    try {
      const player = createAudioPlayer({ uri });
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
          settle(gen === playbackGeneration ? 'ended' : 'cancelled');
        }
      });
      player.play();
    } catch {
      onError();
      settle('cancelled');
    }
  });
}

export type PlayDissertationOptions = {
  /**
   * Se llama cuando el audio del PRIMER trozo ya está listo para sonar (o justo
   * antes de la voz de emergencia). Aquí es donde el chrome pisa el recap, baja
   * la cama y da el bip: antes se hacía al llegar el TEXTO y se dejaban ~12-15 s
   * de silencio esperando la síntesis. Devolver `false` cancela la reproducción
   * (el usuario pre-saltó la respuesta mientras se sintetizaba).
   */
  onSpeechAboutToStart?: () => Promise<boolean> | boolean;
  /**
   * Primer trozo YA lanzado a sintetizar mientras el interlocutor seguía
   * escribiendo (ver `onInterlocutorSentence` del pipeline). Su síntesis, que son
   * ~11 s, se solapa con la generación del resto del texto en vez de empezar
   * cuando el texto está completo.
   *
   * `text` fuerza el primer trozo del troceado para que el audio precalentado
   * corresponda exactamente; si no encaja con el inicio del texto final, se
   * descarta y se trocea normal.
   */
  prewarm?: { text: string; job: Promise<TtsResult> };
};

export async function playDissertationTts(
  text: string,
  onPlaybackFinished: (reason: TtsEndReason) => void,
  opts?: PlayDissertationOptions
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

  // Limpia cualquier reproducción previa y fija la generación de ESTA respuesta:
  // cualquier corte externo posterior la invalida, también durante la síntesis.
  await stopActiveTtsPlayback();
  const gen = playbackGeneration;

  // Si hay un primer trozo precalentado y encaja con el inicio del texto final,
  // se respeta tal cual y se reutiliza su audio; si no encaja (el modelo cambió de
  // idea a mitad), se tira y se trocea como siempre.
  const pre = opts?.prewarm;
  const usePrewarm = !!pre && pre.text.length > 0 && trimmed.startsWith(pre.text);
  const chunks = usePrewarm
    ? [pre!.text, ...splitIntoTtsChunks(trimmed.slice(pre!.text.length))]
    : splitIntoTtsChunks(trimmed);

  const jobs: (Promise<TtsResult> | null)[] = chunks.map(() => null);
  if (usePrewarm) jobs[0] = pre!.job;
  const ensureJob = (i: number) => {
    if (i < 0 || i >= chunks.length) return;
    if (!jobs[i]) jobs[i] = synthesizeWithGemini({ apiKey, text: chunks[i], voiceName });
  };
  for (let i = 0; i < Math.min(PREFETCH_DEPTH, chunks.length); i++) ensureJob(i);

  const first = await jobs[0]!;
  if (gen !== playbackGeneration) return;

  const gate = async (): Promise<boolean> => {
    const go = (await opts?.onSpeechAboutToStart?.()) ?? true;
    return go && gen === playbackGeneration;
  };

  if (!first.ok) {
    if (!settings.ttsEmergencyFallback) {
      finish('error');
      return;
    }
    if (!(await gate())) {
      finish('stopped');
      return;
    }
    speakWithSystemVoice(trimmed, finish);
    return;
  }

  if (!(await gate())) {
    finish('stopped');
    return;
  }

  await setPlaybackAudioMode();
  if (gen !== playbackGeneration) return;

  for (let i = 0; i < chunks.length; i++) {
    ensureJob(i);
    const res = await jobs[i]!;
    if (gen !== playbackGeneration) return;

    if (!res.ok) {
      // Un trozo caído a mitad: seguir con la voz del sistema desde AQUÍ, no
      // repetir lo ya escuchado.
      const rest = chunks.slice(i).join(' ');
      if (settings.ttsEmergencyFallback) speakWithSystemVoice(rest, finish);
      else finish('error');
      return;
    }

    // Rellenar la nevera al empezar a sonar este trozo.
    ensureJob(i + PREFETCH_DEPTH);

    const outcome = await playOne(res.audioUri, gen, () => finish('error'));
    discardAudioFile(res.audioUri);
    if (outcome === 'cancelled') return;
  }

  finish('natural');
}
