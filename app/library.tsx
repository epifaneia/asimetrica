import { DarkCenterDialog } from '@/components/dark-sheets';
import { useVoiceRouteRegistration } from '@/hooks/useVoiceRouteRegistration';
import { goBackOrHome } from '@/lib/navigation';
import {
  addLibraryDocument,
  deleteLibraryDocument,
  detectKind,
  resumeUnfinishedIngestions,
  runIngestion,
} from '@/services/libraryIngestService';
import { useFoldersStore } from '@/stores/folders-store';
import { useLibraryStore, type LibraryDoc } from '@/stores/library-store';
import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#0c0c0c';
const CARD_BG = '#111111';
const CARD_BORDER = '#242424';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#6a6a6a';
const ACCENT = '#c9a227';
const ERROR_SOFT = '#e8a0a0';

/**
 * Biblioteca de obra. Filosofía «jaula» (NotebookLM): todo lo subido es canon
 * vinculante — sin clases, sin preguntas. Un documento sin carpetas asignadas
 * está INACTIVO: nada actúa hasta que el creador lo dice (default seguro).
 */

function statusLabel(d: LibraryDoc): string {
  switch (d.status) {
    case 'pendiente':
      return 'En cola…';
    case 'extrayendo':
      return 'Extrayendo texto…';
    case 'troceando':
      return 'Troceando…';
    case 'embebiendo':
      return `Indexando ${d.embeddedChunks}/${d.nChunks}…`;
    case 'listo':
      return d.nChunks > 0
        ? `Listo · ${Math.round(d.chars / 1000)}k caracteres · ${d.nChunks} fragmentos`
        : `Listo · ${Math.round(d.chars / 1000)}k caracteres · se aplica entero`;
    case 'error':
      return d.errorMessage ?? 'Error';
  }
}

export default function LibraryScreen() {
  useVoiceRouteRegistration('off');
  const docs = useLibraryStore((s) => s.docs);
  const setDocFolders = useLibraryStore((s) => s.setDocFolders);
  const folders = useFoldersStore((s) => s.folders);
  const storedKey = useUserSettingsStore((s) => s.googleApiKey);
  const apiKey = resolveGoogleApiKey(storedKey);

  const [assignFor, setAssignFor] = useState<LibraryDoc | null>(null);
  const [assignDraft, setAssignDraft] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<LibraryDoc | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; message: string } | null>(null);

  // Carpetas del usuario (los auto-clusters heredan contexto conceptual de su padre,
  // pero mantener la lista corta y reconocible pesa más en v1).
  const assignableFolders = useMemo(
    () => folders.filter((f) => f.kind !== 'auto-cluster'),
    [folders]
  );

  // Ingestas que quedaron a medias (app cerrada en mitad): retomar al entrar.
  useEffect(() => {
    if (apiKey) resumeUnfinishedIngestions(apiKey);
  }, [apiKey]);

  const pickAndAdd = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: '*/*',
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    const kind = detectKind(asset.name ?? '');
    if (!kind) {
      setInfoModal({
        title: 'Formato no soportado',
        message: 'Solo .txt, .md y .pdf. Cualquier otra cosa, pásala a texto antes.',
      });
      return;
    }
    const added = await addLibraryDocument({
      apiKey,
      pickerUri: asset.uri,
      fileName: asset.name ?? 'documento.txt',
    });
    if (!added.ok) {
      setInfoModal({ title: 'No se pudo añadir', message: added.error });
    }
  };

  const openAssign = (d: LibraryDoc) => {
    setAssignDraft(d.folderIds);
    setAssignFor(d);
  };

  const toggleDraftFolder = (folderId: string) => {
    setAssignDraft((prev) =>
      prev.includes(folderId) ? prev.filter((f) => f !== folderId) : [...prev, folderId]
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={goBackOrHome} style={styles.backHit} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={28} color="rgba(255,255,255,0.45)" />
          </Pressable>
          <Ionicons name="library-outline" size={20} color={ACCENT} />
          <Text style={styles.title}>Biblioteca de obra</Text>
        </View>

        <Text style={styles.help}>
          Lo que subas aquí actúa como <Text style={styles.helpEmphasis}>jaula</Text>: tu obra y tus
          normas son canon vinculante para el análisis. Asigna cada documento a las carpetas donde
          debe actuar — sin asignar, no actúa.
        </Text>
        <Text style={styles.help}>
          De un <Text style={styles.helpEmphasis}>PDF solo viaja el texto</Text>: mapas, tablas
          complejas e ilustraciones se quedan fuera. Si lo importante de un documento está en las
          imágenes, esto no lo va a ver.
        </Text>

        {!apiKey ? (
          <Text style={styles.warning}>
            Configura tu Google API Key en Ajustes: la indexación la necesita.
          </Text>
        ) : null}

        <Pressable
          onPress={() => void pickAndAdd()}
          style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Añadir documento"
        >
          <Ionicons name="add" size={22} color="#0a0a0a" />
          <Text style={styles.addBtnText}>Añadir documento (txt · md · pdf)</Text>
        </Pressable>

        <FlatList
          data={docs}
          keyExtractor={(d) => d.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Sin documentos aún. Sube tu obra, tu esqueleto, tus normas de estilo, tu manual…
            </Text>
          }
          renderItem={({ item }) => {
            const busy =
              item.status !== 'listo' && item.status !== 'error';
            return (
              <Pressable
                style={styles.card}
                onLongPress={() => setDeleteTarget(item)}
                delayLongPress={450}
                accessibilityLabel={`Documento ${item.title}`}
              >
                <View style={styles.cardHeader}>
                  <Ionicons
                    name={item.kind === 'pdf' ? 'document-outline' : 'document-text-outline'}
                    size={18}
                    color={item.status === 'listo' ? ACCENT : TEXT_MUTED}
                  />
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
                <Text style={[styles.cardStatus, item.status === 'error' && styles.cardStatusError]}>
                  {statusLabel(item)}
                </Text>
                {busy && item.nChunks > 0 ? (
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.round((item.embeddedChunks / Math.max(1, item.nChunks)) * 100)}%` },
                      ]}
                    />
                  </View>
                ) : null}
                <View style={styles.cardActions}>
                  {item.status === 'listo' ? (
                    <Pressable
                      onPress={() => openAssign(item)}
                      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name={item.folderIds.length > 0 ? 'folder-open-outline' : 'folder-outline'}
                        size={14}
                        color={item.folderIds.length > 0 ? ACCENT : TEXT_MUTED}
                      />
                      <Text
                        style={[styles.chipText, item.folderIds.length > 0 && styles.chipTextActive]}
                      >
                        {item.folderIds.length > 0
                          ? `Activo en ${item.folderIds.length} carpeta${item.folderIds.length === 1 ? '' : 's'}`
                          : 'Inactivo — asignar carpetas'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {item.status === 'error' ? (
                    <Pressable
                      onPress={() => void runIngestion(item.id, apiKey)}
                      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                      accessibilityRole="button"
                    >
                      <Ionicons name="refresh" size={14} color={ACCENT} />
                      <Text style={[styles.chipText, styles.chipTextActive]}>Reintentar</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
        <Text style={styles.footerHint}>Mantén pulsado un documento para eliminarlo.</Text>
      </SafeAreaView>

      {/* Asignación multi-carpeta */}
      <Modal visible={assignFor !== null} transparent animationType="fade">
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {assignFor?.title}
            </Text>
            <Text style={styles.modalHelp}>Actúa como jaula en estas carpetas:</Text>
            <FlatList
              data={assignableFolders}
              keyExtractor={(f) => f.id}
              style={styles.modalList}
              renderItem={({ item }) => {
                const checked = assignDraft.includes(item.id);
                return (
                  <Pressable
                    onPress={() => toggleDraftFolder(item.id)}
                    style={({ pressed }) => [styles.folderRow, pressed && styles.chipPressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={checked ? ACCENT : TEXT_MUTED}
                    />
                    <Text style={styles.folderRowText} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={styles.empty}>No hay carpetas todavía.</Text>}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setAssignFor(null)}
                style={({ pressed }) => [styles.modalBtn, pressed && styles.chipPressed]}
              >
                <Text style={styles.modalBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (assignFor) setDocFolders(assignFor.id, assignDraft);
                  setAssignFor(null);
                }}
                style={({ pressed }) => [styles.modalBtn, styles.modalBtnPrimary, pressed && styles.chipPressed]}
              >
                <Text style={styles.modalBtnPrimaryText}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <DarkCenterDialog
        visible={deleteTarget !== null}
        title="Eliminar documento"
        message={
          deleteTarget
            ? `¿Eliminar «${deleteTarget.title}» de la biblioteca? Se borra su índice; el archivo original en tu dispositivo no se toca.`
            : ''
        }
        secondaryLabel="Cancelar"
        primaryLabel="Eliminar"
        primaryDestructive
        onSecondary={() => setDeleteTarget(null)}
        onPrimary={() => {
          if (deleteTarget) void deleteLibraryDocument(deleteTarget.id);
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
  help: {
    fontSize: 12,
    color: TEXT_MUTED,
    lineHeight: 17,
    marginBottom: 10,
  },
  helpEmphasis: {
    color: ACCENT,
    fontWeight: '700',
  },
  warning: {
    fontSize: 12,
    color: ERROR_SOFT,
    marginBottom: 8,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 14,
  },
  addBtnPressed: {
    opacity: 0.85,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0a0a0a',
    letterSpacing: 0.3,
  },
  listContent: {
    paddingBottom: 12,
    gap: 10,
  },
  empty: {
    fontSize: 13,
    color: TEXT_MUTED,
    fontStyle: 'italic',
    paddingVertical: 12,
    textAlign: 'center',
  },
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  cardStatus: {
    marginTop: 4,
    fontSize: 12,
    color: TEXT_MUTED,
  },
  cardStatusError: {
    color: ERROR_SOFT,
  },
  progressTrack: {
    marginTop: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#242424',
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipText: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  chipTextActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  footerHint: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#141414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2c2c2c',
    padding: 18,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  modalHelp: {
    fontSize: 12,
    color: TEXT_MUTED,
    marginTop: 4,
    marginBottom: 10,
  },
  modalList: {
    flexGrow: 0,
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  folderRowText: {
    flex: 1,
    fontSize: 14,
    color: TEXT_PRIMARY,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  modalBtnPrimary: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  modalBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  modalBtnPrimaryText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0a0a0a',
  },
});
