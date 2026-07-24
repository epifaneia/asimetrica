import { useGlobalVoiceChromeBottomInset } from '@/components/global-voice-chrome';
import { useVoiceRouteRegistration } from '@/hooks/useVoiceRouteRegistration';
import { DarkActionSheet, DarkCenterDialog } from '@/components/dark-sheets';
import { FolderNameModal } from '@/components/folder-name-modal';
import { MergeDocumentsModal } from '@/components/merge-documents-modal';
import { MoveFolderPickerModal } from '@/components/move-folder-picker-modal';
import { NewDocumentModal } from '@/components/new-document-modal';
import { mergeDissertationsWithGemini } from '@/services/aiService';
import { generateContinuationSeed } from '@/services/continueFromService';
import {
  compileFolderForNotebookLm,
  exportDissertationToGoogleDoc,
} from '@/services/googleDocsExport';
import { ensureGoogleAccessToken } from '@/services/googleOAuthFlow';
import {
  AI_PROFILE_ORDER,
  resolveConversadorDisplayName,
} from '@/lib/conversador-profile';
import { goBackOrHome } from '@/lib/navigation';
import {
  getAllDissertationsInTree,
  getDirectChildFolders,
  useFoldersStore,
  type Dissertation,
  type Folder,
} from '@/stores/folders-store';
import { getActiveDocsForFolder, useLibraryStore } from '@/stores/library-store';
import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#0A0A0A';
const CARD_BG = '#111111';
const CARD_BORDER = '#242424';
const CLUSTER_BORDER = '#3a3424';
const CLUSTER_BG = '#13110a';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#5c5c5c';
const ICON_DOC = '#4a4a46';
const ACCENT_AMBER = '#c9a227';

const DOC_LONG_PRESS_MS = 425;
const DOCK_BARRIER_GAP = 22;
const TEXT_STARTER_ID = '__text_starter__';
const CARD_ROW_HEIGHT = 108;
const GRID_ROW_GAP = 12;

type GridItem =
  | { cell: 'starter'; id: typeof TEXT_STARTER_ID }
  | ({ cell: 'subfolder' } & Folder)
  | ({ cell: 'doc' } & Dissertation);

function paramId(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw ?? '';
}

function sortDissertations(list: Dissertation[]): Dissertation[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sortFolders(list: Folder[]): Folder[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function previewBody(body: string): string {
  const one = body.replace(/\s+/g, ' ').trim().slice(0, 88);
  return one || 'Sin contenido';
}

/**
 * Devuelve el id del cluster donde colocar un fork sobre `sourceDoc`. Si la carpeta del
 * origen es ya un auto-cluster, lo reusa. Si es user-folder, crea uno nuevo dentro,
 * mueve el origen ahí y devuelve el nuevo id.
 */
function getOrCreateClusterForSource(sourceDoc: Dissertation): string | null {
  const state = useFoldersStore.getState();
  const sourceFolder = state.folders.find((f) => f.id === sourceDoc.folderId);
  if (!sourceFolder) return null;
  if (sourceFolder.kind === 'auto-cluster') return sourceFolder.id;

  const clusterName = sourceDoc.title.slice(0, 80) || 'Cluster';
  const clusterId = state.addAutoClusterFolder(clusterName, sourceFolder.id);
  state.moveDissertation(sourceDoc.id, clusterId);
  return clusterId;
}

export default function FolderDetailScreen() {
  const id = paramId(useLocalSearchParams<{ id: string | string[] }>().id);
  useVoiceRouteRegistration(id ? 'folder' : 'off', id);
  const voiceChromeBottom = useGlobalVoiceChromeBottomInset();

  const folders = useFoldersStore((s) => s.folders);
  const dissertations = useFoldersStore((s) => s.dissertations);
  const addDissertationWithFields = useFoldersStore((s) => s.addDissertationWithFields);
  const addDissertationFromMerge = useFoldersStore((s) => s.addDissertationFromMerge);
  const addDissertationFromContinueFrom = useFoldersStore((s) => s.addDissertationFromContinueFrom);
  const googleApiKeyStored = useUserSettingsStore((s) => s.googleApiKey);
  const conversadorProfiles = useUserSettingsStore((s) => s.conversadorProfiles);
  const renameFolder = useFoldersStore((s) => s.renameFolder);
  const removeFolderTree = useFoldersStore((s) => s.removeFolderTree);
  const renameDissertation = useFoldersStore((s) => s.renameDissertation);
  const moveDissertation = useFoldersStore((s) => s.moveDissertation);
  const removeDissertation = useFoldersStore((s) => s.removeDissertation);

  const folder = useMemo(() => folders.find((f) => f.id === id), [folders, id]);
  const libraryDocs = useLibraryStore((s) => s.docs);
  const activeLibraryCount = useMemo(
    () => getActiveDocsForFolder(libraryDocs, id).length,
    [libraryDocs, id]
  );
  const inFolder = useMemo(
    () => sortDissertations(dissertations.filter((d) => d.folderId === id)),
    [dissertations, id]
  );
  const childFolders = useMemo(
    () => sortFolders(getDirectChildFolders(folders, id)),
    [folders, id]
  );

  const [pasteOpen, setPasteOpen] = useState(false);
  const [docActionsFor, setDocActionsFor] = useState<Dissertation | null>(null);
  const [folderActionsFor, setFolderActionsFor] = useState<Folder | null>(null);
  const [profilePickerFor, setProfilePickerFor] = useState<Dissertation | null>(null);
  const [renameDoc, setRenameDoc] = useState<Dissertation | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<Folder | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movingDoc, setMovingDoc] = useState<Dissertation | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<Dissertation | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<Folder | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; message: string } | null>(null);
  const [mergeBase, setMergeBase] = useState<Dissertation | null>(null);
  const [busy, setBusy] = useState(false);

  const listPaddingBottom = voiceChromeBottom + DOCK_BARRIER_GAP;

  const mergeCandidates = useMemo(
    () => (mergeBase ? inFolder.filter((d) => d.id !== mergeBase.id) : []),
    [inFolder, mergeBase]
  );

  const gridData: GridItem[] = useMemo(
    () => [
      { cell: 'starter' as const, id: TEXT_STARTER_ID },
      ...childFolders.map((f) => ({ cell: 'subfolder' as const, ...f })),
      ...inFolder.map((d) => ({ cell: 'doc' as const, ...d })),
    ],
    [childFolders, inFolder]
  );

  const docMenuOptions = useMemo(() => {
    if (!docActionsFor) return [];
    const d = docActionsFor;
    return [
      {
        key: 'rename',
        label: 'Renombrar',
        onPress: () => setRenameDoc(d),
      },
      {
        key: 'move',
        label: 'Mover',
        onPress: () => {
          setMovingDoc(d);
          setMovePickerOpen(true);
        },
      },
      {
        key: 'continue',
        label: 'Continuar en otro modo',
        onPress: () => {
          setProfilePickerFor(d);
        },
      },
      {
        key: 'merge',
        label: 'Fusión IA',
        onPress: () => {
          setMergeBase(d);
          setDocActionsFor(null);
        },
      },
      {
        key: 'export_docs',
        label: 'Exportar a Google Docs',
        onPress: async () => {
          const target = d;
          setDocActionsFor(null);
          if (!target) return;
          try {
            const token = await ensureGoogleAccessToken();
            if (!token) return;
            const { webUrl } = await exportDissertationToGoogleDoc({
              accessToken: token,
              dissertation: target,
            });
            await WebBrowser.openBrowserAsync(webUrl);
            setInfoModal({
              title: 'Documento creado',
              message: 'Se abrió en el navegador. El archivo queda en tu Google Drive.',
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setInfoModal({ title: 'Error al exportar', message: msg });
          }
        },
      },
      {
        key: 'delete',
        label: 'Eliminar',
        destructive: true,
        onPress: () => setDeleteDoc(d),
      },
    ];
  }, [docActionsFor]);

  const folderMenuOptions = useMemo(() => {
    if (!folderActionsFor) return [];
    const f = folderActionsFor;
    return [
      {
        key: 'rename',
        label: 'Renombrar',
        onPress: () => setRenameFolderTarget(f),
      },
      {
        key: 'compile',
        label: 'Compilar para NotebookLM',
        onPress: async () => {
          const target = f;
          setFolderActionsFor(null);
          if (!target) return;
          try {
            const token = await ensureGoogleAccessToken();
            if (!token) return;
            const allDocs = getAllDissertationsInTree(
              useFoldersStore.getState().folders,
              useFoldersStore.getState().dissertations,
              target.id
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
              folderName: target.name,
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
        key: 'delete',
        label: 'Eliminar carpeta y todo su contenido',
        destructive: true,
        onPress: () => setDeleteFolder(f),
      },
    ];
  }, [folderActionsFor]);

  const profilePickerOptions = useMemo(() => {
    if (!profilePickerFor) return [];
    const sourceDoc = profilePickerFor;
    return AI_PROFILE_ORDER.map((profile) => ({
      key: profile,
      label: resolveConversadorDisplayName(profile, conversadorProfiles),
      onPress: async () => {
        setProfilePickerFor(null);
        const apiKey = resolveGoogleApiKey(googleApiKeyStored);
        if (!apiKey) {
          setInfoModal({ title: 'API Key', message: 'Configura tu clave de Google en Ajustes.' });
          return;
        }
        setBusy(true);
        try {
          const seed = await generateContinuationSeed({
            apiKey,
            sourceHistory: sourceDoc.messages,
            newProfile: profile,
            conversadorProfiles,
          });
          if (!seed.ok) {
            setInfoModal({ title: 'Continuar', message: seed.error });
            return;
          }
          const clusterId = getOrCreateClusterForSource(sourceDoc);
          if (!clusterId) {
            setInfoModal({ title: 'Continuar', message: 'No se pudo localizar la carpeta destino.' });
            return;
          }
          const newTitle = `${sourceDoc.title} · ${resolveConversadorDisplayName(
            profile,
            conversadorProfiles
          )}`;
          const newId = addDissertationFromContinueFrom({
            parentDocId: sourceDoc.id,
            folderId: clusterId,
            title: newTitle,
            seedReply: seed.seedReply,
          });
          if (newId) {
            router.push({ pathname: '/document/[id]', params: { id: newId } });
          }
        } finally {
          setBusy(false);
        }
      },
    }));
  }, [profilePickerFor, googleApiKeyStored, conversadorProfiles, addDissertationFromContinueFrom]);

  const androidRipple =
    Platform.OS === 'android' ? { color: 'rgba(255,255,255,0.12)', borderless: false } : undefined;

  if (!folder) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <Pressable onPress={goBackOrHome} style={styles.backRow} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={28} color="rgba(255,255,255,0.45)" />
          </Pressable>
          <Text style={styles.muted}>Carpeta no encontrada.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={goBackOrHome} style={styles.backHit} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={28} color="rgba(255,255,255,0.45)" />
          </Pressable>
          <Text style={styles.title} numberOfLines={2}>
            {folder.name}
          </Text>
          {folder.kind === 'auto-cluster' ? (
            <Ionicons name="git-branch-outline" size={18} color={ACCENT_AMBER} style={styles.clusterTag} />
          ) : null}
        </View>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={ACCENT_AMBER} />
            <Text style={styles.busyText}>Procesando…</Text>
          </View>
        ) : null}

        {/* Estado de la jaula, siempre visible: que el casual no se pierda la
            opción más potente, y que quede claro cuándo la IA va "a pelo". */}
        <Pressable
          onPress={() => router.push('/library')}
          style={({ pressed }) => [styles.libraryRow, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel={
            activeLibraryCount > 0
              ? `Biblioteca activa: ${activeLibraryCount} documentos en jaula`
              : 'Sin biblioteca: la IA va a pelo. Tocar para activar.'
          }
        >
          <Ionicons
            name={activeLibraryCount > 0 ? 'library' : 'library-outline'}
            size={14}
            color={activeLibraryCount > 0 ? ACCENT_AMBER : TEXT_MUTED}
          />
          <Text style={[styles.libraryRowText, activeLibraryCount > 0 && styles.libraryRowTextActive]}>
            {activeLibraryCount > 0
              ? `En jaula: ${activeLibraryCount} documento${activeLibraryCount === 1 ? '' : 's'}`
              : 'A pelo — sin biblioteca · activar'}
          </Text>
        </Pressable>

        <View style={[styles.listShell, { paddingBottom: listPaddingBottom }]}>
          <FlatList
            data={gridData}
            keyExtractor={(item) => item.id}
            numColumns={2}
            scrollEnabled
            showsVerticalScrollIndicator={false}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.gridContent}
            renderItem={({ item }) => {
              if (item.cell === 'starter') {
                return (
                  <Pressable
                    style={({ pressed }) => [styles.card, styles.starterCard, pressed && styles.starterPressed]}
                    onPress={() => setPasteOpen(true)}
                    android_ripple={androidRipple}
                    accessibilityRole="button"
                    accessibilityLabel="Iniciar conversación desde texto"
                  >
                    <View style={[styles.cardInner, styles.starterInner]}>
                      <Ionicons name="add" size={52} color={ACCENT_AMBER} />
                      <Text style={styles.starterHint}>Iniciar conversación desde texto</Text>
                    </View>
                  </Pressable>
                );
              }
              if (item.cell === 'subfolder') {
                return (
                  <Pressable
                    style={({ pressed }) => [styles.card, styles.clusterCard, pressed && styles.cardPressed]}
                    onPress={() => router.push({ pathname: '/folder/[id]', params: { id: item.id } })}
                    onLongPress={() => setFolderActionsFor(item)}
                    delayLongPress={DOC_LONG_PRESS_MS}
                    android_ripple={androidRipple}
                    accessibilityRole="button"
                    accessibilityLabel={`Cluster ${item.name}`}
                  >
                    <View style={styles.cardInner}>
                      <Ionicons
                        name="git-branch-outline"
                        size={22}
                        color={ACCENT_AMBER}
                        style={styles.cardIcon}
                      />
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        Cluster
                      </Text>
                    </View>
                  </Pressable>
                );
              }
              return (
                <Pressable
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                  onPress={() => router.push({ pathname: '/document/[id]', params: { id: item.id } })}
                  onLongPress={() => setDocActionsFor(item)}
                  delayLongPress={DOC_LONG_PRESS_MS}
                  android_ripple={androidRipple}
                  accessibilityRole="button"
                  accessibilityLabel={`Disertación ${item.title}`}
                >
                  <View style={styles.cardInner}>
                    <Ionicons
                      name={
                        item.lineage === 'continue-from'
                          ? 'return-down-forward-outline'
                          : item.lineage === 'merge'
                            ? 'layers-outline'
                            : 'document-text-outline'
                      }
                      size={22}
                      color={ICON_DOC}
                      style={styles.cardIcon}
                    />
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={2}>
                      {previewBody(item.body)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>
      </SafeAreaView>

      <NewDocumentModal
        visible={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onCreate={(title, body) => addDissertationWithFields(folder.id, title, body)}
      />

      <DarkActionSheet
        visible={docActionsFor !== null}
        title={docActionsFor?.title ?? ''}
        options={docMenuOptions}
        onClose={() => setDocActionsFor(null)}
      />

      <DarkActionSheet
        visible={folderActionsFor !== null}
        title={folderActionsFor?.name ?? ''}
        options={folderMenuOptions}
        onClose={() => setFolderActionsFor(null)}
      />

      <DarkActionSheet
        visible={profilePickerFor !== null}
        title="Continuar en…"
        options={profilePickerOptions}
        onClose={() => setProfilePickerFor(null)}
      />

      <FolderNameModal
        visible={renameDoc !== null}
        title="Renombrar disertación"
        initialValue={renameDoc?.title ?? ''}
        placeholder="Título"
        confirmLabel="Guardar"
        onClose={() => setRenameDoc(null)}
        onSubmit={(name) => {
          if (!renameDoc) return false;
          if (!name.trim()) {
            setInfoModal({ title: 'Título vacío', message: 'Escribe un título.' });
            return false;
          }
          renameDissertation(renameDoc.id, name);
          return true;
        }}
      />

      <FolderNameModal
        visible={renameFolderTarget !== null}
        title="Renombrar carpeta"
        initialValue={renameFolderTarget?.name ?? ''}
        placeholder="Nombre"
        confirmLabel="Guardar"
        onClose={() => setRenameFolderTarget(null)}
        onSubmit={(name) => {
          if (!renameFolderTarget) return false;
          if (!name.trim()) {
            setInfoModal({ title: 'Nombre vacío', message: 'Escribe un nombre.' });
            return false;
          }
          renameFolder(renameFolderTarget.id, name);
          return true;
        }}
      />

      <MoveFolderPickerModal
        visible={movePickerOpen}
        folders={folders}
        excludeFolderId={folder.id}
        onClose={() => {
          setMovePickerOpen(false);
          setMovingDoc(null);
        }}
        onSelectFolder={(targetId) => {
          if (movingDoc) moveDissertation(movingDoc.id, targetId);
        }}
      />

      <DarkCenterDialog
        visible={deleteDoc !== null}
        title="Eliminar disertación"
        message={
          deleteDoc
            ? `¿Eliminar «${deleteDoc.title}»? Esta acción no se puede deshacer.`
            : ''
        }
        secondaryLabel="Cancelar"
        primaryLabel="Eliminar"
        primaryDestructive
        onSecondary={() => setDeleteDoc(null)}
        onPrimary={() => {
          if (deleteDoc) removeDissertation(deleteDoc.id);
          setDeleteDoc(null);
        }}
        onRequestClose={() => setDeleteDoc(null)}
      />

      <DarkCenterDialog
        visible={deleteFolder !== null}
        title="Eliminar carpeta"
        message={
          deleteFolder
            ? `¿Eliminar «${deleteFolder.name}» y todo su contenido (sub-carpetas y disertaciones)? Esta acción no se puede deshacer.`
            : ''
        }
        secondaryLabel="Cancelar"
        primaryLabel="Eliminar todo"
        primaryDestructive
        onSecondary={() => setDeleteFolder(null)}
        onPrimary={() => {
          if (deleteFolder) {
            removeFolderTree(deleteFolder.id);
            // La biblioteca no debe apuntar a carpetas muertas (contaría mal el "activo en N").
            useLibraryStore.getState().detachFolderEverywhere(deleteFolder.id);
          }
          setDeleteFolder(null);
        }}
        onRequestClose={() => setDeleteFolder(null)}
      />

      <DarkCenterDialog
        visible={infoModal !== null}
        title={infoModal?.title ?? ''}
        message={infoModal?.message ?? ''}
        primaryLabel="Entendido"
        onPrimary={() => setInfoModal(null)}
        onRequestClose={() => setInfoModal(null)}
      />

      <MergeDocumentsModal
        visible={mergeBase !== null}
        baseDoc={mergeBase}
        candidates={mergeCandidates}
        onClose={() => setMergeBase(null)}
        onConfirm={async (selectedIds) => {
          const base = mergeBase;
          if (!base || selectedIds.length === 0) return;
          const apiKey = resolveGoogleApiKey(googleApiKeyStored);
          const others = dissertations.filter((x) => selectedIds.includes(x.id));
          setMergeBase(null);
          setBusy(true); // fusión = 3 pasadas de Pro: puede tardar >30 s
          try {
            const result = await mergeDissertationsWithGemini({
              apiKey,
              base: { title: base.title, body: base.body },
              others: others.map((o) => ({ title: o.title, body: o.body })),
            });
            if (!result.ok) {
              setInfoModal({ title: 'Fusión IA', message: result.error });
              return;
            }
            const mergedTitle = `Fusión: ${base.title}`.slice(0, 200);
            const newId = addDissertationFromMerge({
              folderId: folder.id,
              title: mergedTitle,
              body: result.text,
              sourceIds: [base.id, ...selectedIds],
            });
            if (newId) {
              router.push({ pathname: '/document/[id]', params: { id: newId } });
            }
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  safe: {
    flex: 1,
    paddingHorizontal: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  backRow: {
    paddingVertical: 8,
    marginBottom: 16,
  },
  backHit: {
    paddingVertical: 8,
    paddingRight: 4,
    marginLeft: -8,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  clusterTag: {
    marginLeft: 4,
    opacity: 0.85,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  busyText: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontStyle: 'italic',
  },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  libraryRowText: {
    fontSize: 12,
    color: TEXT_MUTED,
    letterSpacing: 0.2,
  },
  libraryRowTextActive: {
    color: ACCENT_AMBER,
  },
  listShell: {
    flex: 1,
  },
  gridContent: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  gridRow: {
    gap: GRID_ROW_GAP,
    marginBottom: GRID_ROW_GAP,
  },
  card: {
    flex: 1,
    minWidth: 0,
    maxWidth: '50%',
    borderRadius: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  cardPressed: {
    opacity: 0.88,
    borderColor: '#353535',
  },
  clusterCard: {
    backgroundColor: CLUSTER_BG,
    borderColor: CLUSTER_BORDER,
  },
  starterCard: {
    borderColor: '#4a4224',
    backgroundColor: '#12100a',
  },
  starterPressed: {
    opacity: 0.9,
    borderColor: '#5c5228',
  },
  cardInner: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: CARD_ROW_HEIGHT,
    justifyContent: 'flex-start',
  },
  starterInner: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: CARD_ROW_HEIGHT + 24,
  },
  starterHint: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '600',
    color: TEXT_MUTED,
    textAlign: 'center',
    letterSpacing: 0.2,
    lineHeight: 15,
    paddingHorizontal: 4,
  },
  cardIcon: {
    marginBottom: 10,
    opacity: 0.9,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
    lineHeight: 20,
    marginBottom: 6,
  },
  cardMeta: {
    fontSize: 12,
    color: TEXT_MUTED,
    letterSpacing: 0.15,
  },
  muted: {
    fontSize: 15,
    color: TEXT_MUTED,
    marginTop: 8,
  },
});
