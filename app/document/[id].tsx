import { DarkActionSheet, DarkCenterDialog } from '@/components/dark-sheets';
import { useGlobalVoiceChromeBottomInset } from '@/components/global-voice-chrome';
import { useVoiceRouteRegistration } from '@/hooks/useVoiceRouteRegistration';
import { goBackOrHome } from '@/lib/navigation';
import {
  buildPlainTranscript,
  restructureDissertation,
  shareAsTextFile,
} from '@/services/shareExport';
import { useFoldersStore, type Dissertation } from '@/stores/folders-store';
import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Vista de revisión de la disertación, con edición mínima:
 *   - Copiar la conversación completa (icono en la barra).
 *   - Long-press en un turno: copiar / eliminar ese turno.
 *   - «Continuar aquí por voz»: el dock de perfiles está activo en esta
 *     pantalla (target `document`) — tocar un perfil retoma ESTA conversación
 *     con su historial, en vez de crear una nueva.
 */

const BG = '#0A0A0A';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#6a6a6a';
const ACCENT = '#c9a227';
const CARD_USER = '#151515';
const CARD_MODEL = '#101820';
const BORDER = '#2a2a2a';
const BUBBLE_LONG_PRESS_MS = 425;

function paramId(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) return raw[0] ?? '';
  return raw ?? '';
}

function conversationToText(doc: Dissertation): string {
  return doc.messages
    .map((m) => `${m.role === 'user' ? 'Tú' : 'IA'}:\n${m.content}`)
    .join('\n\n');
}

export default function DocumentScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string | string[] }>();
  const id = paramId(idParam);

  // Target de voz `document`: el dock permite CONTINUAR esta conversación.
  useVoiceRouteRegistration('document', id);
  const voiceChromeBottom = useGlobalVoiceChromeBottomInset();

  const dissertations = useFoldersStore((s) => s.dissertations);
  const removeMessage = useFoldersStore((s) => s.removeDissertationMessage);
  const doc = useMemo(
    () => dissertations.find((d: Dissertation) => d.id === id) ?? null,
    [dissertations, id]
  );

  const [turnActionsFor, setTurnActionsFor] = useState<number | null>(null);
  const [copiedTick, setCopiedTick] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const copyAll = async () => {
    if (!doc) return;
    await Clipboard.setStringAsync(conversationToText(doc));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setCopiedTick(true);
    setTimeout(() => setCopiedTick(false), 1600);
  };

  if (!doc) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <Pressable onPress={goBackOrHome} style={styles.backHit} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={28} color="rgba(255,255,255,0.45)" />
          </Pressable>
          <Text style={styles.muted}>Documento no encontrado.</Text>
        </SafeAreaView>
      </View>
    );
  }

  /**
   * Compartir por la hoja del sistema. «Reestructurado» pasa la conversación por
   * Flash y la organiza por temas: un volcado de turnos es una fuente mala para
   * NotebookLM (oralidad, ida y vuelta), y esto lo convierte en documento. En las
   * dos variantes la autoría queda explícita — nunca se funde lo tuyo con lo suyo.
   */
  const shareOptions = [
    {
      key: 'restructured',
      label: 'Reestructurado por temas (recomendado)',
      onPress: () => void doShare(true),
    },
    {
      key: 'raw',
      label: 'Tal cual, la conversación entera',
      onPress: () => void doShare(false),
    },
  ];

  async function doShare(restructure: boolean) {
    if (!doc) return;
    setShareOpen(false);
    const apiKey = resolveGoogleApiKey(useUserSettingsStore.getState().googleApiKey);
    if (restructure && !apiKey) {
      setShareError('El reestructurado necesita tu clave de Google (Ajustes).');
      return;
    }
    setShareBusy(true);
    try {
      let content: string;
      if (restructure) {
        const res = await restructureDissertation({ apiKey, doc });
        if (!res.ok) {
          setShareError(res.error);
          return;
        }
        content = res.text;
      } else {
        content = buildPlainTranscript(doc);
      }
      const shared = await shareAsTextFile(doc.title, content);
      if (!shared.ok) setShareError(shared.error);
    } finally {
      setShareBusy(false);
    }
  }

  const turnOptions =
    turnActionsFor === null
      ? []
      : [
          {
            key: 'copy',
            label: 'Copiar turno',
            onPress: () => {
              const m = doc.messages[turnActionsFor];
              if (m) void Clipboard.setStringAsync(m.content);
            },
          },
          {
            key: 'delete',
            label: 'Eliminar turno',
            destructive: true,
            onPress: () => {
              removeMessage(doc.id, turnActionsFor);
            },
          },
        ];

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={goBackOrHome} style={styles.backHit} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={28} color="rgba(255,255,255,0.45)" />
          </Pressable>
          <Text style={styles.title} numberOfLines={2}>
            {doc.title}
          </Text>
          <Pressable
            onPress={() => void copyAll()}
            style={styles.copyHit}
            accessibilityRole="button"
            accessibilityLabel="Copiar conversación completa"
          >
            <Ionicons
              name={copiedTick ? 'checkmark' : 'copy-outline'}
              size={22}
              color={copiedTick ? ACCENT : 'rgba(255,255,255,0.45)'}
            />
          </Pressable>
          <Pressable
            onPress={() => setShareOpen(true)}
            disabled={shareBusy}
            style={styles.copyHit}
            accessibilityRole="button"
            accessibilityLabel="Compartir conversación"
          >
            {shareBusy ? (
              <ActivityIndicator size="small" color={ACCENT} />
            ) : (
              <Ionicons name="share-outline" size={22} color="rgba(255,255,255,0.45)" />
            )}
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: voiceChromeBottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {doc.messages.map((m, i) => (
            <Pressable
              key={`${m.role}-${i}`}
              onLongPress={() => setTurnActionsFor(i)}
              delayLongPress={BUBBLE_LONG_PRESS_MS}
              style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleModel]}
            >
              <Text style={styles.bubbleLabel}>{m.role === 'user' ? 'Tú' : 'IA'}</Text>
              <Text style={styles.bubbleText}>{m.content}</Text>
            </Pressable>
          ))}
          <Text style={styles.continueHint}>
            Toca un perfil abajo para continuar esta conversación por voz.
          </Text>
        </ScrollView>
      </SafeAreaView>

      <DarkActionSheet
        visible={turnActionsFor !== null}
        title={`Turno de ${turnActionsFor !== null && doc.messages[turnActionsFor]?.role === 'user' ? 'usuario' : 'IA'}`}
        options={turnOptions}
        onClose={() => setTurnActionsFor(null)}
      />

      <DarkActionSheet
        visible={shareOpen}
        title="Compartir cómo"
        options={shareOptions}
        onClose={() => setShareOpen(false)}
      />

      <DarkCenterDialog
        visible={shareError !== null}
        title="Compartir"
        message={shareError ?? ''}
        primaryLabel="Entendido"
        onPrimary={() => setShareError(null)}
        onRequestClose={() => setShareError(null)}
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
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    marginBottom: 8,
  },
  backHit: {
    paddingVertical: 8,
    paddingRight: 4,
    marginLeft: -8,
  },
  copyHit: {
    paddingVertical: 8,
    paddingLeft: 6,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 32,
  },
  bubble: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
  },
  bubbleUser: {
    backgroundColor: CARD_USER,
  },
  bubbleModel: {
    backgroundColor: CARD_MODEL,
  },
  bubbleLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
    marginBottom: 6,
    letterSpacing: 0.6,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    color: TEXT_PRIMARY,
  },
  continueHint: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginTop: 10,
    letterSpacing: 0.3,
  },
  muted: {
    fontSize: 15,
    color: TEXT_MUTED,
    marginTop: 8,
  },
});
