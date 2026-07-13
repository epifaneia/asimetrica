import { useVoiceRouteRegistration } from '@/hooks/useVoiceRouteRegistration';
import { goBackOrHome } from '@/lib/navigation';
import { useDiagnosticStore, type DiagnosticEntry } from '@/stores/diagnostic-store';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG = '#0c0c0c';
const CARD = '#111111';
const BORDER = '#242424';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#6a6a6a';
const ACCENT = '#c9a227';
const OK_COLOR = '#5e8c5a';
const ERR_COLOR = '#c75c5c';

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function entryToText(e: DiagnosticEntry): string {
  const parts = [
    `[${formatTimestamp(e.timestamp)}]`,
    e.stage,
    e.model ?? '?',
    `${e.latencyMs}ms`,
    e.ok ? 'OK' : 'ERR',
  ];
  if (e.error) parts.push(`— ${e.error}`);
  return parts.join(' · ');
}

export default function DiagnosticoScreen() {
  useVoiceRouteRegistration('off');
  const entries = useDiagnosticStore((s) => s.entries);
  const clear = useDiagnosticStore((s) => s.clear);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const headerStats = useMemo(() => {
    const total = entries.length;
    const errors = entries.filter((e) => !e.ok).length;
    return `${total} entradas · ${errors} con error`;
  }, [entries]);

  // Consumo BYOK: suma de usage reportado por la API en las entradas visibles
  // (rolling 100). Orientativo — el coste real depende del pricing por modelo.
  const tokenStats = useMemo(() => {
    let tokensIn = 0;
    let tokensOut = 0;
    let withUsage = 0;
    for (const e of entries) {
      if (e.tokensIn || e.tokensOut) withUsage++;
      tokensIn += e.tokensIn ?? 0;
      tokensOut += e.tokensOut ?? 0;
    }
    if (withUsage === 0) return null;
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return `tokens (últimas ${entries.length}): ${fmt(tokensIn)} entrada · ${fmt(tokensOut)} salida`;
  }, [entries]);

  const onCopy = async () => {
    if (entries.length === 0) {
      Alert.alert('Diagnóstico', 'No hay entradas que copiar.');
      return;
    }
    const text = entries.map(entryToText).join('\n');
    await Clipboard.setStringAsync(text);
    Alert.alert('Diagnóstico', 'Log copiado al portapapeles.');
  };

  const onClear = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 3000);
      return;
    }
    clear();
    setConfirmingClear(false);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={goBackOrHome} style={styles.backHit} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={28} color="rgba(255,255,255,0.45)" />
          </Pressable>
          <Text style={styles.title}>Diagnóstico</Text>
          <View style={styles.spacer} />
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.meta}>{headerStats}</Text>
          {tokenStats ? <Text style={styles.meta}>{tokenStats}</Text> : null}
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            onPress={onCopy}
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            accessibilityLabel="Copiar log al portapapeles"
          >
            <Text style={styles.actionBtnText}>Copiar log</Text>
          </Pressable>
          <Pressable
            onPress={onClear}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnDanger,
              confirmingClear && styles.actionBtnDangerArmed,
              pressed && styles.actionBtnPressed,
            ]}
            accessibilityLabel="Limpiar log"
          >
            <Text style={[styles.actionBtnText, styles.actionBtnDangerText]}>
              {confirmingClear ? '¿Seguro?' : 'Limpiar'}
            </Text>
          </Pressable>
        </View>

        {entries.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Sin entradas todavía.</Text>
            <Text style={styles.emptySub}>
              Cada llamada a Gemini se registra aquí (stage, modelo, latencia, error si lo hay).
            </Text>
          </View>
        ) : (
          <FlatList
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={entries}
            keyExtractor={(e) => e.id}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <View style={styles.entry}>
                <View style={styles.entryHeader}>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: item.ok ? OK_COLOR : ERR_COLOR },
                    ]}
                  />
                  <Text style={styles.entryStage}>{item.stage}</Text>
                  <Text style={styles.entryLatency}>{item.latencyMs}ms</Text>
                </View>
                <Text style={styles.entryMeta}>{formatTimestamp(item.timestamp)}</Text>
                {item.model ? <Text style={styles.entryModel}>{item.model}</Text> : null}
                {item.tokensIn || item.tokensOut ? (
                  <Text style={styles.entryMeta}>
                    {`${item.tokensIn ?? 0} tok in · ${item.tokensOut ?? 0} tok out${item.retries ? ` · ${item.retries} reintento${item.retries === 1 ? '' : 's'}` : ''}`}
                  </Text>
                ) : null}
                {item.error ? <Text style={styles.entryError}>{item.error}</Text> : null}
              </View>
            )}
          />
        )}
      </SafeAreaView>
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
    paddingVertical: 8,
  },
  backHit: {
    paddingVertical: 8,
    paddingRight: 12,
    marginLeft: -8,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    textAlign: 'center',
  },
  spacer: {
    width: 44,
  },
  metaRow: {
    paddingVertical: 8,
  },
  meta: {
    fontSize: 12,
    color: TEXT_MUTED,
    letterSpacing: 0.4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  actionBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  actionBtnPressed: {
    opacity: 0.85,
  },
  actionBtnDanger: {
    borderColor: 'rgba(199,92,92,0.4)',
  },
  actionBtnDangerArmed: {
    backgroundColor: 'rgba(199,92,92,0.18)',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  actionBtnDangerText: {
    color: '#e8a0a0',
  },
  list: {
    flex: 1,
    marginTop: 8,
  },
  listContent: {
    paddingBottom: 32,
    gap: 8,
  },
  entry: {
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  entryStage: {
    fontSize: 13,
    fontWeight: '700',
    color: ACCENT,
    letterSpacing: 0.5,
    flex: 1,
  },
  entryLatency: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontVariant: ['tabular-nums'],
  },
  entryMeta: {
    marginTop: 4,
    fontSize: 11,
    color: TEXT_MUTED,
  },
  entryModel: {
    marginTop: 4,
    fontSize: 11,
    color: TEXT_MUTED,
    fontStyle: 'italic',
  },
  entryError: {
    marginTop: 6,
    fontSize: 12,
    color: '#e8a0a0',
    lineHeight: 16,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    color: TEXT_PRIMARY,
    fontWeight: '600',
  },
  emptySub: {
    marginTop: 8,
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 17,
  },
});
