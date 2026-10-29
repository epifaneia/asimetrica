# Resultados: CrewAI Flow (A) frente a llamadas propias (B)

Modelo: `qwen2.5:7b` · temperatura 0 · seed 42 · contexto 4096 tokens (el del servidor) · embeddings (solo A): `mxbai-embed-large` · CrewAI 1.15.33 · Ollama 0.32.5 · GPU NVIDIA GeForce RTX 2060, 6144 MiB; Ollama carga 82% de qwen2.5:7b en VRAM (resto en CPU); AMD64 Family 23 Model 113 Stepping 0, AuthenticAMD

Ejecuciones: A = 3, B = 3. Media y, entre paréntesis, mínimo–máximo cuando varían.

| Métrica | A · CrewAI Flow | B · Llamadas propias |
|---|---|---|
| Aciertos (x/10) | 6 | 9 |
| Llamadas al modelo (chat) | 96 | 10 |
| Llamadas de embeddings | 48 | 0 |
| Tokens de entrada | 80530 | 7071 |
| Tokens de salida | 7907 | 1160 |
| Tokens de embeddings | 90279 | 0 |
| Tiempo de pared (s) | 431.05 (423.91–439.58) | 52.9 (52.01–54.05) |
| Segundos dentro del modelo de chat (proxy) | 370.37 (367.6–373.4) | 52.63 (51.7–53.8) |
| Citas devueltas | 4 | 8 |
| Citas literales en la spec | 3 | 8 |
| Citas literales y decisivas | 3 | 8 |
| Apartado correcto (x/8) | 4 | 8 |
| Errores/caídas | 0 | 0 |
| Reintentos (requisito re-ejecutado) | 14 | 0 |
| Prompt más largo (tokens) | 1510 | 748 |
| B: citas literales tal como las escribió el modelo, antes de verificar | — | 8 de 8 |
| B: veredictos degradados a «abierto» por cita no verificada | — | 0 |

## Veredicto por requisito

Una columna por ejecución. ✔ = coincide con la verdad.

| Req. | Tipo | Verdad | A (runs) | B (runs) |
|---|---|---|---|---|
| R01 | directo | cumple | cumple ✔ · cumple ✔ · cumple ✔ | cumple ✔ · cumple ✔ · cumple ✔ |
| R02 | trampa_cifra | no_cumple | abierto ✘ · abierto ✘ · abierto ✘ | no_cumple ✔ · no_cumple ✔ · no_cumple ✔ |
| R03 | trampa_cifra | no_cumple | no_cumple ✔ · no_cumple ✔ · no_cumple ✔ | no_cumple ✔ · no_cumple ✔ · no_cumple ✔ |
| R04 | trampa_negacion | no_cumple | abierto ✘ · abierto ✘ · abierto ✘ | no_cumple ✔ · no_cumple ✔ · no_cumple ✔ |
| R05 | abierto | abierto | abierto ✔ · abierto ✔ · abierto ✔ | abierto ✔ · abierto ✔ · abierto ✔ |
| R06 | abierto | abierto | abierto ✔ · abierto ✔ · abierto ✔ | abierto ✔ · abierto ✔ · abierto ✔ |
| R07 | directo | cumple | cumple ✔ · cumple ✔ · cumple ✔ | cumple ✔ · cumple ✔ · cumple ✔ |
| R08 | directo | cumple | cumple ✔ · cumple ✔ · cumple ✔ | cumple ✔ · cumple ✔ · cumple ✔ |
| R09 | directo | cumple | abierto ✘ · abierto ✘ · abierto ✘ | cumple ✔ · cumple ✔ · cumple ✔ |
| R10 | directo | cumple | abierto ✘ · abierto ✘ · abierto ✘ | no_cumple ✘ · no_cumple ✘ · no_cumple ✘ |

## A: primera iteración (sin el bucle de reintentos) y uso de «aprobado»

Dictamen del orquestador en la primera pasada de cada requisito, leído del log de CrewAI.

| Run | Aciertos 1.ª iteración | Aciertos finales | Veredictos 1.ª iteración (veredicto/aprobado) |
|---|---|---|---|
| 1 | 6/10 | 6/10 | R01:cumple/T R02:abierto/F R03:no_cumple/F R04:abierto/F R05:abierto/F R06:abierto/F R07:cumple/T R08:cumple/T R09:no_cumple/F R10:abierto/F |
| 2 | 6/10 | 6/10 | R01:cumple/T R02:abierto/F R03:no_cumple/F R04:abierto/F R05:abierto/F R06:abierto/F R07:cumple/T R08:cumple/T R09:no_cumple/F R10:abierto/F |
| 3 | 6/10 | 6/10 | R01:cumple/T R02:abierto/F R03:no_cumple/F R04:abierto/F R05:abierto/F R06:abierto/F R07:cumple/T R08:cumple/T R09:no_cumple/F R10:abierto/F |

Veces que el orquestador puso `aprobado=True`, por veredicto (todas las iteraciones, todos los runs): cumple: 9/9, abierto: 0/51, no_cumple: 0/12
