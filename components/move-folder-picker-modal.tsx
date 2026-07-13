import type { Folder } from '@/stores/folders-store';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const DIM = 'rgba(0,0,0,0.72)';
const CARD = '#141414';
const BORDER = '#2c2c2c';
const TEXT = '#e8e8e6';
const MUTED = '#8a8a8a';
const ROW_BG = '#111111';

type Props = {
  visible: boolean;
  folders: Folder[];
  excludeFolderId: string;
  onClose: () => void;
  onSelectFolder: (folderId: string) => void;
};

export function MoveFolderPickerModal({
  visible,
  folders,
  excludeFolderId,
  onClose,
  onSelectFolder,
}: Props) {
  const targets = folders.filter((f) => f.id !== excludeFolderId);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>Mover a carpeta</Text>
          <Text style={styles.sub}>Elige la carpeta de destino.</Text>
          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {targets.length === 0 ? (
              <Text style={styles.empty}>No hay otras carpetas disponibles.</Text>
            ) : (
              targets.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => {
                    onSelectFolder(f.id);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Mover a ${f.name}`}
                >
                  <Ionicons name="folder-outline" size={20} color="#5a5a56" />
                  <Text style={styles.rowText} numberOfLines={2}>
                    {f.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={MUTED} />
                </Pressable>
              ))
            )}
          </ScrollView>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}>
            <Text style={styles.closeBtnText}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DIM,
  },
  sheet: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    maxHeight: '72%',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 4,
  },
  sub: {
    fontSize: 13,
    color: MUTED,
    marginBottom: 14,
  },
  list: {
    maxHeight: 320,
  },
  empty: {
    fontSize: 14,
    color: MUTED,
    paddingVertical: 20,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: ROW_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
  },
  rowPressed: {
    opacity: 0.88,
    borderColor: '#3a3a3a',
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: TEXT,
  },
  closeBtn: {
    marginTop: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: MUTED,
  },
  pressed: {
    opacity: 0.8,
  },
});
