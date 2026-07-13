import type { Dissertation } from '@/stores/folders-store';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const DIM = 'rgba(0,0,0,0.72)';
const CARD = '#141414';
const BORDER = '#2c2c2c';
const TEXT = '#e8e8e6';
const MUTED = '#8a8a8a';
const ROW_BG = '#111111';
const ACCENT = '#c9a227';

type Props = {
  visible: boolean;
  baseDoc: Dissertation | null;
  /** Misma carpeta que la base, sin incluir la base. */
  candidates: Dissertation[];
  onClose: () => void;
  /** Debe resolver cuando termine la fusión (éxito o error manejado fuera). */
  onConfirm: (selectedIds: string[]) => Promise<void>;
};

export function MergeDocumentsModal({
  visible,
  baseDoc,
  candidates,
  onClose,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setBusy(false);
    }
  }, [visible, baseDoc?.id]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = useMemo(
    () => candidates.length > 0 && selected.size > 0 && !busy,
    [candidates.length, selected.size, busy]
  );

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onConfirm([...selected]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onClose}>
      <View style={styles.root}>
        <Pressable style={styles.dim} onPress={busy ? undefined : onClose} accessibilityLabel="Cerrar" />
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>Fusionar con IA</Text>
          {baseDoc ? (
            <Text style={styles.sub}>
              Base: «{baseDoc.title}». Marca uno o más documentos de esta carpeta; Gemini generará un texto
              nuevo que unifique las ideas.
            </Text>
          ) : null}

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {candidates.length === 0 ? (
              <Text style={styles.empty}>
                No hay otros documentos en esta carpeta. Crea al menos otro archivo para fusionar.
              </Text>
            ) : (
              candidates.map((d) => {
                const on = selected.has(d.id);
                return (
                  <Pressable
                    key={d.id}
                    onPress={() => !busy && toggle(d.id)}
                    style={({ pressed }) => [
                      styles.row,
                      on && styles.rowSelected,
                      pressed && !busy && styles.rowPressed,
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${d.title}, ${on ? 'seleccionado' : 'no seleccionado'}`}
                  >
                    <Ionicons
                      name={on ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={on ? ACCENT : MUTED}
                    />
                    <Text style={styles.rowText} numberOfLines={2}>
                      {d.title}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable
            onPress={handleConfirm}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.primaryBtn,
              (!canSubmit || pressed) && styles.primaryBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Generar documento fusionado"
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.primaryBtnText}>Generar fusión</Text>
            )}
          </Pressable>

          <Pressable
            onPress={onClose}
            disabled={busy}
            style={({ pressed }) => [styles.closeBtn, busy && styles.closeBtnDisabled, pressed && styles.pressed]}
          >
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
    maxHeight: '78%',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 8,
  },
  sub: {
    fontSize: 13,
    color: MUTED,
    marginBottom: 14,
    lineHeight: 18,
  },
  list: {
    maxHeight: 340,
    marginBottom: 12,
  },
  empty: {
    fontSize: 14,
    color: MUTED,
    paddingVertical: 20,
    textAlign: 'center',
    lineHeight: 20,
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
  rowSelected: {
    borderColor: '#4a4224',
    backgroundColor: '#12100a',
  },
  rowPressed: {
    opacity: 0.88,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: TEXT,
  },
  primaryBtn: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0a0a0a',
  },
  closeBtn: {
    marginTop: 6,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeBtnDisabled: {
    opacity: 0.5,
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
