import { useVoiceRouteRegistration } from '@/hooks/useVoiceRouteRegistration';
import { goBackOrHome } from '@/lib/navigation';
import { useFoldersStore, type Dissertation, type Folder } from '@/stores/folders-store';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Búsqueda global: títulos y CONTENIDO de todas las disertaciones + nombres de
 * carpeta. Client-side sobre el store (el corpus de un usuario cabe de sobra
 * en memoria). Sin índice: normalización + includes, con snippet de contexto.
 */

const BG = '#0c0c0c';
const CARD_BG = '#111111';
const BORDER = '#242424';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#5c5c5c';
const ACCENT = '#c9a227';

type Hit =
  | { kind: 'folder'; folder: Folder }
  | { kind: 'doc'; doc: Dissertation; snippet: string };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function makeSnippet(body: string, query: string): string {
  const idx = normalize(body).indexOf(query);
  if (idx < 0) return body.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + query.length + 80);
  return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ')}${end < body.length ? '…' : ''}`;
}

export default function SearchScreen() {
  useVoiceRouteRegistration('off');
  const folders = useFoldersStore((s) => s.folders);
  const dissertations = useFoldersStore((s) => s.dissertations);
  const [query, setQuery] = useState('');

  const hits: Hit[] = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    const out: Hit[] = [];
    for (const f of folders) {
      if (normalize(f.name).includes(q)) out.push({ kind: 'folder', folder: f });
    }
    for (const d of dissertations) {
      const inTitle = normalize(d.title).includes(q);
      const inBody = normalize(d.body).includes(q);
      if (inTitle || inBody) {
        out.push({ kind: 'doc', doc: d, snippet: inBody ? makeSnippet(d.body, q) : d.body.slice(0, 120) });
      }
    }
    return out.slice(0, 50);
  }, [query, folders, dissertations]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={goBackOrHome} style={styles.backHit} accessibilityLabel="Volver">
            <Ionicons name="chevron-back" size={28} color="rgba(255,255,255,0.45)" />
          </Pressable>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar en carpetas y conversaciones…"
            placeholderTextColor={TEXT_MUTED}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} style={styles.clearHit} accessibilityLabel="Limpiar">
              <Ionicons name="close-circle" size={20} color={TEXT_MUTED} />
            </Pressable>
          ) : null}
        </View>

        <FlatList
          data={hits}
          keyExtractor={(h) => (h.kind === 'folder' ? `f-${h.folder.id}` : `d-${h.doc.id}`)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query.trim().length < 2
                ? 'Escribe al menos dos letras.'
                : 'Sin resultados. Prueba con otra palabra.'}
            </Text>
          }
          renderItem={({ item }) =>
            item.kind === 'folder' ? (
              <Pressable
                style={({ pressed }) => [styles.hitCard, pressed && styles.hitPressed]}
                onPress={() =>
                  router.push({ pathname: '/folder/[id]', params: { id: item.folder.id } })
                }
              >
                <Ionicons name="folder-outline" size={18} color={ACCENT} style={styles.hitIcon} />
                <View style={styles.hitBody}>
                  <Text style={styles.hitTitle} numberOfLines={1}>
                    {item.folder.name}
                  </Text>
                  <Text style={styles.hitMeta}>Carpeta</Text>
                </View>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [styles.hitCard, pressed && styles.hitPressed]}
                onPress={() =>
                  router.push({ pathname: '/document/[id]', params: { id: item.doc.id } })
                }
              >
                <Ionicons name="document-text-outline" size={18} color={ACCENT} style={styles.hitIcon} />
                <View style={styles.hitBody}>
                  <Text style={styles.hitTitle} numberOfLines={1}>
                    {item.doc.title}
                  </Text>
                  <Text style={styles.hitSnippet} numberOfLines={2}>
                    {item.snippet}
                  </Text>
                </View>
              </Pressable>
            )
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1, paddingHorizontal: 16 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    marginBottom: 6,
  },
  backHit: { paddingVertical: 8, paddingRight: 4, marginLeft: -8 },
  input: {
    flex: 1,
    fontSize: 16,
    color: TEXT_PRIMARY,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clearHit: { padding: 8 },
  listContent: { paddingBottom: 32, gap: 10 },
  empty: {
    fontSize: 14,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginTop: 40,
  },
  hitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
  },
  hitPressed: { opacity: 0.8 },
  hitIcon: { marginTop: 2 },
  hitBody: { flex: 1 },
  hitTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY },
  hitMeta: { fontSize: 12, color: TEXT_MUTED, marginTop: 2 },
  hitSnippet: { fontSize: 13, color: TEXT_MUTED, marginTop: 4, lineHeight: 18 },
});
