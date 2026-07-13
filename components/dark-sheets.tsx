import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DIM = 'rgba(0,0,0,0.58)';
const SHEET_BG = '#141414';
const SHEET_BORDER = '#2c2c2c';
const TEXT = '#e8e8e6';
const MUTED = '#8a8a8a';
const DESTRUCTIVE = '#c75c5c';

export type DarkSheetOption = {
  key: string;
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

/** Menú tipo hoja inferior (sustituye Alert blanco en Android). */
export function DarkActionSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: DarkSheetOption[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const padBottom = Math.max(insets.bottom, 14) + 10;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.actionRoot}>
        <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Cerrar menú" />
        <View style={[styles.actionSheet, { paddingBottom: padBottom }]}>
          <Text style={styles.actionTitle} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.actionDivider} />
          {options.map((opt, i) => (
            <Pressable
              key={opt.key}
              onPress={() => {
                opt.onPress();
                onClose();
              }}
              style={({ pressed }) => [
                styles.actionRow,
                i > 0 && styles.actionRowBorder,
                pressed && styles.actionRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
            >
              <Text style={[styles.actionRowText, opt.destructive && styles.actionRowDestructive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
          <View style={styles.actionDivider} />
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
            accessibilityRole="button"
            accessibilityLabel="Cancelar"
          >
            <Text style={styles.actionCancel}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Diálogo centrado: confirmación (2 botones) o aviso (1 botón). */
export function DarkCenterDialog({
  visible,
  title,
  message,
  primaryLabel,
  secondaryLabel,
  primaryDestructive,
  onPrimary,
  onSecondary,
  onRequestClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  primaryLabel: string;
  secondaryLabel?: string;
  primaryDestructive?: boolean;
  onPrimary: () => void;
  onSecondary?: () => void;
  onRequestClose: () => void;
}) {
  const single = !secondaryLabel;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.centerRoot}>
        <Pressable style={styles.dim} onPress={single ? onRequestClose : undefined} />
        <View style={styles.centerCard} onStartShouldSetResponder={() => true}>
          <Text style={styles.centerTitle}>{title}</Text>
          <Text style={styles.centerMessage}>{message}</Text>
          <View style={[styles.centerActions, single && styles.centerActionsSingle]}>
            {!single && onSecondary && (
              <Pressable
                onPress={onSecondary}
                style={({ pressed }) => [styles.centerBtn, styles.centerBtnGhost, pressed && styles.pressed]}
              >
                <Text style={styles.centerBtnGhostText}>{secondaryLabel}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={onPrimary}
              style={({ pressed }) => [
                styles.centerBtn,
                single ? styles.centerBtnFull : null,
                !primaryDestructive && styles.centerBtnPrimary,
                primaryDestructive && styles.centerBtnDanger,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.centerBtnPrimaryText,
                  primaryDestructive && styles.centerBtnDangerText,
                ]}
              >
                {primaryLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DIM,
  },
  actionRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: SHEET_BORDER,
    paddingTop: 6,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: MUTED,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: SHEET_BORDER,
    marginHorizontal: 0,
  },
  actionRow: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  actionRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: SHEET_BORDER,
  },
  actionRowPressed: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actionRowText: {
    fontSize: 17,
    color: TEXT,
    textAlign: 'center',
  },
  actionRowDestructive: {
    color: DESTRUCTIVE,
  },
  actionCancel: {
    fontSize: 17,
    fontWeight: '600',
    color: MUTED,
    textAlign: 'center',
  },
  centerRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  centerCard: {
    backgroundColor: SHEET_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: SHEET_BORDER,
    padding: 22,
  },
  centerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT,
    marginBottom: 10,
  },
  centerMessage: {
    fontSize: 15,
    color: MUTED,
    lineHeight: 22,
    marginBottom: 22,
  },
  centerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
  },
  centerActionsSingle: {
    flexDirection: 'column',
    width: '100%',
  },
  centerBtn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  centerBtnFull: {
    alignSelf: 'stretch',
  },
  centerBtnGhost: {
    borderWidth: 1,
    borderColor: SHEET_BORDER,
  },
  centerBtnGhostText: {
    color: MUTED,
    fontSize: 15,
    fontWeight: '600',
  },
  centerBtnPrimary: {
    backgroundColor: '#c9a227',
  },
  centerBtnPrimaryText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '700',
  },
  centerBtnDanger: {
    backgroundColor: 'rgba(199,92,92,0.25)',
    borderWidth: 1,
    borderColor: DESTRUCTIVE,
  },
  centerBtnDangerText: {
    color: '#e8a0a0',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.88,
  },
});
