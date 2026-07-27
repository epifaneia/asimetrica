import * as Speech from 'expo-speech';

import {
  AMBIENT_LEVEL_UNDER_VOICE,
  AMBIENT_LEVEL_WAITING,
} from '@/constants/ambient-asset';
import { RECAP_PROFILE_LINES } from '@/constants/recap-profile-lines';
import type { AiProfileId } from '@/lib/conversador-profile';

import { releaseAmbientBed, setAmbientLevel } from './ambientLoopService';
import { generateRecap } from './recapService';

/**
 * ESPERA ACTIVA — hilo corto, en paralelo al largo.
 *
 * Al pulsar Cambio arrancan dos cosas a la vez: el pipeline de siempre
 * (analista Pro + interlocutor + TTS) y este recap. El recap NO retrasa nada:
 * ocupa tiempo muerto que ya se estaba perdiendo. Si bloqueara al analista
 * habríamos alargado la espera en vez de taparla, que es justo lo contrario.
 *
 * Secuencia, ordenada por valor de aborto (lo más consecuente primero):
 *   1. Enunciado determinista del perfil — instantáneo, 0 tokens.
 *   2. Anclas — términos literales, verifican el STT.
 *   3. Bullets — las ideas, te re-anclan tras un monólogo largo.
 *   4. Colchón ambiente en bucle hasta que llegue la respuesta.
 *
 * Voz: `expo-speech` (TTS del sistema), no Gemini TTS. Es instantáneo, gratis y
 * offline — y que suene DISTINTO a la voz real es una ventaja: distingues al
 * instante "esto es la máquina confirmando" de "esto es la respuesta".
 *
 * POLÍTICA DE ENCUENTRO entre los dos hilos:
 *   - El largo llega primero → `preemptRecap()`: pisa y corta. Es el protagonista.
 *     OJO: el chrome solo pisa cuando el AUDIO de la respuesta ya está listo, no
 *     cuando el texto llega — la síntesis tarda ~12-15 s y antes se cortaba el
 *     recap para dejar ese hueco en silencio.
 *   - El corto acaba primero → la cama sube a nivel de espera hasta que llegue.
 *   - Pulsación simple durante el recap → `skipRecapSpeech()`: calla la voz y
 *     deja la cama. La espera se sigue cubriendo.
 *
 * La cama de fondo NO se para en ningún momento de la sesión (la posee el
 * chrome); aquí solo se mueve su nivel: bajo mientras hay voz, arriba al callar.
 */

/**
 * Token de generación. Cada cancelación lo incrementa, de modo que cualquier
 * callback en vuelo de `Speech` se detecta obsoleto y se descarta. Evita que un
 * `onDone` tardío reanude una secuencia ya cortada.
 */
let generation = 0;
/** El flujo posee el canal de audio (hablando o con colchón puesto). */
let active = false;
/**
 * Hay VOZ del recap sonando ahora mismo (no colchón). La distinción importa
 * para el botón: con voz, la pulsación simple significa "cállate"; con solo
 * colchón, recupera su significado clásico (saltar la respuesta que viene).
 */
let speaking = false;

export function isRecapActive(): boolean {
  return active;
}

export function isRecapSpeaking(): boolean {
  return speaking;
}

/** Habla una lista de frases en orden. Resuelve al terminar o al ser cancelada. */
function speakLines(lines: string[], gen: number): Promise<void> {
  return new Promise((resolve) => {
    const next = (i: number) => {
      if (gen !== generation) return resolve();
      if (i >= lines.length) return resolve();
      const text = lines[i].trim();
      if (!text) return next(i + 1);
      try {
        Speech.speak(text, {
          language: 'es-ES',
          rate: 1.0,
          onDone: () => {
            if (gen === generation) next(i + 1);
            else resolve();
          },
          // Cancelada desde fuera (skip, pisada o fin de sesión).
          onStopped: () => resolve(),
          // Un fallo puntual del TTS del sistema no debe abortar el recap entero.
          onError: () => {
            if (gen === generation) next(i + 1);
            else resolve();
          },
        });
      } catch {
        if (gen === generation) next(i + 1);
        else resolve();
      }
    };
    next(0);
  });
}

/**
 * Arranca el recap. Fire-and-forget: se llama en cuanto hay texto sanitizado,
 * justo antes de que el analista empiece a pensar.
 */
export async function startRecap(params: {
  apiKey: string;
  text: string;
  profile: AiProfileId;
}): Promise<void> {
  const gen = ++generation;
  active = true;
  speaking = true;

  try {
    // Cama a nivel de voz mientras el recap habla.
    setAmbientLevel(AMBIENT_LEVEL_UNDER_VOICE);
    // El enunciado del perfil suena YA, mientras el modelo genera anclas+bullets.
    const recapPromise = generateRecap({ apiKey: params.apiKey, text: params.text });

    await speakLines([RECAP_PROFILE_LINES[params.profile]], gen);
    if (gen !== generation) return;

    const recap = await recapPromise;
    if (gen !== generation) return;

    // Anclas en su propia locución (son la verificación del STT, merecen su
    // pausa), y los bullets FUNDIDOS en una sola: cada `Speech.speak` arranca y
    // para el motor, así que una viñeta por locución metía un micro-corte entre
    // cada idea y se oía a trompicones.
    const lines: string[] = [];
    if (recap.ok) {
      if (recap.anchors.length) lines.push(`Anclas. ${recap.anchors.join('. ')}.`);
      const bullets = recap.bullets.map((b) => b.replace(/[.\s]+$/, '')).filter(Boolean);
      if (bullets.length) lines.push(`${bullets.join('. ')}.`);
    }

    if (lines.length) {
      await speakLines(lines, gen);
      if (gen !== generation) return;
    }

    // Se acabó lo que había que decir: cama arriba hasta que llegue la respuesta.
    speaking = false;
    setAmbientLevel(AMBIENT_LEVEL_WAITING);
  } catch {
    // El recap es decorativo respecto al turno: si falla, el pipeline sigue.
    if (gen === generation) {
      speaking = false;
      setAmbientLevel(AMBIENT_LEVEL_WAITING);
    }
  }
}

/**
 * Pulsación simple durante el recap: calla la voz y salta al colchón.
 * No apaga el ambiente — lo que molesta es la charla, y la espera sigue ahí.
 */
export function skipRecapSpeech(): void {
  if (!active) return;
  generation++;
  speaking = false;
  try {
    Speech.stop();
  } catch {
    /* ignore */
  }
  setAmbientLevel(AMBIENT_LEVEL_WAITING);
}

/**
 * La respuesta larga ya está lista: pisa y corta. Devuelve `true` si había algo
 * sonando (para que el llamante emita el bip de aviso antes de hablar).
 */
export function preemptRecap(): boolean {
  if (!active) return false;
  stopRecapFlow();
  return true;
}

/**
 * Corta la voz del recap y cualquier callback en vuelo. NO toca la cama: su
 * nivel lo decide el chrome según la fase a la que se pase (mic a cero, voz de
 * la respuesta a nivel bajo). Así no hay escalón en la transición.
 */
export function stopRecapFlow(): void {
  generation++;
  active = false;
  speaking = false;
  try {
    Speech.stop();
  } catch {
    /* ignore */
  }
}

/** Fin de sesión: además de cortar, libera el reproductor de la cama. */
export function disposeRecap(): void {
  stopRecapFlow();
  releaseAmbientBed();
}
