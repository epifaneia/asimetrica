import type { AiProfileId } from '@/lib/conversador-profile';
import { ConversadorProfileEditorModal } from '@/components/conversador-profile-editor-modal';
import { GeminiVoicePicker } from '@/components/gemini-voice-picker';
import { useVoiceRouteRegistration } from '@/hooks/useVoiceRouteRegistration';
import {
  AI_PROFILE_ORDER,
  resolveConversadorDisplayName,
  resolveConversadorDockVisual,
} from '@/lib/conversador-profile';
import { goBackOrHome } from '@/lib/navigation';
import {
  clearGoogleSession,
  ensureGoogleAccessToken,
  getGoogleOAuthRedirectUri,
  resolveGoogleOAuthClientId,
} from '@/services/googleOAuthFlow';
import { probeModel } from '@/services/geminiClient';
import { GEMINI_MODELS } from '@/services/geminiModels';
import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import * as Clipboard from 'expo-clipboard';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BG_CHARCOAL = '#0c0c0c';
const TEXT_PRIMARY = '#e8e8e6';
const TEXT_MUTED = '#6a6a6a';
const ACCENT = '#c9a227';
const BORDER = '#333333';
const INPUT_BG = '#0a0a0a';

export default function SettingsScreen() {
  useVoiceRouteRegistration('off');
  const googleApiKey = useUserSettingsStore((s) => s.googleApiKey);
  const setGoogleApiKey = useUserSettingsStore((s) => s.setGoogleApiKey);
  const googleOAuthClientId = useUserSettingsStore((s) => s.googleOAuthClientId);
  const setGoogleOAuthClientId = useUserSettingsStore((s) => s.setGoogleOAuthClientId);
  const googleRefreshToken = useUserSettingsStore((s) => s.googleRefreshToken);

  const ttsEmergencyFallback = useUserSettingsStore((s) => s.ttsEmergencyFallback);
  const setTtsEmergencyFallback = useUserSettingsStore((s) => s.setTtsEmergencyFallback);
  const autoExportOnClose = useUserSettingsStore((s) => s.autoExportOnClose);
  const setAutoExportOnClose = useUserSettingsStore((s) => s.setAutoExportOnClose);
  const pipelineMode = useUserSettingsStore((s) => s.pipelineMode);
  const setPipelineMode = useUserSettingsStore((s) => s.setPipelineMode);
  const recapEnabled = useUserSettingsStore((s) => s.recapEnabled);
  const setRecapEnabled = useUserSettingsStore((s) => s.setRecapEnabled);

  const [keyDraft, setKeyDraft] = useState(googleApiKey);
  const [googleIdDraft, setGoogleIdDraft] = useState(googleOAuthClientId);
  const [googleLinkBusy, setGoogleLinkBusy] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState<string | null>(null);

  /**
   * Valida la key contra los modelos REALES de cada stage: los IDs `*-preview`
   * caducan, y esto lo detecta aquí en vez de a mitad de paseo.
   */
  const handleProbeConnection = async () => {
    const key = keyDraft.trim() || resolveGoogleApiKey('');
    if (!key) {
      setProbeResult('✗ No hay clave que probar.');
      return;
    }
    setProbeBusy(true);
    setProbeResult(null);
    try {
      const models = Array.from(
        new Set([GEMINI_MODELS.sanitize, GEMINI_MODELS.analyze, GEMINI_MODELS.interlocutor])
      );
      const lines: string[] = [];
      for (const m of models) {
        const r = await probeModel(key, m);
        lines.push(`${r.ok ? '✓' : '✗'} ${m}${r.ok ? '' : ` — ${r.error}`}`);
      }
      setProbeResult(lines.join('\n'));
    } finally {
      setProbeBusy(false);
    }
  };
  const conversadorProfiles = useUserSettingsStore((s) => s.conversadorProfiles);
  const [editorProfile, setEditorProfile] = useState<AiProfileId | null>(null);

  useEffect(() => {
    setKeyDraft(googleApiKey);
  }, [googleApiKey]);

  useEffect(() => {
    setGoogleIdDraft(googleOAuthClientId);
  }, [googleOAuthClientId]);

  const redirectUri = getGoogleOAuthRedirectUri();
  const effectiveGoogleClientId = resolveGoogleOAuthClientId(googleOAuthClientId);

  const copyRedirectUri = async () => {
    await Clipboard.setStringAsync(redirectUri);
    Alert.alert('Portapapeles', 'URI de redirección copiada.');
  };

  const onSaveGoogleClientId = () => {
    setGoogleOAuthClientId(googleIdDraft.trim());
    Alert.alert('Google OAuth', 'ID de cliente guardado.');
  };

  const onLinkGoogle = async () => {
    if (!resolveGoogleOAuthClientId(googleIdDraft)) {
      Alert.alert('Google', 'Guarda primero un ID de cliente OAuth válido.');
      return;
    }
    setGoogleLinkBusy(true);
    try {
      setGoogleOAuthClientId(googleIdDraft.trim());
      const token = await ensureGoogleAccessToken();
      if (token) {
        Alert.alert('Google', 'Cuenta vinculada. Ya puedes exportar carpetas a Docs.');
      }
    } finally {
      setGoogleLinkBusy(false);
    }
  };

  const onUnlinkGoogle = () => {
    clearGoogleSession();
    Alert.alert('Google', 'Sesión cerrada en este dispositivo.');
  };

  const editorVisible = editorProfile !== null;
  const closeEditor = useCallback(() => setEditorProfile(null), []);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={goBackOrHome}
            style={({ pressed }) => [styles.backHit, pressed && styles.backPressed]}
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <Ionicons name="chevron-back" size={28} color={TEXT_PRIMARY} />
          </Pressable>
          <Text style={styles.title}>Ajustes</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionTitle}>Google API Key (Gemini)</Text>
          <Text style={styles.help}>
            Clave única para todo el pipeline (STT, sanitiza, analiza, interlocutor, cierre y fusión).
            Cada stage usa el modelo y nivel de razonamiento que mejor le encaja —
            puedes ajustarlos vía <Text style={styles.mono}>EXPO_PUBLIC_GEMINI_*_MODEL</Text> y{' '}
            <Text style={styles.mono}>EXPO_PUBLIC_GEMINI_*_THINKING</Text> en{' '}
            <Text style={styles.mono}>.env</Text>. Defaults: Flash Lite para los pasos ligeros, Pro con
            thinking HIGH para el análisis profundo.
          </Text>
          <TextInput
            value={keyDraft}
            onChangeText={setKeyDraft}
            placeholder="AIzaSy…"
            placeholderTextColor={TEXT_MUTED}
            style={styles.keyInput}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Pressable
            style={({ pressed }) => [styles.saveKeyBtn, pressed && styles.saveKeyBtnPressed]}
            onPress={() => setGoogleApiKey(keyDraft.trim())}
          >
            <Text style={styles.saveKeyText}>Guardar clave</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.probeBtn, pressed && styles.saveKeyBtnPressed]}
            disabled={probeBusy}
            onPress={() => void handleProbeConnection()}
            accessibilityRole="button"
            accessibilityLabel="Probar conexión con Gemini"
          >
            {probeBusy ? (
              <ActivityIndicator size="small" color={ACCENT} />
            ) : (
              <Text style={styles.probeBtnText}>Probar conexión</Text>
            )}
          </Pressable>
          {probeResult ? <Text style={styles.probeResult}>{probeResult}</Text> : null}

          <View style={[styles.sectionHeaderRow, styles.sectionSpaced]}>
            <Ionicons name="options-outline" size={18} color={ACCENT} />
            <Text style={styles.sectionTitleInline}>Sesión de campo</Text>
          </View>
          <Text style={styles.help}>
            Modo del análisis por turno. Profundo es el original; Rápido fusiona transcripción y
            limpieza en una llamada, baja el razonamiento del analista a MEDIUM y acota su
            extensión — apunta a ~1 min por turno en vez de 3-5. Compáralos en paseo real; en
            Diagnóstico ves las latencias de cada uno.
          </Text>
          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeCard, pipelineMode === 'profundo' && styles.modeCardActive]}
              onPress={() => setPipelineMode('profundo')}
              accessibilityRole="radio"
              accessibilityState={{ selected: pipelineMode === 'profundo' }}
            >
              <Ionicons
                name="telescope-outline"
                size={20}
                color={pipelineMode === 'profundo' ? ACCENT : TEXT_MUTED}
              />
              <Text
                style={[styles.modeCardTitle, pipelineMode === 'profundo' && styles.modeCardTitleActive]}
              >
                Profundo
              </Text>
              <Text style={styles.modeCardHint}>Análisis máximo, 3-5 min por turno</Text>
            </Pressable>
            <Pressable
              style={[styles.modeCard, pipelineMode === 'rapido' && styles.modeCardActive]}
              onPress={() => setPipelineMode('rapido')}
              accessibilityRole="radio"
              accessibilityState={{ selected: pipelineMode === 'rapido' }}
            >
              <Ionicons
                name="flash-outline"
                size={20}
                color={pipelineMode === 'rapido' ? ACCENT : TEXT_MUTED}
              />
              <Text
                style={[styles.modeCardTitle, pipelineMode === 'rapido' && styles.modeCardTitleActive]}
              >
                Rápido
              </Text>
              <Text style={styles.modeCardHint}>Lo esencial, ~1 min por turno</Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.toggleRow}
            onPress={() => setRecapEnabled(!recapEnabled)}
            accessibilityRole="switch"
            accessibilityState={{ checked: recapEnabled }}
          >
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>Espera activa (recap)</Text>
              <Text style={styles.help}>
                Mientras el analista piensa, te confirma el perfil, te lee las palabras clave tal cual
                las transcribió y resume en viñetas lo que acabas de decir. Para saltarlo{' '}
                <Text style={styles.helpEmphasis}>solo en un turno</Text> no vengas aquí: pulsa el
                botón del cable mientras habla. Esto es el apagado permanente.
              </Text>
            </View>
            <Ionicons
              name={recapEnabled ? 'checkbox' : 'square-outline'}
              size={24}
              color={recapEnabled ? ACCENT : TEXT_MUTED}
            />
          </Pressable>
          <Pressable
            style={styles.toggleRow}
            onPress={() => setTtsEmergencyFallback(!ttsEmergencyFallback)}
            accessibilityRole="switch"
            accessibilityState={{ checked: ttsEmergencyFallback }}
          >
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>Voz de emergencia</Text>
              <Text style={styles.help}>
                Si el TTS de Gemini falla (red, cuota), responde con la voz del sistema en vez de
                cortar la sesión. Voz peor, paseo intacto.
              </Text>
            </View>
            <Ionicons
              name={ttsEmergencyFallback ? 'checkbox' : 'square-outline'}
              size={24}
              color={ttsEmergencyFallback ? ACCENT : TEXT_MUTED}
            />
          </Pressable>
          <Pressable
            style={styles.toggleRow}
            onPress={() => setAutoExportOnClose(!autoExportOnClose)}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoExportOnClose }}
          >
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>Auto-export al cerrar</Text>
              <Text style={styles.help}>
                Al terminar cada sesión, sube la conversación a Google Docs en silencio (requiere
                tener Google vinculado más abajo). Tu copia de seguridad en Drive, sin pensar en ello.
              </Text>
            </View>
            <Ionicons
              name={autoExportOnClose ? 'checkbox' : 'square-outline'}
              size={24}
              color={autoExportOnClose ? ACCENT : TEXT_MUTED}
            />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.toggleRow, styles.sectionSpaced, pressed && { opacity: 0.85 }]}
            onPress={() => router.push('/library')}
            accessibilityRole="button"
            accessibilityLabel="Abrir biblioteca de obra"
          >
            <View style={styles.toggleTextWrap}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="library-outline" size={18} color={ACCENT} />
                <Text style={styles.sectionTitleInline}>Biblioteca de obra</Text>
              </View>
              <Text style={styles.help}>
                Sube tu obra, tus normas o tu manual: actúan como{' '}
                <Text style={styles.helpEmphasis}>jaula</Text> (canon vinculante) en las carpetas
                que elijas.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={TEXT_MUTED} />
          </Pressable>

          <View style={[styles.sectionHeaderRow, styles.sectionSpaced]}>
            <Ionicons name="pencil-outline" size={18} color={ACCENT} />
            <Text style={styles.sectionTitleInline}>Editar perfil de conversador</Text>
          </View>
          <Text style={styles.help}>
            Toca un perfil: nombre, icono del dock e instrucciones que marcan la{' '}
            <Text style={styles.helpEmphasis}>personalidad del texto que se guarda</Text> en la
            disertación (mismo texto que luego puede leer Kokoro). No cambia el análisis interno del paso
            2.
          </Text>
          <View style={styles.profileEditGrid}>
            {AI_PROFILE_ORDER.map((p) => {
              const visual = resolveConversadorDockVisual(p, conversadorProfiles);
              const label = resolveConversadorDisplayName(p, conversadorProfiles);
              return (
                <Pressable
                  key={p}
                  onPress={() => setEditorProfile(p)}
                  style={({ pressed }) => [styles.profileEditCard, pressed && styles.profileEditPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Editar conversador ${label}`}
                >
                  <View style={styles.profileEditIconWrap}>
                    {visual.kind === 'image' ? (
                      <ExpoImage
                        source={visual.source}
                        style={styles.profileEditImage}
                        contentFit="cover"
                      />
                    ) : (
                      <Ionicons
                        name={visual.name as keyof typeof Ionicons.glyphMap}
                        size={22}
                        color={ACCENT}
                      />
                    )}
                  </View>
                  <Text style={styles.profileEditName}>{label}</Text>
                  <Text style={styles.profileEditId}>{p}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Exportar a Google Docs</Text>
          <Text style={styles.help}>
            No basta con escribir un correo: Google exige iniciar sesión y aceptar permisos (OAuth). Puedes usar
            un ID de cliente propio (BYOK) o definir{' '}
            <Text style={styles.mono}>EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID</Text> en{' '}
            <Text style={styles.mono}>.env</Text>. En Google Cloud Console: APIs habilitadas Google Drive + Google
            Docs, pantalla de consentimiento, y un ID de cliente OAuth. Para apps móviles con esquema custom usa
            tipo <Text style={styles.helpEmphasis}>«Aplicación de escritorio»</Text> (acepta redirecciones
            arbitrarias) o un cliente Android/iOS si haces dev build con SHA-1 / bundle ID. El tipo «Aplicación
            web» rechaza esquemas no-https. Añade esta URI de redirección autorizada:
          </Text>
          <View style={styles.redirectRow}>
            <Text style={styles.redirectUri} selectable>
              {redirectUri}
            </Text>
            <Pressable
              onPress={copyRedirectUri}
              style={({ pressed }) => [styles.copyBtn, pressed && styles.copyBtnPressed]}
            >
              <Text style={styles.copyBtnText}>Copiar</Text>
            </Pressable>
          </View>
          <Text style={styles.help}>
            Estado: {googleRefreshToken ? 'Cuenta vinculada' : 'Sin vincular'} · Cliente configurado:{' '}
            {effectiveGoogleClientId ? 'sí' : 'no'}
          </Text>
          <TextInput
            value={googleIdDraft}
            onChangeText={setGoogleIdDraft}
            placeholder="xxx.apps.googleusercontent.com (opcional si usas .env)"
            placeholderTextColor={TEXT_MUTED}
            style={styles.keyInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.googleBtnRow}>
            <Pressable
              style={({ pressed }) => [styles.saveKeyBtn, pressed && styles.saveKeyBtnPressed]}
              onPress={onSaveGoogleClientId}
            >
              <Text style={styles.saveKeyText}>Guardar ID cliente</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.saveKeyBtn, pressed && styles.saveKeyBtnPressed]}
              onPress={onLinkGoogle}
              disabled={googleLinkBusy}
            >
              {googleLinkBusy ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.saveKeyText}>Vincular Google</Text>
              )}
            </Pressable>
          </View>
          <Pressable
            style={({ pressed }) => [styles.btnGhost, pressed && styles.btnGhostPressed]}
            onPress={onUnlinkGoogle}
          >
            <Text style={styles.btnGhostText}>Cerrar sesión Google</Text>
          </Pressable>

          <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Voz</Text>
          <Text style={styles.help}>
            Asimétrica usa la API TTS de Gemini (`gemini-3.1-flash-tts-preview`) para reproducir
            las respuestas. Voces neurales reales con BYOK; ~$0.02 por turno de coste estimado.
            Mantén pulsada una entrada para oír una muestra antes de fijarla.
          </Text>
          <GeminiVoicePicker />

          <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Diagnóstico</Text>
          <Text style={styles.help}>
            Log rolling de las últimas 100 llamadas a Gemini: stage, modelo, latencia, error si lo hay.
            Útil cuando algo falla y el chrome de campo (sin pantalla) solo te avisa con la vibración ❌.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btnGhost, pressed && styles.btnGhostPressed]}
            onPress={() => router.push('/diagnostico')}
          >
            <Text style={styles.btnGhostText}>Ver log de diagnóstico</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <ConversadorProfileEditorModal
        visible={editorVisible}
        profile={editorProfile}
        onClose={closeEditor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG_CHARCOAL,
  },
  safe: {
    flex: 1,
    backgroundColor: BG_CHARCOAL,
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
  },
  backHit: {
    paddingVertical: 8,
    paddingRight: 12,
    marginLeft: -8,
  },
  backPressed: {
    opacity: 0.65,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 44,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitleInline: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionSpaced: {
    marginTop: 28,
  },
  help: {
    fontSize: 14,
    color: TEXT_MUTED,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 12,
  },
  helpEmphasis: {
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    color: ACCENT,
  },
  keyInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: TEXT_PRIMARY,
    backgroundColor: INPUT_BG,
  },
  saveKeyBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: ACCENT,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  saveKeyBtnPressed: {
    opacity: 0.88,
  },
  saveKeyText: {
    color: '#0a0a0a',
    fontWeight: '700',
    fontSize: 14,
  },
  probeBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: ACCENT,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 10,
    minWidth: 140,
    alignItems: 'center',
  },
  probeBtnText: {
    color: ACCENT,
    fontWeight: '700',
    fontSize: 13,
  },
  probeResult: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: TEXT_PRIMARY,
    fontFamily: Platform.select({ android: 'monospace', default: 'Courier' }),
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  modeCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: INPUT_BG,
  },
  modeCardActive: {
    borderColor: ACCENT,
    backgroundColor: '#12100a',
  },
  modeCardTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '700',
    color: TEXT_MUTED,
  },
  modeCardTitleActive: {
    color: TEXT_PRIMARY,
  },
  modeCardHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: TEXT_MUTED,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    paddingVertical: 6,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    marginBottom: 2,
  },
  profileEditGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  profileEditCard: {
    width: '47%',
    flexGrow: 1,
    minWidth: 140,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: INPUT_BG,
  },
  profileEditPressed: {
    opacity: 0.88,
    borderColor: '#444',
  },
  profileEditIconWrap: {
    marginBottom: 8,
  },
  profileEditImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  profileEditName: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  profileEditId: {
    marginTop: 4,
    fontSize: 11,
    color: TEXT_MUTED,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  redirectRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  redirectUri: {
    flex: 1,
    fontSize: 11,
    color: ACCENT,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    lineHeight: 16,
  },
  copyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  copyBtnPressed: {
    opacity: 0.85,
  },
  copyBtnText: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '600',
  },
  googleBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  btnGhost: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnGhostPressed: {
    opacity: 0.85,
  },
  btnGhostText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: '600',
  },
});
