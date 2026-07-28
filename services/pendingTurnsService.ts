import * as FileSystem from 'expo-file-system/legacy';

import { resolveConversadorSystemPrompt } from '@/lib/conversador-profile';
import { runGeminiDissertationPipeline } from '@/services/geminiPipelineService';
import { buildLibraryContext } from '@/services/libraryRetrieval';
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

type ProcessOneResult = { ok: boolean; docId: string | null };

async function processOne(apiKey: string, turn: PendingTurn): Promise<ProcessOneResult> {
  const info = await FileSystem.getInfoAsync(turn.audioUri).catch(() => null);
  if (!info?.exists) {
    // audio desaparecido (limpieza del SO): el pendiente ya no es recuperable
    usePendingTurnsStore.getState().removePending(turn.id);
    return { ok: false, docId: null };
  }

  const settings = useUserSettingsStore.getState();
  const fastMode = settings.pipelineMode === 'rapido';

  const tr = await transcribeAudioWithGemini({
    apiKey,
    fileUri: turn.audioUri,
    sanitize: fastMode,
  });
  if (!tr.ok) return { ok: false, docId: null };

  const folders = useFoldersStore.getState();
  let docId = turn.docId;
  const history = docId
    ? folders.dissertations.find((d) => d.id === docId)?.messages ?? []
    : [];

  const interlocutorPrompt = resolveConversadorSystemPrompt(
    turn.profile,
    settings.conversadorProfiles
  );

  // Un turno recuperado de la bandeja tiene que salir con la MISMA jaula que si
  // hubiera ido en directo: si no, el turno rescatado ignoraría el canon del autor.
  const libFolderId = docId
    ? folders.dissertations.find((d) => d.id === docId)?.folderId ?? null
    : turn.folderId;
  const libCtx = await buildLibraryContext({
    apiKey,
    folderId: libFolderId,
    queryText: tr.text,
    previousUserText: [...history].reverse().find((m) => m.role === 'user')?.content,
  });

  const result = await runGeminiDissertationPipeline({
    apiKey,
    rawUserText: tr.text,
    history,
    profile: turn.profile,
    interlocutorSystemPrompt: interlocutorPrompt,
    closingMode: turn.closingMode,
    fastMode,
    libraryBlock: libCtx.block,
  });
  if (!result.ok) return { ok: false, docId: null };

  if (docId) {
    folders.appendDissertationUserMessage(docId, result.sanitizedUser);
    folders.appendDissertationAssistantMessage(docId, result.finalReply);
  } else {
    const folderId =
      turn.folderId ??
      [...folders.folders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ??
      null;
    if (!folderId) return { ok: false, docId: null };
    docId = folders.addDissertationWithAiExchange(folderId, result.sanitizedUser, result.finalReply);
    if (!docId) return { ok: false, docId: null };
  }

  await deletePendingAudio(turn.audioUri);
  usePendingTurnsStore.getState().removePending(turn.id);
  return { ok: true, docId };
}

/** Reprocesa toda la bandeja en orden de llegada. Secuencial: mismo doc, mismo orden. */
export async function processPendingTurns(apiKey: string): Promise<PendingProcessResult> {
  const turns = [...usePendingTurnsStore.getState().pending].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  let processed = 0;
  let failed = 0;
  for (const turn of turns) {
    const res = await processOne(apiKey, turn);
    if (res.ok) processed++;
    else failed++;
  }
  return { processed, failed };
}

/**
 * «Corto» sin esperar: el último latido del perfil se genera en BACKGROUND y la
 * sesión se cierra al instante.
 *
 * Antes, pulsar Corto dejaba la pantalla negra ~40 s (pipeline completo con Pro)
 * antes de salir, y parecía que la app se había colgado justo en el gesto de
 * irse. Ahora sales del tirón y la respuesta final aterriza sola en la carpeta.
 *
 * El turno se ENCOLA en la bandeja de pendientes ANTES de arrancar, con su audio
 * ya en almacenamiento persistente. Así:
 *   - si el pipeline falla → se queda en la bandeja para reintentar (nada se pierde),
 *   - si la app MUERE a mitad → sigue en la bandeja al reabrir,
 *   - si va bien → `processOne` lo saca de la bandeja y borra el audio.
 */
export async function runClosingTurnDetached(params: {
  apiKey: string;
  /** Audio recién grabado, todavía en cache. */
  audioUri: string;
  profile: PendingTurn['profile'];
  docId: string | null;
  folderId: string | null;
  /** Se llama solo si el cierre aterrizó bien (para título y auto-export). */
  onLanded?: (docId: string) => void;
}): Promise<void> {
  const store = usePendingTurnsStore.getState();

  const preserved = await preservePendingAudio(params.audioUri);
  if (!preserved) return; // sin sitio persistente no hay cierre recuperable

  const id = store.addPending({
    audioUri: preserved,
    profile: params.profile,
    docId: params.docId,
    folderId: params.folderId,
    closingMode: true,
  });
  const turn = usePendingTurnsStore.getState().pending.find((t) => t.id === id);
  if (!turn) return;

  store.beginClosingTurn();
  try {
    const res = await processOne(params.apiKey, turn);
    if (res.ok && res.docId) params.onLanded?.(res.docId);
  } finally {
    usePendingTurnsStore.getState().endClosingTurn();
  }
}
