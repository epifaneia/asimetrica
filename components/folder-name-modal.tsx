import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const BG = '#0c0c0c';
const CARD = '#141414';
const BORDER = '#333333';
const TEXT = '#e8e8e6';
const MUTED = '#7a7a7a';
const ACCENT = '#c9a227';

type Props = {
  visible: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onClose: () => void;
  /** Devuelve false para no cerrar (ej. nombre vacío). */
  onSubmit: (nombre: string) => boolean | void;
};

export function FolderNameModal({
  visible,
  title,
  initialValue = '',
  placeholder = 'Nombre de la carpeta',
  confirmLabel = 'Guardar',
  onClose,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [visible, initialValue]);

  const handleConfirm = () => {
    const ok = onSubmit(value.trim());
    if (ok !== false) onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.dim}
          onPress={onClose}
          accessibilityLabel="Cerrar"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={MUTED}
              style={styles.input}
              maxLength={120}
              returnKeyType="done"
              onSubmitEditing={handleConfirm}
              autoCorrect={false}
              autoCapitalize="sentences"
            />
            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              >
                <Text style={styles.btnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirm}
                style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
              >
                <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  kav: {
    marginHorizontal: 24,
  },
  sheet: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 16,
    color: TEXT,
    backgroundColor: BG,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnGhostText: {
    color: MUTED,
    fontSize: 15,
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: ACCENT,
  },
  btnPrimaryText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
