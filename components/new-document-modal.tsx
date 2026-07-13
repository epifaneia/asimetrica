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

const BG_INPUT = '#0a0a0a';
const CARD = '#141414';
const BORDER = '#333333';
const TEXT = '#e8e8e6';
const MUTED = '#7a7a7a';
const LABEL = '#9a9a9a';
const ACCENT = '#c9a227';
const ERROR_SUBTLE = 'rgba(220, 140, 140, 0.92)';

const VALIDATION_MSG = 'Ambos campos son obligatorios';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Persistir documento; true si se guardó (el modal puede cerrarse). */
  onCreate: (title: string, body: string) => boolean;
};

export function NewDocumentModal({ visible, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setTitle('');
      setBody('');
      setError(null);
      const t = setTimeout(() => titleRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const handleCreate = () => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setError(VALIDATION_MSG);
      return;
    }
    setError(null);
    const ok = onCreate(t, b);
    if (ok) onClose();
  };

  const onChangeTitle = (v: string) => {
    setTitle(v);
    if (error) setError(null);
  };

  const onChangeBody = (v: string) => {
    setBody(v);
    if (error) setError(null);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Cerrar" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>Nuevo Documento</Text>

            <Text style={styles.fieldLabel}>Título</Text>
            <TextInput
              ref={titleRef}
              value={title}
              onChangeText={onChangeTitle}
              placeholder="Nombre del documento"
              placeholderTextColor={MUTED}
              style={styles.inputSingle}
              maxLength={200}
              returnKeyType="next"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>Contexto / texto inicial</Text>
            <TextInput
              value={body}
              onChangeText={onChangeBody}
              placeholder="Escribe o pega el contexto base…"
              placeholderTextColor={MUTED}
              style={styles.inputMulti}
              multiline
              textAlignVertical="top"
              maxLength={20000}
              autoCorrect
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              >
                <Text style={styles.btnGhostText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
              >
                <Text style={styles.btnPrimaryText}>Crear</Text>
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
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  kav: {
    maxHeight: '90%',
    marginHorizontal: 18,
  },
  sheet: {
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: LABEL,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  inputSingle: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 16,
    color: TEXT,
    backgroundColor: BG_INPUT,
    marginBottom: 16,
  },
  inputMulti: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: TEXT,
    backgroundColor: BG_INPUT,
    minHeight: 160,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    color: ERROR_SUBTLE,
    marginBottom: 14,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
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
    opacity: 0.88,
  },
});
