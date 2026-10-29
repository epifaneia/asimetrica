# Resultados: CrewAI Flow (A) frente a llamadas propias (B)

Modelo: `qwen2.5:7b` · temperatura 0 · seed 42 · contexto 4096 tokens (el del servidor) · embeddings (solo A): `mxbai-embed-large` · CrewAI 1.15.33 · Ollama 0.32.5 · GPU NVIDIA GeForce RTX 2060, 6144 MiB; Ollama carga 82% de qwen2.5:7b en VRAM (resto en CPU); AMD64 Family 23 Model 113 Stepping 0, AuthenticAMD

Ejecuciones: A = 3, B = 3. Media y, entre paréntesis, mínimo–máximo cuando varían.

| Métrica | A · CrewAI Flow | B · Llamadas propias |
|---|---|---|
| Aciertos (x/10) | 6 (5–7) | 9 |
| Llamadas al modelo (chat) | 96 | 10 |
| Llamadas de embeddings | 48 | 0 |
| Tokens de entrada | 80442 (80116–80680) | 7071 |
| Tokens de salida | 7860.67 (7619–8056) | 1160 |
| Tokens de embeddings | 90243 (90223–90279) | 0 |
| Tiempo de pared (s) | 579.18 (562.35–590.63) | 80.2 (77.77–84.24) |
| Citas devueltas | 3.67 (3–4) | 8 |
| Citas literales en la spec | 3.33 (3–4) | 8 |
| Citas literales y decisivas | 3.33 (3–4) | 8 |
| Apartado correcto (x/8) | 3.67 (3–4) | 8 |
| Errores/caídas | 0 | 0 |
| Reintentos (requisito re-ejecutado) | 14 | 0 |
| Prompt más largo (tokens) | 1506 (1498–1510) | 748 |
| B: citas literales tal como las escribió el modelo, antes de verificar | — | 8 de 8 |
| B: veredictos degradados a «abierto» por cita no verificada | — | 0 |

## Veredicto por requisito

Una columna por ejecución. ✔ = coincide con la verdad.

| Req. | Tipo | Verdad | A (runs) | B (runs) |
|---|---|---|---|---|
| R01 | directo | cumple | cumple ✔ · cumple ✔ · cumple ✔ | cumple ✔ · cumple ✔ · cumple ✔ |
| R02 | trampa_cifra | no_cumple | abierto ✘ · abierto ✘ · abierto ✘ | no_cumple ✔ · no_cumple ✔ · no_cumple ✔ |
| R03 | trampa_cifra | no_cumple | no_cumple ✔ · abierto ✘ · no_cumple ✔ | no_cumple ✔ · no_cumple ✔ · no_cumple ✔ |
| R04 | trampa_negacion | no_cumple | no_cumple ✔ · abierto ✘ · abierto ✘ | no_cumple ✔ · no_cumple ✔ · no_cumple ✔ |
| R05 | abierto | abierto | abierto ✔ · abierto ✔ · abierto ✔ | abierto ✔ · abierto ✔ · abierto ✔ |
| R06 | abierto | abierto | abierto ✔ · abierto ✔ · abierto ✔ | abierto ✔ · abierto ✔ · abierto ✔ |
| R07 | directo | cumple | cumple ✔ · cumple ✔ · cumple ✔ | cumple ✔ · cumple ✔ · cumple ✔ |
| R08 | directo | cumple | cumple ✔ · cumple ✔ · cumple ✔ | cumple ✔ · cumple ✔ · cumple ✔ |
| R09 | directo | cumple | abierto ✘ · abierto ✘ · abierto ✘ | cumple ✔ · cumple ✔ · cumple ✔ |
| R10 | directo | cumple | abierto ✘ · abierto ✘ · abierto ✘ | no_cumple ✘ · no_cumple ✘ · no_cumple ✘ |
