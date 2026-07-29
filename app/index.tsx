import { useGlobalVoiceChromeBottomInset } from '@/components/global-voice-chrome';
import { useVoiceRouteRegistration } from '@/hooks/useVoiceRouteRegistration';
import { DarkActionSheet, DarkCenterDialog } from '@/components/dark-sheets';
import { FolderNameModal } from '@/components/folder-name-modal';
import {
  compileFolderForNotebookLm,
  exportFolderAsIndividualDocs,
} from '@/services/googleDocsExport';
import { ensureGoogleAccessToken } from '@/services/googleOAuthFlow';
import { processPendingTurns, processResearchJobs } from '@/services/pendingTurnsService';
import {
  getAllDissertationsInTree,
  useFoldersStore,
  type Folder,
} from '@/stores/folders-store';
import { usePendingTurnsStore, type ActiveSessionMark } from '@/stores/pending-turns-store';
import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** OLED-adjacent carbón: oscuro sin ser negro puro (#000 reservado al Modo Campo). */
const BG_CHARCOAL = '#0c0c0c';
const CARD_BG = '#111111';
const CARD_BORDER = '#242424';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#5c5c5c';
const ICON_FOLDER = '#4a4a46';
/** Ámbar militar / táctico */
const ACCENT_AMBER = '#c9a227';
/** Long press al estilo Android (~400 ms). */
const FOLDER_LONG_PRESS_MS = 425;

/** Hueco “barrera” entre zona de grid y dock (no mezclar tarjetas con FAB). */
const DOCK_BARRIER_GAP = 22;

/**
 * Viewport del grid: exactamente 3 filas × 2 columnas = 6 celdas visibles; el scroll ocurre solo aquí.
 * Alineado con folderCardInner minHeight 108 + gridRow marginBottom 12.
 */
const GRID_CONTENT_TOP_PAD = 4;
const CARD_ROW_HEIGHT = 108;
const GRID_ROW_GAP = 12;
const VISIBLE_GRID_ROWS = 3;
const GRID_VIEWPORT_HEIGHT =
  GRID_CONTENT_TOP_PAD +
  VISIBLE_GRID_ROWS * CARD_ROW_HEIGHT +
  (VISIBLE_GRID_ROWS - 1) * GRID_ROW_GAP +
  8;

const ADD_CARD_ID = '__add_folder__';

type GridItem =
  | ({ cell: 'folder' } & Folder)
  | { cell: 'add'; id: typeof ADD_CARD_ID };

function folderCardMeta(count: number) {
  return `${count} disertación${count === 1 ? '' : 'es'}`;
}

function sortFoldersByUpdatedAt(folders: Folder[]): Folder[] {
  return [...folders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export default function StudyDashboardScreen() {
  useVoiceRouteRegistration('dashboard');
  const voiceChromeBottom = useGlobalVoiceChromeBottomInset();
  const [hydrated, setHydrated] = useState(() => useFoldersStore.persist.hasHydrated());

  const folders = useFoldersStore((s) => s.folders);
  const allDissertations = useFoldersStore((s) => s.dissertations);
  const addFolder = useFoldersStore((s) => s.addFolder);
  const renameFolder = useFoldersStore((s) => s.renameFolder);
  const removeFolder = useFoldersStore((s) => s.removeFolder);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'rename'>('create');
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  const [folderActionsFor, setFolderActionsFor] = useState<Folder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Folder | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; message: string } | null>(null);

  // --- Resiliencia de campo: bandeja de pendientes + recuperación de crash ---
  const pendingCount = usePendingTurnsStore((s) => s.pending.length);
  const closingInFlight = usePendingTurnsStore((s) => s.closingInFlight);
  const researchCount = usePendingTurnsStore((s) => s.research.length);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [recoveryMark, setRecoveryMark] = useState<ActiveSessionMark | null>(null);

  // Onboarding de primer arranque: sin API key no hay producto — guiar a Ajustes.
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  useEffect(() => {
    const check = () => {
      const s = useUserSettingsStore.getState();
      if (!resolveGoogleApiKey(s.googleApiKey)) setOnboardingVisible(true);
    };
    if (useUserSettingsStore.persist.hasHydrated()) {
      check();
      return;
    }
    return useUserSettingsStore.persist.onFinishHydration(check);
  }, []);

  // Solo en arranque en frío: si quedó sello de sesión activa, la app murió a mitad.
  useEffect(() => {
    const check = () => {
      const mark = usePendingTurnsStore.getState().activeSession;
      if (mark) setRecoveryMark(mark);
    };
    if (usePendingTurnsStore.persist.hasHydrated()) {
      check();
      return;
    }
    return usePendingTurnsStore.persist.onFinishHydration(check);
  }, []);

  // --- Compilar TODA la biblioteca para NotebookLM (Drive-céntrico) ---
  const [compileAllConfirm, setCompileAllConfirm] = useState(false);
  const [compileAllBusy, setCompileAllBusy] = useState(false);

  // --- Export por carpeta: un Doc por disertación; puede tardar → progreso visible ---
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(
    null
  );

  const handleCompileAll = async () => {
    setCompileAllConfirm(false);
    const all = [...useFoldersStore.getState().dissertations].sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt)
    );
    if (all.length === 0) {
      setInfoModal({ title: 'Sin contenido', message: 'Aún no hay disertaciones que compilar.' });
      return;
    }
    setCompileAllBusy(true);
    try {
      const token = await ensureGoogleAccessToken();
      if (!token) return;
      const { webUrl } = await compileFolderForNotebookLm({
        accessToken: token,
        folderName: 'Biblioteca completa',
        dissertations: all,
      });
      await WebBrowser.openBrowserAsync(webUrl);
      setInfoModal({
        title: 'Biblioteca compilada',
        message: `${all.length} disertaciones subidas a tu Drive en un único documento. Pégalo como fuente en NotebookLM.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setInfoModal({ title: 'Error al compilar', message: msg });
    } finally {
      setCompileAllBusy(false);
    }
  };

  const handleReprocessPending = async () => {
    const apiKey = resolveGoogleApiKey(useUserSettingsStore.getState().googleApiKey);
    if (!apiKey) {
      setInfoModal({ title: 'API Key', message: 'Configura tu clave de Google en Ajustes para reprocesar.' });
      return;
    }
    setPendingBusy(true);
    try {
      const { processed, failed } = await processPendingTurns(apiKey);
      setInfoModal({
        title: 'Turnos pendientes',
        message:
          failed === 0
            ? `${processed} turno${processed === 1 ? '' : 's'} recuperado${processed === 1 ? '' : 's'} e incorporado${processed === 1 ? '' : 's'} a sus conversaciones.`
            : `${processed} recuperados; ${failed} siguen pendientes (¿hay red?). Puedes reintentar cuando quieras.`,
      });
    } finally {
      setPendingBusy(false);
    }
  };

  useEffect(() => {
    if (hydrated) return;
    const unsub = useFoldersStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    useFoldersStore.getState().ensureExampleFoldersIfEmpty();
  }, [hydrated]);

  /**
   * Investigaciones profundas en vuelo: se sondean al abrir el dashboard y cada
   * medio minuto mientras esté delante. El agente tarda minutos y su id está
   * persistido, así que esto es lo que hace que el informe aterrice aunque hayas
   * cerrado la app entre medias.
   */
  useEffect(() => {
    if (researchCount === 0) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const key = resolveGoogleApiKey(useUserSettingsStore.getState().googleApiKey);
      if (key) void processResearchJobs(key);
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [researchCount]);

  const listShellPaddingBottom = voiceChromeBottom + DOCK_BARRIER_GAP;

  // Solo carpetas raíz (las auto-clusters viven anidadas en otras carpetas).
  const rootFolders = useMemo(
    () => folders.filter((f) => !f.parentFolderId && f.kind === 'user'),
    [folders]
  );
  const sortedFolders = useMemo(() => sortFoldersByUpdatedAt(rootFolders), [rootFolders]);

  // Conteo REAL de disertaciones por carpeta raíz (árbol completo, sub-clusters incluidos).
  const dissertationCountByFolder = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of sortedFolders) {
      counts[f.id] = getAllDissertationsInTree(folders, allDissertations, f.id).length;
    }
    return counts;
  }, [sortedFolders, folders, allDissertations]);

  const gridData: GridItem[] = useMemo(
    () => [
      ...sortedFolders.map((f) => ({ cell: 'folder' as const, ...f })),
      { cell: 'add' as const, id: ADD_CARD_ID },
    ],
    [sortedFolders]
  );

  const openCreateModal = () => {
    setModalMode('create');
    setRenameTarget(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setRenameTarget(null);
  };

  const folderMenuOptions = useMemo(() => {
    if (!folderActionsFor) return [];
    const f = folderActionsFor;
    return [
      {
        key: 'rename',
        label: 'Renombrar',
        onPress: () => {
          setModalMode('rename');
          setRenameTarget({ id: f.id, name: f.name });
          setModalOpen(true);
        },
      },
      {
        key: 'compile',
        label: 'Compilar para NotebookLM',
        onPress: async () => {
          const folder = folderActionsFor;
          setFolderActionsFor(null);
          if (!folder) return;
          try {
            const token = await ensureGoogleAccessToken();
            if (!token) return;
            const allDocs = getAllDissertationsInTree(
              useFoldersStore.getState().folders,
              useFoldersStore.getState().dissertations,
              folder.id
            );
            if (allDocs.length === 0) {
              setInfoModal({
                title: 'Sin contenido',
                message: 'Esta carpeta no tiene disertaciones para compilar.',
              });
              return;
            }
            const { webUrl } = await compileFolderForNotebookLm({
              accessToken: token,
              folderName: folder.name,
              dissertations: allDocs,
            });
            await WebBrowser.openBrowserAsync(webUrl);
            setInfoModal({
              title: 'Compilación creada',
              message: 'Subido a tu Drive. Pégalo como fuente en NotebookLM.',
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setInfoModal({ title: 'Error al compilar', message: msg });
          }
        },
      },
      {
        key: 'export',
        label: 'Exportar a Google Docs (un Doc por conversación)',
        onPress: async () => {
          const folder = folderActionsFor;
          setFolderActionsFor(null);
          if (!folder) return;
          try {
            const token = await ensureGoogleAccessToken();
            if (!token) return;
            const allDocs = getAllDissertationsInTree(
              useFoldersStore.getState().folders,
              useFoldersStore.getState().dissertations,
              folder.id
            );
            if (allDocs.length === 0) {
              setInfoModal({
                title: 'Sin contenido',
                message: 'Esta carpeta no tiene disertaciones para exportar.',
              });
              return;
            }
            setExportProgress({ done: 0, total: allDocs.length });
            const { folderUrl, exported, failedTitles } = await exportFolderAsIndividualDocs({
              accessToken: token,
              folderName: folder.name,
              dissertations: allDocs,
              onProgress: (done, total) => setExportProgress({ done, total }),
            });
            await WebBrowser.openBrowserAsync(folderUrl);
            setInfoModal({
              title: 'Exportación completada',
              message:
                failedTitles.length === 0
                  ? `${exported} documento${exported === 1 ? '' : 's'} creado${exported === 1 ? '' : 's'} en una carpeta de tu Drive.`
                  : `${exported} creados; fallaron ${failedTitles.length}: ${failedTitles.join(', ')}. Puedes reintentar cuando quieras.`,
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setInfoModal({ title: 'Error al exportar', message: msg });
          } finally {
            setExportProgress(null);
          }
        },
      },
      {
        key: 'delete',
        label: 'Eliminar',
        destructive: true,
        onPress: () => setDeleteTarget(f),
      },
    ];
  }, [folderActionsFor]);

  const handleNameSubmit = (name: string) => {
    if (!name) {
      setInfoModal({ title: 'Nombre vacío', message: 'Escribe un nombre para continuar.' });
      return false;
    }
    if (modalMode === 'create') {
      const ok = addFolder(name);
      if (!ok) {
        setInfoModal({ title: 'Nombre inválido', message: 'El nombre no puede estar vacío.' });
        return false;
      }
      return true;
    }
    if (renameTarget) {
      const ok = renameFolder(renameTarget.id, name);
      if (!ok) {
        setInfoModal({ title: 'Nombre inválido', message: 'El nombre no puede estar vacío.' });
        return false;
      }
      return true;
    }
    return false;
  };

  const androidRipple =
    Platform.OS === 'android' ? { color: 'rgba(255,255,255,0.12)', borderless: false } : undefined;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeTop} edges={['top']}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Asimétrica</Text>
          <Pressable
            onPress={() => router.push('/search')}
            style={({ pressed }) => [styles.headerIconHit, pressed && styles.headerIconPressed]}
            accessibilityRole="button"
            accessibilityLabel="Buscar"
          >
            <Ionicons name="search-outline" size={24} color={TEXT_PRIMARY} />
          </Pressable>
          <Pressable
            onPress={() => setCompileAllConfirm(true)}
            style={({ pressed }) => [styles.headerIconHit, pressed && styles.headerIconPressed]}
            accessibilityRole="button"
            accessibilityLabel="Compilar toda la biblioteca para NotebookLM"
          >
            <Ionicons name="cloud-upload-outline" size={24} color={TEXT_PRIMARY} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            style={({ pressed }) => [styles.headerIconHit, pressed && styles.headerIconPressed]}
            accessibilityRole="button"
            accessibilityLabel="Ajustes"
          >
            <Ionicons name="cog-outline" size={26} color={TEXT_PRIMARY} />
          </Pressable>
        </View>

        {exportProgress ? (
          <View style={styles.pendingBanner}>
            <ActivityIndicator size="small" color={ACCENT_AMBER} />
            <Text style={styles.pendingBannerText}>
              {`Exportando a Google Docs… ${exportProgress.done}/${exportProgress.total}`}
            </Text>
          </View>
        ) : null}

        {/* Corto salió del tirón: el último latido sigue generándose en background.
            Sin este aviso, la conversación parecería haberse cerrado sin respuesta. */}
        {closingInFlight > 0 ? (
          <View style={styles.pendingBanner}>
            <ActivityIndicator size="small" color={ACCENT_AMBER} />
            <Text style={styles.pendingBannerText}>
              Cerrando conversación… la última respuesta aterriza sola
            </Text>
          </View>
        ) : null}

        {/* Investigación profunda: tarda minutos y su id está persistido, así que
            esto sigue ahí aunque hayas cerrado la app entre medias. */}
        {researchCount > 0 ? (
          <View style={styles.pendingBanner}>
            <ActivityIndicator size="small" color={ACCENT_AMBER} />
            <Text style={styles.pendingBannerText}>
              {researchCount === 1
                ? 'Investigando… el informe irá a la biblioteca de su carpeta'
                : `${researchCount} investigaciones en marcha… los informes irán a sus carpetas`}
            </Text>
          </View>
        ) : null}

        {pendingCount - closingInFlight > 0 ? (
          <Pressable
            style={({ pressed }) => [styles.pendingBanner, pressed && styles.pendingBannerPressed]}
            disabled={pendingBusy}
            onPress={() => void handleReprocessPending()}
            accessibilityRole="button"
            accessibilityLabel="Reprocesar turnos de voz pendientes"
          >
            {pendingBusy ? (
              <ActivityIndicator size="small" color={ACCENT_AMBER} />
            ) : (
              <Ionicons name="cloud-upload-outline" size={18} color={ACCENT_AMBER} />
            )}
            <Text style={styles.pendingBannerText}>
              {pendingBusy
                ? 'Reprocesando turnos pendientes…'
                : `${pendingCount - closingInFlight} turno${pendingCount - closingInFlight === 1 ? '' : 's'} de voz sin procesar — tocar para recuperar`}
            </Text>
          </Pressable>
        ) : null}

        <View style={[styles.listShell, { paddingBottom: listShellPaddingBottom }]}>
          {hydrated ? (
            <View style={[styles.gridViewport, { height: GRID_VIEWPORT_HEIGHT }]}>
              <FlatList
                style={styles.gridList}
                data={gridData}
                keyExtractor={(item) => item.id}
                numColumns={2}
                scrollEnabled
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                columnWrapperStyle={styles.gridRow}
                contentContainerStyle={styles.gridContent}
                renderItem={({ item }) =>
                  item.cell === 'add' ? (
                    <Pressable
                      style={({ pressed }) => [styles.folderCard, styles.addCard, pressed && styles.addCardPressed]}
                      onPress={openCreateModal}
                      android_ripple={androidRipple}
                      accessibilityRole="button"
                      accessibilityLabel="Crear nueva carpeta"
                    >
                      <View style={[styles.folderCardInner, styles.addCardInner]}>
                        <Ionicons name="add" size={56} color={ACCENT_AMBER} />
                        <Text style={styles.addCardHint}>Nueva carpeta</Text>
                      </View>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.folderCard, pressed && styles.folderCardPressed]}
                      onPress={() =>
                        router.push({ pathname: '/folder/[id]', params: { id: item.id } })
                      }
                      onLongPress={() => setFolderActionsFor(item)}
                      delayLongPress={FOLDER_LONG_PRESS_MS}
                      android_ripple={androidRipple}
                      accessibilityRole="button"
                      accessibilityLabel={`Carpeta ${item.name}, ${folderCardMeta(dissertationCountByFolder[item.id] ?? 0)}`}
                    >
                      <View style={styles.folderCardInner}>
                        <Ionicons name="folder-outline" size={22} color={ICON_FOLDER} style={styles.folderIcon} />
                        <Text style={styles.folderTitle} numberOfLines={2}>
                          {item.name}
                        </Text>
                        <Text style={styles.folderMeta}>{folderCardMeta(dissertationCountByFolder[item.id] ?? 0)}</Text>
                      </View>
                    </Pressable>
                  )
                }
              />
            </View>
          ) : (
            <View style={styles.hydratePlaceholder}>
              <ActivityIndicator size="small" color={TEXT_MUTED} />
            </View>
          )}
        </View>
      </SafeAreaView>


      <FolderNameModal
        visible={modalOpen}
        title={modalMode === 'create' ? 'Nueva carpeta' : 'Renombrar carpeta'}
        initialValue={modalMode === 'rename' && renameTarget ? renameTarget.name : ''}
        confirmLabel={modalMode === 'create' ? 'Crear' : 'Guardar'}
        onClose={closeModal}
        onSubmit={handleNameSubmit}
      />

      <DarkActionSheet
        visible={folderActionsFor !== null}
        title={folderActionsFor?.name ?? ''}
        options={folderMenuOptions}
        onClose={() => setFolderActionsFor(null)}
      />

      <DarkCenterDialog
        visible={deleteTarget !== null}
        title="Eliminar carpeta"
        message={
          deleteTarget
            ? `¿Seguro que quieres eliminar «${deleteTarget.name}»? Esta acción no se puede deshacer.`
            : ''
        }
        secondaryLabel="Cancelar"
        primaryLabel="Eliminar"
        primaryDestructive
        onSecondary={() => setDeleteTarget(null)}
        onPrimary={() => {
          if (deleteTarget) removeFolder(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onRequestClose={() => setDeleteTarget(null)}
      />

      <DarkCenterDialog
        visible={infoModal !== null}
        title={infoModal?.title ?? ''}
        message={infoModal?.message ?? ''}
        primaryLabel="Entendido"
        onPrimary={() => setInfoModal(null)}
        onRequestClose={() => setInfoModal(null)}
      />

      <DarkCenterDialog
        visible={onboardingVisible}
        title="Bienvenido a Asimétrica"
        message={
          'Piensa en voz alta mientras paseas: graba, la IA responde por los auriculares y todo queda organizado en carpetas.\n\nPara empezar necesitas tu Google API Key (Gemini). Con auriculares DE CABLE, el botón del cable es «Cambio»; doble pulsación, «Corto».'
        }
        secondaryLabel="Más tarde"
        primaryLabel="Configurar API Key"
        onSecondary={() => setOnboardingVisible(false)}
        onPrimary={() => {
          setOnboardingVisible(false);
          router.push('/settings');
        }}
        onRequestClose={() => setOnboardingVisible(false)}
      />

      <DarkCenterDialog
        visible={compileAllConfirm}
        title="Compilar biblioteca"
        message="Se compilará TODO el contenido (todas las carpetas y conversaciones) en un único Google Doc listo para NotebookLM. ¿Continuar?"
        secondaryLabel="Cancelar"
        primaryLabel={compileAllBusy ? 'Compilando…' : 'Compilar todo'}
        onSecondary={() => setCompileAllConfirm(false)}
        onPrimary={() => void handleCompileAll()}
        onRequestClose={() => setCompileAllConfirm(false)}
      />

      <DarkCenterDialog
        visible={recoveryMark !== null}
        title="Sesión interrumpida"
        message={
          recoveryMark?.docId
            ? 'La última sesión de campo no se cerró correctamente. Todo lo hablado hasta el corte está guardado en su conversación.'
            : 'La última sesión de campo se interrumpió antes de completar el primer turno. Si el audio llegó a procesarse a medias, estará en la bandeja de pendientes.'
        }
        secondaryLabel={recoveryMark?.docId ? 'Descartar' : undefined}
        primaryLabel={recoveryMark?.docId ? 'Ver conversación' : 'Entendido'}
        onSecondary={() => {
          usePendingTurnsStore.getState().clearSessionMark();
          setRecoveryMark(null);
        }}
        onPrimary={() => {
          const docId = recoveryMark?.docId;
          usePendingTurnsStore.getState().clearSessionMark();
          setRecoveryMark(null);
          if (docId) {
            router.push({ pathname: '/document/[id]', params: { id: docId } });
          }
        }}
        onRequestClose={() => {
          usePendingTurnsStore.getState().clearSessionMark();
          setRecoveryMark(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG_CHARCOAL,
  },
  safeTop: {
    flex: 1,
    backgroundColor: BG_CHARCOAL,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: TEXT_PRIMARY,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT_AMBER,
    backgroundColor: 'rgba(201,162,39,0.08)',
  },
  pendingBannerPressed: {
    opacity: 0.8,
  },
  pendingBannerText: {
    flex: 1,
    fontSize: 13,
    color: ACCENT_AMBER,
    letterSpacing: 0.2,
  },
  headerIconHit: {
    padding: 10,
    marginRight: -6,
  },
  headerIconPressed: {
    opacity: 0.65,
  },
  listShell: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: 'flex-start',
  },
  gridViewport: {
    width: '100%',
    overflow: 'hidden',
  },
  gridList: {
    flex: 1,
  },
  hydratePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridContent: {
    paddingTop: GRID_CONTENT_TOP_PAD,
    paddingBottom: 6,
    flexGrow: 0,
  },
  gridRow: {
    gap: 12,
    marginBottom: GRID_ROW_GAP,
  },
  folderCard: {
    flex: 1,
    minWidth: 0,
    maxWidth: '50%',
    borderRadius: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  folderCardPressed: {
    opacity: 0.88,
    borderColor: '#353535',
  },
  addCard: {
    borderColor: '#4a4224',
    backgroundColor: '#12100a',
  },
  addCardPressed: {
    opacity: 0.9,
    borderColor: '#5c5228',
  },
  folderCardInner: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: CARD_ROW_HEIGHT,
    justifyContent: 'flex-start',
  },
  addCardInner: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: CARD_ROW_HEIGHT,
  },
  addCardHint: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
    letterSpacing: 0.2,
  },
  folderIcon: {
    marginBottom: 10,
    opacity: 0.9,
  },
  folderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
    lineHeight: 20,
    marginBottom: 6,
  },
  folderMeta: {
    fontSize: 12,
    color: TEXT_MUTED,
    letterSpacing: 0.15,
  },
});
