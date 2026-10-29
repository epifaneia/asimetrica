/**
 * Colchón sonoro que cubre el hueco entre el fin del recap y la llegada de la
 * respuesta larga. Sin él el diseño no llega: si el recap cubre ~40 s y el
 * analista tarda 60-70, quedan 20-30 s de silencio descubiertos.
 *
 * Asset OPCIONAL e INTERCAMBIABLE. Mientras valga `null` simplemente no suena
 * nada y todo lo demás (recap, skip, pisada de la respuesta) funciona igual.
 *
 * Licencia: pista generada con DaVinci AI, uso personal y creativo (ver
 * CREDITS.md). Para una versión comercial hay que cambiarla por una con licencia
 * comercial explícita, o dejar la constante en `null`.
 */
export const AMBIENT_LOOP_SOURCE: number | null = require('../assets/sounds/ambient_loop.mp3');

/**
 * Niveles del colchón. El reproductor NO se para nunca durante la sesión: solo
 * sube y baja de volumen con rampas. Así no hay escalón — y los huecos de
 * síntesis (que son de 10-20 s, medidos) dejan de parecer una avería y pasan a
 * ser silencios musicales.
 *
 * Bajo a propósito en todos los casos: paseas por la calle, no te aísles del
 * tráfico.
 */
/** Mientras grabas: a cero. El micro está abierto (la música se cuela en el STT)
 *  y es tu momento de pensar; la ausencia de colchón dice "te toca". */
export const AMBIENT_LEVEL_MIC = 0;
/** Bajo la voz (recap o respuesta): cama de radio. */
export const AMBIENT_LEVEL_UNDER_VOICE = 0.13;
/** Esperando sin voz: el colchón es el único "estoy vivo". */
export const AMBIENT_LEVEL_WAITING = 0.32;
/** Duración de las rampas de volumen: un salto seco también hace escalón. */
export const AMBIENT_RAMP_MS = 450;
