import * as FileSystem from 'expo-file-system/legacy';

import { resolveConversadorSystemPrompt } from '@/lib/conversador-profile';
import { runGeminiDissertationPipeline } from '@/services/geminiPipelineService';
import { transcribeAudioWithGemini } from '@/services/geminiTranscriptionService';
import { useFoldersStore } from '@/stores/folders-store';
import { usePendingTurnsStore, type PendingTurn } from '@/stores/pending-turns-store';
import { useUserSettingsStore } from '@/stores/user-settings-store';

/**
 * Bandeja de pendientes: reprocesa los turnos de voz que fallaron en campo.
 *
 * El audio original se conserva; aquí se transcribe y se corre el pipeline con
 * el historial ACTUAL de la disertación (la conversación pudo seguir después
 * del fallo: el turno recuperado se añade al final, no reescribe el pasado).
 * Solo se borra el .m4a cuando el turno quedó persistido con éxito.
 */

const PENDING_DIR = `${FileSystem.documentDirectory}pending-audio/`;

/** Mueve el audio de cache a almacenamiento persistente. Devuelve la URI nueva. */
export async function preservePendingAudio(cacheUri: string): Promise<string | null> {
  try {
    await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true }).catch(() => {});
    const name = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.m4a`;
    const dest = `${PENDING_DIR}${name}`;
    await FileSystem.moveAsync({ from: cacheUri, to: dest });
    return dest;
  } catch {
    return null; // sin sitio persistente no hay pendiente: se pierde como antes
  }
}

async function deletePendingAudio(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

export type PendingProcessResult = { processed: number; failed: number };

async function processOne(apiKey: string, turn: PendingTurn): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(turn.audioUri).catch(() => null);
  if (!info?.exists) {
    // audio desaparecido (limpieza del SO): el pendiente ya no es recuperable
    usePendingTurnsStore.getState().removePending(turn.id);
    return false;
  }

  const tr = await transcribeAudioWithGemini({ apiKey, fileUri: turn.audioUri });
  if (!tr.ok) return false;

  const folders = useFoldersStore.getState();
  let docId = turn.docId;
  const history = docId
    ? folders.dissertations.find((d) => d.id === docId)?.messages ?? []
    : [];

  const settings = useUserSettingsStore.getState();
  const interlocutorPrompt = resolveConversadorSystemPrompt(
    turn.profile,
    settings.conversadorProfiles
  );

  const result = await runGeminiDissertationPipeline({
    apiKey,
    rawUserText: tr.text,
    history,
    profile: turn.profile,
    interlocutorSystemPrompt: interlocutorPrompt,
    closingMode: turn.closingMode,
  });
  if (!result.ok) return false;

  if (docId) {
    folders.appendDissertationUserMessage(docId, result.sanitizedUser);
    folders.appendDissertationAssistantMessage(docId, result.finalReply);
  } else {
    const folderId =
      turn.folderId ??
      [...folders.folders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ??
      null;
    if (!folderId) return false;
    docId = folders.addDissertationWithAiExchange(folderId, result.sanitizedUser, result.finalReply);
    if (!docId) return false;
  }

  await deletePendingAudio(turn.audioUri);
  usePendingTurnsStore.getState().removePending(turn.id);
  return true;
}

/** Reprocesa toda la bandeja en orden de llegada. Secuencial: mismo doc, mismo orden. */
export async function processPendingTurns(apiKey: string): Promise<PendingProcessResult> {
  const turns = [...usePendingTurnsStore.getState().pending].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  let processed = 0;
  let failed = 0;
  for (const turn of turns) {
    const ok = await processOne(apiKey, turn);
    if (ok) processed++;
    else failed++;
  }
  return { processed, failed };
}
