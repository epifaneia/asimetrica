import {
  AMBIENT_LEVEL_MIC,
  AMBIENT_LEVEL_UNDER_VOICE,
  AMBIENT_LEVEL_WAITING,
} from '@/constants/ambient-asset';
import { DOCK_FAB_SIZE, DOCK_VERTICAL_PADDING } from '@/constants/dock-metrics';
import { ensureAmbientBed, setAmbientLevel } from '@/services/ambientLoopService';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useWiredMediaCambio } from '@/hooks/useWiredMediaCambio';
import {
  AI_PROFILE_ORDER,
  resolveConversadorDisplayName,
  resolveConversadorDockVisual,
  resolveConversadorSystemPrompt,
  type AiProfileId,
} from '@/lib/conversador-profile';
import {
  playAckCue,
  playNegativeCue,
  playPositiveCue,
  playRecordingCue,
  preloadFeedbackCues,
} from '@/services/feedbackCues';
import type { GeminiPipelineStage } from '@/services/geminiPipelineService';
import { runGeminiDissertationPipeline } from '@/services/geminiPipelineService';
import { transcribeAudioWithGemini } from '@/services/geminiTranscriptionService';
import { exportDissertationToGoogleDoc } from '@/services/googleDocsExport';
import { getGoogleAccessTokenSilently } from '@/services/googleOAuthFlow';
import { preservePendingAudio } from '@/services/pendingTurnsService';
import {
  disposeRecap,
  isRecapSpeaking,
  preemptRecap,
  skipRecapSpeech,
  startRecap,
  stopRecapFlow,
} from '@/services/recapPlaybackService';
import { generateDissertationTitle } from '@/services/titleGenService';
import { playDissertationTts, stopActiveTtsPlayback } from '@/services/ttsPlaybackService';
import { useFoldersStore } from '@/stores/folders-store';
import { usePendingTurnsStore } from '@/stores/pending-turns-store';
import { resolveGoogleApiKey, useUserSettingsStore } from '@/stores/user-settings-store';
import { useVoiceRouteStore } from '@/stores/voice-route-store';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACCENT = '#c9a227';
const FAB_ICON = '#0a0a0a';
const FAB_BORDER = 'rgba(0,0,0,0.42)';
const AMBER_RING = 'rgba(201,162,39,0.55)';
const ICON_SIZE = 30;

const TEXT_MUTED = '#6a6a6a';
const PAUSE_LABEL = '#c4c4c0';

type Phase = 'RECORDING' | 'PROCESSING' | 'PLAYING';
type BusyPhase = null | 'transcribing' | GeminiPipelineStage;

/**
 * Dispara la generación de título (Flash Lite) tras cerrar la conversación. Fire-and-forget:
 * el usuario ya está fuera de la sesión, el título aparece cuando llega.
 */
function kickOffTitleGen(apiKey: string, docId: string): void {
  if (!apiKey || !docId) return;
  const history = useFoldersStore.getState().dissertations.find((d) => d.id === docId)?.messages ?? [];
  if (history.length === 0) return;
  void generateDissertationTitle({ apiKey, history }).then((res) => {
    if (res.ok) {
      useFoldersStore.getState().setDissertationTitle(docId, res.title);
    }
  });
}

/**
 * Auto-export a Google Docs al cerrar sesión (toggle en Ajustes). Fire-and-forget
 * y SIEMPRE silencioso: si no hay token refrescable, no molesta — el usuario
 * exporta a mano cuando quiera. Pequeño delay para que title-gen llegue antes.
 */
function kickOffAutoExport(docId: string): void {
  if (!useUserSettingsStore.getState().autoExportOnClose) return;
  setTimeout(() => {
    void (async () => {
      try {
        const token = await getGoogleAccessTokenSilently();
        if (!token) return;
        const d = useFoldersStore.getState().dissertations.find((x) => x.id === docId);
        if (!d) return;
        await exportDissertationToGoogleDoc({ accessToken: token, dissertation: d });
      } catch {
        /* auto-export es best-effort: el dato sigue en local */
      }
    })();
  }, 8_000);
}


type Session = {
  profile: AiProfileId;
  /** Doc destino. `null` hasta que termina el primer turno y se crea la disertación. */
  docId: string | null;
};

/** Carpeta destino implícita del turno actual (misma lógica que la persistencia). */
function resolveTargetFolderId(): string | null {
  const t = useVoiceRouteStore.getState().target;
  if (t?.kind === 'folder') return t.folderId;
  if (t?.kind === 'dashboard') {
    const sorted = [...useFoldersStore.getState().folders].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    return sorted[0]?.id ?? null;
  }
  return null;
}

/**
 * El turno falló (red/Gemini): el audio NO se tira. Se mueve a almacenamiento
 * persistente y se encola en la bandeja de pendientes para reprocesar después.
 */
async function enqueueFailedTurn(
  audioUri: string,
  profile: AiProfileId,
  docId: string | null,
  closingMode: boolean
): Promise<void> {
  const preserved = await preservePendingAudio(audioUri);
  if (!preserved) return;
  usePendingTurnsStore.getState().addPending({
    audioUri: preserved,
    profile,
    docId,
    folderId: docId ? null : resolveTargetFolderId(),
    closingMode,
  });
}

/**
 * Modo campo: el chrome global posee la máquina de estados de la conversación.
 *   - Sin sesión activa: el dock de perfiles. Tocar perfil arranca sesión.
 *   - Con sesión activa: pantalla "blackout" con pulso constante + Cambio (mic/cable) + Corto.
 *     Nunca navega a `/document/[id]` durante el flujo. Solo persiste y vuelve a dashboard al cerrar.
 *
 * Fases dentro de la sesión: RECORDING → PROCESSING → PLAYING → (loop). El icono del
 * círculo las comunica (mic = hablas tú, cerebro = piensa, auricular = escuchas),
 * además de los cues de audio (voz IA / silencio / chime).
 */
export function GlobalVoiceChrome() {
  const insets = useSafeAreaInsets();
  const target = useVoiceRouteStore((s) => s.target);
  const conversadorProfiles = useUserSettingsStore((s) => s.conversadorProfiles);
  const storedGoogleKey = useUserSettingsStore((s) => s.googleApiKey);
  const googleApiKey = resolveGoogleApiKey(storedGoogleKey);

  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>('RECORDING');
  const [busyPhase, setBusyPhase] = useState<BusyPhase>(null);

  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const phaseRef = useRef<Phase>('RECORDING');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  /** Pulsado en PROCESSING para saltar el TTS cuando llegue. */
  const skipTtsRef = useRef(false);
  /** Corto pulsado en PROCESSING de un turno normal: cierre tras este turno. */
  const cortoQueuedRef = useRef(false);
  /** TTS detenido por el chrome (no por fin natural): no disparar cue ✅. */
  const ttsManuallyStoppedRef = useRef(false);

  const pulseAnim = useRef(new Animated.Value(0.45)).current;
  const processingDotsAnim = useRef(new Animated.Value(0)).current;

  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  // Mantiene la pantalla encendida solo durante la sesión.
  useKeepAwake(session ? 'asimetrica-session' : undefined);

  // Precarga de earcons: el primer cue de la sesión debe sonar sin latencia.
  useEffect(() => {
    preloadFeedbackCues();
  }, []);

  // Pulso constante mientras dure la sesión. No varía por fase.
  useEffect(() => {
    if (!session) {
      pulseAnim.setValue(0.45);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 1100, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [session, pulseAnim]);

  // Tres puntitos pulsando solo durante PROCESSING: confirmación discreta de "pensando".
  useEffect(() => {
    if (phase !== 'PROCESSING') {
      processingDotsAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(processingDotsAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(processingDotsAnim, { toValue: 0.2, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, processingDotsAnim]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const endSession = useCallback(() => {
    // Resolver folder destino ANTES de limpiar sesión: el usuario aterriza donde vive su nueva conv,
    // no en dashboard, para no tener que buscarla.
    const docId = sessionRef.current?.docId ?? null;
    let landingFolderId: string | null = null;
    if (docId) {
      const doc = useFoldersStore.getState().dissertations.find((d) => d.id === docId);
      landingFolderId = doc?.folderId ?? null;
      // Title gen al cierre, fire-and-forget. Único punto centralizado.
      if (googleApiKey) kickOffTitleGen(googleApiKey, docId);
      kickOffAutoExport(docId);
    }
    usePendingTurnsStore.getState().clearSessionMark();
    // Nada del hilo corto puede sobrevivir a la sesión: corta voz y colchón, y
    // libera el reproductor del ambiente.
    disposeRecap();

    setSession(null);
    setPhase('RECORDING');
    setBusyPhase(null);
    skipTtsRef.current = false;
    cortoQueuedRef.current = false;
    ttsManuallyStoppedRef.current = false;

    if (landingFolderId) {
      router.replace({ pathname: '/folder/[id]', params: { id: landingFolderId } });
    } else {
      router.replace('/');
    }
  }, [googleApiKey]);

  const autoRestartRecording = useCallback(async () => {
    if (!sessionRef.current) return;
    // Defensivo: se abre el mic, así que nada del turno anterior puede seguir
    // sonando (un turno KO sale por aquí sin pasar por la pisada de la respuesta).
    stopRecapFlow();
    // Cama a cero mientras grabas: el micro está abierto y es tu turno de pensar.
    setAmbientLevel(AMBIENT_LEVEL_MIC);
    setPhase('RECORDING');
    const r = await startRecording();
    if (!r.ok) {
      playNegativeCue();
      endSession();
      return;
    }
    playRecordingCue(); // "adelante": mic abierto, se oye por el cable
  }, [startRecording, endSession]);

  const speakReplyOrSkip = useCallback(
    async (text: string, onNaturalEnd: () => void) => {
      // Usuario pre-saltó la respuesta antes de que llegara: cortar recap y cama
      // SIN bip de relevo (no viene voz después; el cue ✅ + el de mic ya cuentan
      // la transición).
      if (skipTtsRef.current) {
        preemptRecap();
        skipTtsRef.current = false;
        playPositiveCue();
        onNaturalEnd();
        return;
      }

      ttsManuallyStoppedRef.current = false;
      await playDissertationTts(
        text,
        (reason) => {
          const wasManual = ttsManuallyStoppedRef.current;
          ttsManuallyStoppedRef.current = false;
          if (wasManual) return;
          if (reason === 'error') {
            playNegativeCue();
          } else {
            playPositiveCue();
          }
          onNaturalEnd();
        },
        {
          /**
           * PISADA TARDÍA. Este callback salta cuando el AUDIO ya está listo, no
           * cuando llega el texto. Antes se cortaba el recap y sonaba el bip al
           * recibir el texto, y luego venían ~12-15 s de silencio esperando la
           * síntesis (medido). Ahora el recap o la cama cubren esa espera y el
           * bip es honesto: suena y habla.
           */
          onSpeechAboutToStart: async () => {
            // Pulsación durante la síntesis: no reproducir nada.
            if (skipTtsRef.current) {
              skipTtsRef.current = false;
              stopRecapFlow();
              return false;
            }
            preemptRecap();
            setPhase('PLAYING');
            playAckCue();
            // La cama no se para: solo baja a nivel de voz.
            setAmbientLevel(AMBIENT_LEVEL_UNDER_VOICE);
            // Que el bip no se solape con la primera palabra.
            await new Promise<void>((r) => setTimeout(r, 320));
            if (skipTtsRef.current) {
              skipTtsRef.current = false;
              return false;
            }
            return true;
          },
        }
      );
    },
    []
  );

  const runTurnPipeline = useCallback(
    async (
      audioUri: string,
      profile: AiProfileId,
      closingMode = false
    ): Promise<{ ok: true; finalReply: string } | { ok: false }> => {
      setPhase('PROCESSING');
      setBusyPhase('transcribing');
      // Cama arriba en cuanto callas: cubre el hueco del STT (antes silencio puro
      // tras el bip de recibido) y toda la espera si el recap está apagado o es
      // el turno de Corto. Si el recap habla, él la baja a nivel de voz.
      setAmbientLevel(AMBIENT_LEVEL_WAITING);

      // Modo rápido: STT devuelve texto ya sanitizado y el pipeline salta el stage 1.
      const fastMode = useUserSettingsStore.getState().pipelineMode === 'rapido';
      const tr = await transcribeAudioWithGemini({
        apiKey: googleApiKey,
        fileUri: audioUri,
        sanitize: fastMode,
      });
      if (!tr.ok) {
        setBusyPhase(null);
        // El audio NO se pierde: a la bandeja de pendientes para reprocesar.
        await enqueueFailedTurn(audioUri, profile, sessionRef.current?.docId ?? null, closingMode);
        playNegativeCue();
        return { ok: false };
      }

      const sess = sessionRef.current;
      if (!sess) {
        setBusyPhase(null);
        return { ok: false };
      }

      let docId = sess.docId;
      let history: { role: 'user' | 'model'; content: string }[] = [];
      if (docId) {
        history = useFoldersStore.getState().dissertations.find((d) => d.id === docId)?.messages ?? [];
      }

      const settings = useUserSettingsStore.getState();
      const interlocutorPrompt = resolveConversadorSystemPrompt(
        profile,
        settings.conversadorProfiles
      );

      let appendedUserLine = false;
      const result = await runGeminiDissertationPipeline({
        apiKey: googleApiKey,
        rawUserText: tr.text,
        history,
        profile,
        interlocutorSystemPrompt: interlocutorPrompt,
        closingMode,
        fastMode,
        onStage: (stage) => setBusyPhase(stage),
        // Punto de bifurcación de los dos hilos: aquí ya hay texto del usuario y
        // el analista (Pro, thinking HIGH) está a punto de arrancar. El recap sale
        // AHORA, en paralelo, para ocupar ese tiempo muerto — nunca antes, o
        // estaríamos alargando la espera en vez de taparla.
        onSanitizedUser: (sanitized) => {
          if (docId) {
            useFoldersStore.getState().appendDissertationUserMessage(docId, sanitized);
            appendedUserLine = true;
          }
          if (settings.recapEnabled && !closingMode) {
            void startRecap({ apiKey: googleApiKey, text: sanitized, profile });
          }
        },
      });

      setBusyPhase(null);

      if (!result.ok) {
        if (appendedUserLine && docId) {
          useFoldersStore.getState().removeLastUserMessage(docId);
        }
        // Pipeline KO tras transcribir: se conserva el audio igualmente (la
        // transcripción es barata; lo insustituible es tu voz).
        await enqueueFailedTurn(audioUri, profile, docId, closingMode);
        playNegativeCue();
        return { ok: false };
      }

      // Persist
      if (docId) {
        useFoldersStore.getState().appendDissertationAssistantMessage(docId, result.finalReply);
      } else {
        // Primer turno desde dashboard / folder: hay que crear disertación.
        const t = useVoiceRouteStore.getState().target;
        let folderId: string | null = null;
        if (t?.kind === 'folder') {
          folderId = t.folderId;
        } else if (t?.kind === 'dashboard') {
          const sortedFolders = [...useFoldersStore.getState().folders].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt)
          );
          folderId = sortedFolders[0]?.id ?? null;
        }
        if (!folderId) {
          playNegativeCue();
          return { ok: false };
        }
        const newId = useFoldersStore
          .getState()
          .addDissertationWithAiExchange(folderId, result.sanitizedUser, result.finalReply);
        if (!newId) {
          playNegativeCue();
          return { ok: false };
        }
        docId = newId;
        // sync update del ref: endSession se llama justo tras el await y necesita el docId YA,
        // sin esperar al re-render para que useEffect propague a sessionRef.
        if (sessionRef.current) {
          sessionRef.current = { ...sessionRef.current, docId: newId };
        }
        setSession((s) => (s ? { ...s, docId: newId } : s));
        usePendingTurnsStore.getState().updateSessionDocId(newId);
      }

      return { ok: true, finalReply: result.finalReply };
    },
    [googleApiKey]
  );

  // ---------------------------------------------------------------------------
  // Acciones del usuario
  // ---------------------------------------------------------------------------

  const startSession = useCallback(
    async (profile: AiProfileId) => {
      if (sessionRef.current) return;
      if (!googleApiKey) {
        playNegativeCue();
        Alert.alert(
          'API Key',
          'Configura tu clave de Google en Ajustes o EXPO_PUBLIC_GOOGLE_API_KEY en .env'
        );
        return;
      }
      // Desde la vista de documento, la sesión CONTINÚA esa conversación
      // (historial incluido); en carpeta/dashboard arranca disertación nueva.
      const t = useVoiceRouteStore.getState().target;
      const initialDocId = t?.kind === 'document' ? t.documentId : null;
      setSession({ profile, docId: initialDocId });
      // La cama arranca con la sesión y no se para hasta cerrarla: solo cambia de
      // nivel. Empieza a cero porque lo primero es grabar.
      ensureAmbientBed();
      setAmbientLevel(AMBIENT_LEVEL_MIC, 0);
      setPhase('RECORDING');
      const r = await startRecording();
      if (!r.ok) {
        playNegativeCue();
        Alert.alert('Micrófono', r.message);
        setSession(null);
        return;
      }
      // Sello de sesión: si la app muere a mitad, el dashboard ofrece retomar.
      usePendingTurnsStore.getState().markSessionActive({
        profile,
        docId: initialDocId,
        startedAt: new Date().toISOString(),
      });
      playRecordingCue();
    },
    [googleApiKey, startRecording]
  );

  const onCambio = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    const ph = phaseRef.current;

    if (ph === 'RECORDING') {
      if (!isRecording) return;
      const stopped = await stopRecording();
      if (!stopped.ok) {
        playNegativeCue();
        await autoRestartRecording();
        return;
      }
      playAckCue(); // "recibido": el turno entra a proceso
      const turn = await runTurnPipeline(stopped.uri, sess.profile);
      if (!turn.ok) {
        await autoRestartRecording();
        return;
      }

      // Si Corto se metió en cola durante PROCESSING, la respuesta de este turno ES la
      // última. Se persistió arriba; aquí silenciamos su voz y salimos sin latido extra.
      if (cortoQueuedRef.current) {
        cortoQueuedRef.current = false;
        skipTtsRef.current = false;
        ttsManuallyStoppedRef.current = false;
        endSession();
        return;
      }

      await speakReplyOrSkip(turn.finalReply, () => {
        void autoRestartRecording();
      });
      return;
    }

    if (ph === 'PROCESSING') {
      // Con VOZ del recap sonando, la simple significa "cállate" — no "salta la
      // respuesta". Es el gesto de la cultura de la app: cero pantallas, decisión
      // tuya, cero heurísticas adivinando por ti. La voz para; el colchón sigue
      // cubriendo la espera, porque lo que molesta es la charla, no el sonido.
      if (isRecapSpeaking()) {
        skipRecapSpeech();
        playPositiveCue();
        return;
      }
      // Solo colchón (o recap apagado): significado clásico. Pre-interrupción:
      // la próxima TTS no se reproduce, pasa directo a tu turno.
      skipTtsRef.current = true;
      playPositiveCue();
      return;
    }

    if (ph === 'PLAYING') {
      // Interrumpir TTS en marcha y abrir mic.
      ttsManuallyStoppedRef.current = true;
      await stopActiveTtsPlayback();
      playPositiveCue();
      await autoRestartRecording();
      return;
    }
  }, [
    isRecording,
    stopRecording,
    runTurnPipeline,
    speakReplyOrSkip,
    autoRestartRecording,
    endSession,
  ]);

  const onCorto = useCallback(async () => {
    const sess = sessionRef.current;
    if (!sess) return;
    const ph = phaseRef.current;

    if (ph === 'RECORDING') {
      // El usuario espera mientras la IA genera el latido final del perfil.
      // El pipeline corre en closingMode (stage 3 con la capa de cierre) y persiste
      // la respuesta en el doc, pero NO se reproduce voz: salida directa al folder.
      if (!isRecording) {
        playPositiveCue();
        endSession();
        return;
      }
      if (!googleApiKey) {
        playNegativeCue();
        endSession();
        return;
      }
      const stopped = await stopRecording();
      if (!stopped.ok) {
        playNegativeCue();
        endSession();
        return;
      }
      await runTurnPipeline(stopped.uri, sess.profile, true);
      playPositiveCue();
      endSession();
      return;
    }

    if (ph === 'PROCESSING') {
      // El turno en curso completa, su respuesta se persiste, su voz se silencia, salimos.
      // Si el recap estaba sonando, callarlo ya: te vas, no tiene sentido seguir
      // recapitulando. Corto conserva SIEMPRE su significado, también aquí.
      stopRecapFlow();
      cortoQueuedRef.current = true;
      playPositiveCue();
      return;
    }

    if (ph === 'PLAYING') {
      // La voz que estás oyendo ES la última. Cortar y salir, sin latido adicional.
      ttsManuallyStoppedRef.current = true;
      await stopActiveTtsPlayback();
      playPositiveCue();
      endSession();
      return;
    }
  }, [
    googleApiKey,
    isRecording,
    stopRecording,
    runTurnPipeline,
    endSession,
  ]);

  // Cable jack / botón media: pulsación simple = Cambio; doble = Corto.
  // Zero-UI completo: la sesión se cierra sin sacar el móvil del bolsillo.
  useWiredMediaCambio({
    enabled: session !== null,
    onMediaCambio: () => {
      void onCambio();
    },
    onMediaCorto: () => {
      void onCorto();
    },
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (target === null) return null;

  const dockBottomPad = DOCK_VERTICAL_PADDING + insets.bottom;

  // Sesión activa: vista de campo (blackout, pulso, Cambio + Corto).
  if (session) {
    const profileName = resolveConversadorDisplayName(session.profile, conversadorProfiles);
    const isProcessing = phase === 'PROCESSING';
    return (
      <View style={[styles.wrap, styles.wrapBlackout]} pointerEvents="box-none">
        <View style={styles.recordingFill} pointerEvents="box-none">
          <View style={styles.recordingCenter} pointerEvents="box-none">
            <Pressable
              onPress={() => void onCambio()}
              style={({ pressed }) => [styles.recordingTap, pressed && styles.recordingTapPressed]}
              accessibilityRole="button"
              accessibilityLabel="Cambio"
            >
              <Animated.View style={[styles.bigMicRing, { opacity: pulseAnim }]}>
                <View style={styles.bigMicInner}>
                  {phase === 'PROCESSING' ? (
                    <MaterialCommunityIcons name="brain" size={56} color={FAB_ICON} />
                  ) : (
                    <Ionicons
                      name={phase === 'PLAYING' ? 'headset' : 'mic'}
                      size={56}
                      color={FAB_ICON}
                    />
                  )}
                </View>
              </Animated.View>
              <Text style={styles.recordingProfile}>{profileName}</Text>
              {isProcessing ? (
                <Animated.Text style={[styles.processingDots, { opacity: processingDotsAnim }]}>
                  • • •
                </Animated.Text>
              ) : null}
            </Pressable>
            <View style={styles.actionsRow}>
              <Pressable
                onLongPress={() => void onCorto()}
                delayLongPress={450}
                style={({ pressed }) => [styles.cortoBtn, pressed && styles.cortoBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Corto: mantener pulsado para cerrar la conversación"
              >
                <Text style={styles.cortoBtnText}>CORTO</Text>
              </Pressable>
              <Pressable
                onPress={() => void onCambio()}
                style={({ pressed }) => [styles.cambioBtn, pressed && styles.cambioBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Cambio: fin de tu turno"
              >
                <Text style={styles.cambioBtnText}>CAMBIO</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // Sin sesión: dock de perfiles esperando primera pulsación.
  const profileDock = (dockStyle?: StyleProp<ViewStyle>) => (
    <View style={[styles.dockRow, dockStyle]} pointerEvents="box-none">
      {AI_PROFILE_ORDER.map((profile) => {
        const visual = resolveConversadorDockVisual(profile, conversadorProfiles);
        const label = resolveConversadorDisplayName(profile, conversadorProfiles);
        return (
          <Pressable
            key={profile}
            onPress={() => void startSession(profile)}
            accessibilityRole="button"
            accessibilityLabel={`Iniciar conversación con perfil ${label}`}
            style={styles.fabHit}
          >
            <View style={[styles.fab, visual.kind === 'image' && styles.fabImageClip]}>
              {visual.kind === 'image' ? (
                // El PNG es el FAB entero (disco ámbar + glifo). Sin alfa: el clip
                // circular recorta las esquinas y el scale 1.03 esconde el fleco
                // blanco del antialiasing bajo el borde.
                <Image
                  source={visual.source}
                  style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.03 }] }]}
                  contentFit="cover"
                />
              ) : (
                <Ionicons
                  name={visual.name as keyof typeof Ionicons.glyphMap}
                  size={ICON_SIZE}
                  color={FAB_ICON}
                />
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  // Mostrar `busyPhase` aquí no rompe la regla "no signaling de fases", porque
  // SIN sesión activa nunca hay busyPhase. Es solo placeholder por si se añade
  // futuro estado entre sesiones.
  void busyPhase;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.column, { paddingBottom: dockBottomPad }]} pointerEvents="box-none">
        {profileDock()}
      </View>
    </View>
  );
}

/** Reserva vertical bajo listas para que no queden tapadas por el dock. */
export function useGlobalVoiceChromeBottomInset(): number {
  const target = useVoiceRouteStore((s) => s.target);
  const insets = useSafeAreaInsets();
  if (target === null) return 0;
  return DOCK_FAB_SIZE + DOCK_VERTICAL_PADDING + insets.bottom + 12;
}

const BIG_MIC_SIZE = 132;

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 200,
    elevation: 200,
  },
  wrapBlackout: {
    backgroundColor: '#000000',
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  recordingFill: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  recordingCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  recordingTap: {
    alignItems: 'center',
    maxWidth: 320,
  },
  recordingTapPressed: {
    opacity: 0.92,
  },
  bigMicRing: {
    marginBottom: 22,
  },
  bigMicInner: {
    width: BIG_MIC_SIZE,
    height: BIG_MIC_SIZE,
    borderRadius: BIG_MIC_SIZE / 2,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: AMBER_RING,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  recordingProfile: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: 'center',
    letterSpacing: 0.4,
  },
  processingDots: {
    marginTop: 18,
    fontSize: 28,
    color: ACCENT,
    textAlign: 'center',
    letterSpacing: 6,
  },
  actionsRow: {
    marginTop: 44,
    flexDirection: 'row',
    gap: 18,
  },
  cortoBtn: {
    minWidth: 128,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#3a3a3a',
    backgroundColor: '#121212',
  },
  cortoBtnPressed: {
    opacity: 0.85,
    borderColor: '#555',
  },
  cortoBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: PAUSE_LABEL,
    letterSpacing: 2,
  },
  cambioBtn: {
    minWidth: 128,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 26,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: AMBER_RING,
    backgroundColor: ACCENT,
  },
  cambioBtnPressed: {
    opacity: 0.85,
  },
  cambioBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: FAB_ICON,
    letterSpacing: 2,
  },
  column: {
    paddingHorizontal: 14,
    gap: 10,
    pointerEvents: 'box-none',
  },
  dockRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingTop: 4,
  },
  fabHit: {
    padding: 4,
  },
  fab: {
    width: DOCK_FAB_SIZE,
    height: DOCK_FAB_SIZE,
    borderRadius: DOCK_FAB_SIZE / 2,
    backgroundColor: ACCENT,
    borderWidth: 1.5,
    borderColor: FAB_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
  },
  fabImageClip: {
    overflow: 'hidden',
  },
});
