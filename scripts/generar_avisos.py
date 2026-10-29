"""Genera los cuatro avisos sonoros de la app (assets/sounds/cue_*.wav).

Tonos sintetizados desde cero, sin muestras de terceros: el resultado es
reproducible y no depende de ninguna licencia. Estilo «radio»: senos con un
poco de segundo y tercer armónico, ataque corto y caída exponencial.

    python scripts/generar_avisos.py

Formato: WAV PCM 16 bits, mono, 24 kHz (el mismo que la voz de Gemini TTS).
"""
import math
import pathlib
import struct
import wave

FS = 24_000
PICO = 0.5  # unos -6 dBFS: se oyen con tráfico sin taladrar con auriculares
SALIDA = pathlib.Path(__file__).resolve().parent.parent / "assets" / "sounds"


def tono(freq, dur, ataque=0.004, caida=None):
    """Una nota: seno con armónicos suaves, ataque lineal y caída exponencial."""
    n = int(FS * dur)
    caida = caida or dur / 4
    out = []
    for i in range(n):
        t = i / FS
        env = min(1.0, t / ataque) * math.exp(-t / caida)
        fin = min(1.0, (n - i) / (FS * 0.003))  # sin clic al cortar
        s = (math.sin(2 * math.pi * freq * t)
             + 0.25 * math.sin(4 * math.pi * freq * t)
             + 0.08 * math.sin(6 * math.pi * freq * t))
        out.append(s * env * fin / 1.33)
    return out


def silencio(dur):
    return [0.0] * int(FS * dur)


def escribir(nombre, muestras):
    pico = max(abs(m) for m in muestras) or 1.0
    datos = b"".join(struct.pack("<h", int(m / pico * PICO * 32767)) for m in muestras)
    with wave.open(str(SALIDA / f"cue_{nombre}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(FS)
        w.writeframes(datos)


AVISOS = {
    # Micro abierto: dos notas que suben, «te toca».
    "recording": tono(880, 0.09) + silencio(0.03) + tono(1320, 0.13),
    # Recibido: un toque corto y seco.
    "ack": tono(1046.5, 0.07, caida=0.02),
    # Éxito: arpegio mayor ascendente.
    "success": tono(784, 0.08) + tono(988, 0.08) + tono(1175, 0.16),
    # Error: dos notas graves que bajan, más largas.
    "error": tono(440, 0.18, caida=0.09) + silencio(0.04) + tono(311, 0.26, caida=0.12),
}

if __name__ == "__main__":
    SALIDA.mkdir(parents=True, exist_ok=True)
    for nombre, muestras in AVISOS.items():
        escribir(nombre, muestras)
        print(f"cue_{nombre}.wav  {len(muestras) / FS:.2f} s")
