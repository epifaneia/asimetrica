/**
 * Colchón sonoro que cubre el hueco entre el fin del recap y la llegada de la
 * respuesta larga. Sin él el diseño no llega: si el recap cubre ~40 s y el
 * analista tarda 60-70, quedan 20-30 s de silencio descubiertos.
 *
 * Asset OPCIONAL e INTERCAMBIABLE. Mientras valga `null` simplemente no suena
 * nada y todo lo demás (recap, skip, pisada de la respuesta) funciona igual.
 *
 * OJO LICENCIAS: el mp3 actual es música con derechos (prueba personal) y está
 * EXCLUIDO de git (.gitignore). NO puede viajar a una build comercial. En un
 * clon fresco sin el archivo, Metro fallará en este require: o repones el mp3
 * o vuelves a dejar la constante en `null`.
 */
export const AMBIENT_LOOP_SOURCE: number | null = require('../assets/sounds/ambient_loop.mp3');

/** Volumen del colchón. Bajo a propósito: paseas por la calle, no te aísles del tráfico. */
export const AMBIENT_LOOP_VOLUME = 0.32;
