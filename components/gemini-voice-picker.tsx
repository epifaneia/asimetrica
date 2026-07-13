import { synthesizeWithGemini } from '@/services/geminiTtsService';
import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { createAudioPlayer } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#6a6a6a';
const ACCENT = '#c9a227';
const BORDER = '#333333';
const CARD = '#0a0a0a';

const SAMPLE_TEXT =
  'Hola. Soy la voz que Asimétrica usará para leerte la respuesta de la IA. Esta es una prueba breve para que decidas si te encaja.';

/**
 * Voces prebuilt de Gemini TTS (mayo 2026). El modelo soporta 30 voces y 24 idiomas;
 * elegimos un subconjunto razonable con descripción funcional. El usuario puede
 * mantener pulsada una entrada para sintetizar y oírla antes de fijarla.
 */
type VoiceOption = { id: string; description: string };

const VOICES: VoiceOption[] = [
  { id: 'Kore', description: 'Firme · neutral' },
  { id: 'Aoede', description: 'Brillante' },
  { id: 'Charon', description: 'Informativo · grave' },
  { id: 'Fenrir', description: 'Animado' },
  { id: 'Leda', description: 'Joven' },
  { id: 'Orus', description: 'Firme · grave' },
  { id: 'Puck', description: 'Optimista' },
  { id: 'Zephyr', description: 'Brillante · ligera' },
];

const DEFAULT_VOICE = 'Kore';

export function GeminiVoicePicker() {
  const ttsVoiceId = useUserSettingsStore((s) => s.ttsVoiceId);
  const setTtsVoiceId = useUserSettingsStore((s) => s.setTtsVoiceId);
  const googleApiKey = resolveGoogleApiKey(useUserSettingsStore((s) => s.googleApiKey));
  const [tryingVoice, setTryingVoice] = useState<string | null>(null);

  const selectedId = ttsVoiceId || DEFAULT_VOICE;

  const tryVoice = useCallback(
    async (voiceId: string) => {
      if (!googleApiKey) return;
      if (tryingVoice) return;
      setTryingVoice(voiceId);
      try {
        const synth = await synthesizeWithGemini({
          apiKey: googleApiKey,
          text: SAMPLE_TEXT,
          voiceName: voiceId,
        });
        if (!synth.ok) return;
        const player = createAudioPlayer({ uri: synth.audioUri });
        const sub = player.addListener('playbackStatusUpdate', (status) => {
          if (status.isLoaded && status.didJustFinish) {
            sub.remove();
            try {
              player.remove();
            } catch {
              /* ignore */
            }
          }
        });
        player.play();
        // sonido se autodescarga al terminar; mientras tanto liberamos el spinner
        // tras un pequeño delay (no esperamos al fin de reproducción para que el
        // usuario pueda probar otra mientras suena la actual).
        setTimeout(() => setTryingVoice(null), 800);
      } catch {
        setTryingVoice(null);
      }
    },
    [googleApiKey, tryingVoice]
  );

  return (
    <View style={styles.wrap}>
      {!googleApiKey ? (
        <Text style={styles.warning}>
          Configura tu Google API Key arriba para poder probar las voces.
        </Text>
      ) : null}
      {VOICES.map((v) => {
        const selected = selectedId === v.id;
        const trying = tryingVoice === v.id;
        return (
          <Pressable
            key={v.id}
            onPress={() => setTtsVoiceId(v.id)}
            onLongPress={() => void tryVoice(v.id)}
            delayLongPress={350}
            style={({ pressed }) => [
              styles.row,
              selected && styles.rowSelected,
              pressed && styles.rowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Voz ${v.id}, ${v.description}`}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={selected ? ACCENT : TEXT_MUTED}
            />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{v.id}</Text>
              <Text style={styles.rowSub}>{v.description}</Text>
            </View>
            {trying ? (
              <ActivityIndicator size="small" color={ACCENT} />
            ) : (
              <Ionicons name="play-circle-outline" size={20} color={TEXT_MUTED} />
            )}
          </Pressable>
        );
      })}
      <Text style={styles.help}>
        Tap para fijar. Mantén pulsado para probar (genera ~150 KB de audio por prueba).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
    marginTop: 4,
  },
  warning: {
    fontSize: 12,
    color: '#e8a0a0',
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  rowSelected: {
    borderColor: 'rgba(201,162,39,0.55)',
    backgroundColor: '#12100a',
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: 0.5,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12,
    color: TEXT_MUTED,
  },
  help: {
    marginTop: 6,
    fontSize: 11,
    color: TEXT_MUTED,
    fontStyle: 'italic',
  },
});
