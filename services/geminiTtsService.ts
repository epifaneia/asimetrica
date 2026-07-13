import * as FileSystem from 'expo-file-system/legacy';

import { useDiagnosticStore } from '@/stores/diagnostic-store';

import { GEMINI_MODELS } from './geminiModels';

/**
 * TTS vía Gemini API (`gemini-3.1-flash-tts-preview` por defecto).
 *
 * El modelo devuelve **PCM crudo** (S16LE 24kHz mono) en base64. El reproductor
 * (expo-audio) no acepta PCM crudo, así que envolvemos con cabecera WAV (44 bytes)
 * y guardamos a un archivo temporal en `cacheDirectory` que consume directo.
 *
 * Coste BYOK estimado: ~$0.02 por respuesta media. Latencia: 1-3s en buena red.
 */

const TTS_ENDPOINT = (modelId: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;

const TTS_SAMPLE_RATE = 24000;
const TTS_CHANNELS = 1;
const TTS_BITS_PER_SAMPLE = 16;

export type TtsResult =
  | { ok: true; audioUri: string }
  | { ok: false; error: string };

type TtsResponse = {
  error?: { message?: string; status?: string };
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
  }>;
};

export async function synthesizeWithGemini(params: {
  apiKey: string;
  text: string;
  voiceName: string;
  modelId?: string;
}): Promise<TtsResult> {
  const { apiKey, text, voiceName, modelId = GEMINI_MODELS.tts } = params;

  const startMs = Date.now();
  const log = (ok: boolean, error?: string) => {
    useDiagnosticStore.getState().push({
      stage: 'tts-gemini',
      model: modelId,
      latencyMs: Date.now() - startMs,
      ok,
      error,
    });
  };

  if (!apiKey.trim()) {
    log(false, 'Falta Google API Key.');
    return { ok: false, error: 'Falta Google API Key.' };
  }
  if (!text.trim()) {
    log(false, 'Texto vacío.');
    return { ok: false, error: 'Texto vacío.' };
  }
  if (!voiceName.trim()) {
    log(false, 'Falta voz Gemini.');
    return { ok: false, error: 'Falta voz Gemini.' };
  }

  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  let pcmBase64 = '';
  try {
    const res = await fetch(TTS_ENDPOINT(modelId, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as TtsResponse;
    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      log(false, msg);
      return { ok: false, error: msg };
    }
    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline?.data) {
      log(false, 'Respuesta sin audio.');
      return { ok: false, error: 'Respuesta sin audio.' };
    }
    pcmBase64 = inline.data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(false, msg);
    return { ok: false, error: msg };
  }

  // PCM crudo → WAV: prepend 44-byte header. Encoding base64 → bytes → header + bytes → base64.
  let wavBase64: string;
  try {
    const pcmBytes = base64ToBytes(pcmBase64);
    const header = buildWavHeader(pcmBytes.length, TTS_SAMPLE_RATE, TTS_CHANNELS, TTS_BITS_PER_SAMPLE);
    const wavBytes = new Uint8Array(header.length + pcmBytes.length);
    wavBytes.set(header, 0);
    wavBytes.set(pcmBytes, header.length);
    wavBase64 = bytesToBase64(wavBytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(false, `WAV wrap: ${msg}`);
    return { ok: false, error: `WAV wrap: ${msg}` };
  }

  const fileName = `asimetrica-tts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`;
  const fileUri = `${FileSystem.cacheDirectory ?? ''}${fileName}`;
  try {
    await FileSystem.writeAsStringAsync(fileUri, wavBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(false, `Write WAV: ${msg}`);
    return { ok: false, error: `Write WAV: ${msg}` };
  }

  log(true);
  return { ok: true, audioUri: fileUri };
}

// ----------------------------------------------------------------------------
// WAV helpers
// ----------------------------------------------------------------------------

function buildWavHeader(
  pcmByteLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  writeAscii(header, 0, 'RIFF');
  view.setUint32(4, 36 + pcmByteLength, true); // ChunkSize
  writeAscii(header, 8, 'WAVE');
  writeAscii(header, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (PCM)
  view.setUint16(20, 1, true); // AudioFormat (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bitsPerSample) / 8, true); // ByteRate
  view.setUint16(32, (channels * bitsPerSample) / 8, true); // BlockAlign
  view.setUint16(34, bitsPerSample, true);
  writeAscii(header, 36, 'data');
  view.setUint32(40, pcmByteLength, true);
  return header;
}

function writeAscii(arr: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) arr[offset + i] = text.charCodeAt(i);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Construye string con charCodes y luego btoa. Para audio típico (~50-200 KB)
  // es eficiente; si superara 1MB convendría chunking.
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return globalThis.btoa(bin);
}
