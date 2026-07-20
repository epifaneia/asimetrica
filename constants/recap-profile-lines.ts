import type { AiProfileId } from '@/lib/conversador-profile';

/**
 * Enunciado determinista que ABRE el recap de espera activa.
 *
 * Va primero a propósito: el perfil es lo más caro de equivocar (si elegiste
 * «Auditar» queriendo «Expandir», enterarte en el segundo 40 —tras tragarte los
 * bullets— es para tirar el móvil; enterarte en el segundo 2 es un aborto limpio).
 * Criterio general del orden: primero lo más barato de verificar y más
 * consecuente si está mal.
 *
 * Es texto FIJO: cero tokens, cero latencia, cero red. Suena mientras el modelo
 * todavía está generando las anclas y los bullets.
 */
export const RECAP_PROFILE_LINES: Record<AiProfileId, string> = {
  creativo: 'Expandir. Vamos a ampliar lo que has dicho y abrir ramificaciones.',
  auditor: 'Auditar. Vamos a contrastar lo que has dicho y buscar los huecos.',
  sistemico: 'Sistémico. Vamos a ver cómo encaja lo que has dicho en el conjunto.',
  destilador: 'Destilar. Vamos a condensar lo que has dicho hasta el núcleo.',
};
