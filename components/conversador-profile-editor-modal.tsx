import type { AiProfileId } from '@/lib/conversador-profile';
import {
  CONVERSADOR_ICON_OPTIONS,
  DEFAULT_CONVERSADOR_DISPLAY_NAME,
  DEFAULT_CONVERSADOR_DOCK_ICON,
  getDefaultConversadorSystemPrompt,
} from '@/constants/conversador-profile-defaults';
import {
  buildConversadorProfileEntryFromForm,
  resolveConversadorDisplayName,
  resolveConversadorDockIcon,
  resolveConversadorSystemPrompt,
} from '@/lib/conversador-profile';
import { useUserSettingsStore } from '@/stores/user-settings-store';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PANEL = '#141414';
const BORDER = '#333333';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#6a6a6a';
const ACCENT = '#c9a227';
const INPUT_BG = '#0a0a0a';

const INTERNAL_ID_LABEL: Record<AiProfileId, string> = {
  creativo: 'creativo',
  auditor: 'auditor',
  sistemico: 'sistemico',
  destilador: 'destilador',
};

type Props = {
  visible: boolean;
  profile: AiProfileId | null;
  onClose: () => void;
};

export function ConversadorProfileEditorModal({ visible, profile, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const conversadorProfiles = useUserSettingsStore((s) => s.conversadorProfiles);
  const setConversadorProfileEntry = useUserSettingsStore((s) => s.setConversadorProfileEntry);
  const clearConversadorProfile = useUserSettingsStore((s) => s.clearConversadorProfile);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('flash-outline');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    if (!visible || !profile) return;
    setName(resolveConversadorDisplayName(profile, conversadorProfiles));
    setIcon(resolveConversadorDockIcon(profile, conversadorProfiles));
    setPrompt(resolveConversadorSystemPrompt(profile, conversadorProfiles));
  }, [visible, profile, conversadorProfiles]);

  const handleSave = () => {
    if (!profile) return;
    const entry = buildConversadorProfileEntryFromForm(profile, name, icon, prompt);
    setConversadorProfileEntry(profile, entry);
    onClose();
  };

  const handleRestore = () => {
    if (!profile) return;
    clearConversadorProfile(profile);
    setName(DEFAULT_CONVERSADOR_DISPLAY_NAME[profile]);
    setIcon(DEFAULT_CONVERSADOR_DOCK_ICON[profile]);
    setPrompt(getDefaultConversadorSystemPrompt(profile));
  };

  if (!profile) {
    return null;
  }

  const titleName = resolveConversadorDisplayName(profile, conversadorProfiles);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />
        <View
          style={[
            styles.panel,
            {
              marginBottom: Math.max(insets.bottom, 12),
              maxHeight: '88%',
            },
          ]}
        >
          <Text style={styles.panelTitle}>Editar conversador</Text>
          <Text style={styles.panelSubtitle}>
            {titleName} · <Text style={styles.mono}>{INTERNAL_ID_LABEL[profile]}</Text>
          </Text>
          <Text style={styles.hint}>
            Define la personalidad del texto que se guarda en la disertación (y que Kokoro leerá). El
            análisis profundo del paso 2 sigue fijo en código.
          </Text>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.fieldLabel}>Nombre en la app</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={DEFAULT_CONVERSADOR_DISPLAY_NAME[profile]}
              placeholderTextColor={TEXT_MUTED}
              style={styles.input}
            />

            <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>Icono del dock</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.iconRow}
            >
              {CONVERSADOR_ICON_OPTIONS.map((opt) => {
                const on = icon === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => setIcon(opt)}
                    style={[styles.iconChip, on && styles.iconChipOn]}
                    accessibilityRole="button"
                    accessibilityLabel={`Icono ${opt}`}
                  >
                    <Ionicons
                      name={opt as keyof typeof Ionicons.glyphMap}
                      size={22}
                      color={on ? '#0a0a0a' : ACCENT}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>
              Instrucciones del conversador (system)
            </Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.promptInput]}
            />
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.btnGhost, pressed && styles.btnPressed]}
            >
              <Text style={styles.btnGhostText}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={handleRestore}
              style={({ pressed }) => [styles.btnGhost, pressed && styles.btnPressed]}
            >
              <Text style={styles.btnGhostText}>Predeterminado</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [styles.btnPrimary, pressed && styles.btnPressed]}
            >
              <Text style={styles.btnPrimaryText}>Guardar</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    marginHorizontal: 16,
    backgroundColor: PANEL,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  panelSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: TEXT_MUTED,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    color: ACCENT,
  },
  hint: {
    marginTop: 10,
    fontSize: 12,
    color: TEXT_MUTED,
    lineHeight: 17,
  },
  scroll: {
    marginTop: 14,
    maxHeight: 360,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldLabelSpaced: {
    marginTop: 14,
  },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT_PRIMARY,
    backgroundColor: INPUT_BG,
  },
  promptInput: {
    minHeight: 200,
    paddingTop: 12,
  },
  iconRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    marginTop: 8,
  },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: INPUT_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChipOn: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 8,
  },
  btnGhost: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnGhostText: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '600',
  },
  btnPrimary: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  btnPrimaryText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '700',
  },
  btnPressed: {
    opacity: 0.88,
  },
});
