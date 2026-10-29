# CrewAI Flow frente a llamadas propias: una medición pequeña

Una misma tarea, un mismo modelo local y una misma temperatura, resuelta de dos formas:

- **A · CrewAI Flow**: un Flow que lanza un Crew con dos especialistas y un orquestador, con RAG sobre la especificación y un router de reintentos. Es el patrón de `crewai_flow_template`.
- **B · Llamadas propias**: cinco pasos, y solo uno invoca al modelo. Trocear, recuperar y verificar lo hace código determinista, y el modelo hace **una** llamada por requisito con un JSON Schema cerrado.

Las dos variantes pasan por el mismo proxy de medida (`proxy.py`) y se puntúan con el mismo código (`evaluar.py`).

## La tarea

Hay que auditar 10 requisitos de cliente contra la especificación técnica de un producto inventado: el controlador de riego **RiegoNet R2**, del fabricante ficticio Hidrovalle Sistemas. La especificación tiene unas 1.600 palabras repartidas en 8 capítulos y 23 apartados numerados. Para cada requisito se pide un veredicto (`cumple`, `no_cumple` o `abierto`), una cita literal de la especificación y el apartado de donde sale.

| Tipo | Requisitos | Qué tiene de difícil |
|---|---|---|
| Directos | R01, R07, R08, R09, R10 | Nada en especial. R09 y R10 piden comparar (24 meses ≥ 12; 230 V está dentro de 100–240 V). |
| Trampa de cifra | R02, R03 | R02 pide ≥ 72 h de batería y la especificación da 48 h. R03 pide un rango de funcionamiento de −20 a +60 °C y la especificación da −10 a +60 °C; el −20 °C que aparece es de almacenamiento. |
| Trampa de negación | R04 | «El R2 **no admite** sensores de lluvia de otros fabricantes». Justo al lado, SEN2 sí admite caudalímetros de terceros. |
| Abiertos | R05, R06 | La especificación no dice nada de asistentes de voz ni de piezas de repuesto. Cerca hay datos que distraen: garantía de 3 años y firmware durante 5 años. |

La verdad está en `datos/verdad.json`: veredicto, frase decisiva, apartado y motivo de cada requisito.

## Cómo reproducirlo

Hace falta Ollama en `localhost:11434` con `qwen2.5:7b` y `mxbai-embed-large` instalados.

```bash
python -m venv venv && venv/Scripts/activate        # Windows; en Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
python proxy.py --listen 11435 --upstream http://localhost:11434 --log resultados/proxy.jsonl   # en otra terminal
python correr.py --runs 3          # alterna A1, B1, A2, B2, A3, B3 → resultados/runs.jsonl
python evaluar.py                  # → resultados/resumen.json y resultados/RESULTADOS.md
```

Para una prueba rápida con un solo requisito: `EXP_SOLO=R03 python variante_b/auditar.py --salida /tmp/b.json`.

`correr.py` lanza cada ejecución en un proceso nuevo y precalienta los dos modelos antes, directamente contra Ollama, para que esa carga no cuente. Para A crea un almacén de CrewAI vacío en cada ejecución y lo borra al acabar, así que los embeddings siempre se calculan en frío. No sale nada a la red: la telemetría y el tracing de CrewAI están desactivados (`CREWAI_DISABLE_TELEMETRY`, `OTEL_SDK_DISABLED`, `CREWAI_TRACING_ENABLED=false`) y no se usa ninguna clave de API.

## Diseño de cada variante

### A · CrewAI Flow (`variante_a/auditoria_crew/`)

- **Flow** (`main.py`). Un estado Pydantic, `@start("retry")` que ejecuta el Crew, `@router` que devuelve `finish` o `retry` y `@listen("finish")`. Como en la plantilla, `MAX_ITERATIONS = 3`. Solo se reintentan los requisitos que el orquestador no aprueba, y en el reintento reciben su feedback.
- **Crew** (`crew.py`, `config/*.yaml`). Proceso secuencial con tres tareas:
  1. El *analista de requisitos* descompone el requisito.
  2. El *lector de la especificación* busca frases literales y su apartado. Es el que tiene el `knowledge_source`.
  3. El *orquestador* emite un `Dictamen` estructurado con `output_pydantic`: veredicto, cita, sección, `aprobado` y comentario.
- **LLM**. Se conecta de la forma normal: `LLM(model="ollama/qwen2.5:7b", base_url=<proxy>, temperature=0, seed=42)`. En CrewAI 1.15 eso pasa por el endpoint compatible con OpenAI de Ollama (`/v1/chat/completions`).
- **RAG**. `TextFileKnowledgeSource` sobre `datos/spec.md` con embedder Ollama `mxbai-embed-large`. Se ajustaron dos cosas para no presentar una versión de paja:
  - `chunk_size` bajó de 4000 a 800 caracteres, porque el valor por defecto supera los 512 tokens del modelo de embeddings.
  - `results_limit` es 4, el mismo `TOP_K` que B.
- **Respecto a la plantilla** hay dos cambios, ambos a favor de A:
  - El Crew se lanza una vez por requisito, no una para todo, para que la consulta del RAG no mezcle los 10 requisitos.
  - La aprobación es un booleano del dictamen estructurado, no el token `APPROVED` en texto libre.
- **Mismas reglas que B**. Las definiciones de cumple, no_cumple y abierto son las mismas, palabra por palabra, que en el prompt de B.

### B · Llamadas propias (`variante_b/auditar.py`)

1. **Trocear** (código). Un fragmento por apartado `### N.M`, siguiendo el contrato de chunk del toolkit.
2. **Recuperar** (código). BM25 top-4 por requisito con `kit.contexto.retrieve`, sobre el texto sin acentos.
3. **Decidir** (modelo). Una llamada a `/api/chat` con `format` igual a un JSON Schema con estos campos:
   - `veredicto`, cerrado a {cumple, no_cumple, abierto};
   - `chunk_id`, cerrado a los 4 ids recuperados **para ese requisito** más «ninguno»;
   - `cita`;
   - `comparacion`, una frase que se pide antes del veredicto.
4. **Verificar** (código). `kit.guardarrail_out.quote_verify` comprueba que la cita existe en el fragmento citado. La cita que se entrega es el texto del documento, no el del modelo.
5. **Sellar** (código). Si un veredicto que no es «abierto» se queda sin cita verificada, se degrada a «abierto». El apartado sale del fragmento, nunca del modelo.

Los módulos del toolkit están copiados sin cambios en `vendor/kit/`; el origen está en `vendor/LEEME.md`.

### Medición (`proxy.py`, `evaluar.py`)

- **Proxy**. Escucha en `:11435` y reenvía todo a `:11434`, también el streaming. Escribe una línea JSONL por petición con el endpoint, el modelo, `prompt_eval_count` y `eval_count` (o `usage` en el dialecto `/v1`) y la duración.
- **Fragmento de cada ejecución**. `correr.py` anota cuántas líneas tiene el log antes y después de cada ejecución y se queda con las de en medio.
- **Citas**. El mismo comprobador para A y para B: `find_literal_span` del toolkit, literal tras normalizar la tipografía y sin umbral. Para B también se cuenta la cita **tal como la escribió el modelo**, antes de verificarla. Si no, B saldría literal por construcción.

## Resultados

Datos completos en `resultados/RESULTADOS.md`, `resultados/resumen.json` y `resultados/runs.jsonl`; logs de CrewAI en `resultados/logs/`.

Condiciones: `qwen2.5:7b` (Q4_K_M), temperatura 0, seed 42, contexto 4096 tokens en las dos variantes. CrewAI 1.15.33 y Ollama 0.32.5. Equipo: RTX 2060 de 6 GB más una CPU AMD; Ollama carga el 82 % del modelo en la VRAM y el resto en la CPU. Hay 3 ejecuciones por variante. Ninguna varió entre ejecuciones salvo el tiempo de pared; para el tiempo se da la media y, entre paréntesis, el mínimo y el máximo.

| Métrica | A · CrewAI Flow | B · Llamadas propias |
|---|---|---|
| **Aciertos (x/10)** | **6** | **9** |
| Llamadas al modelo de chat | 96 | 10 |
| Llamadas de embeddings | 48 | 0 |
| Tokens de entrada (chat) | 80.530 | 7.071 |
| Tokens de salida (chat) | 7.907 | 1.160 |
| Tokens de embeddings | 90.279 | 0 |
| Tiempo de pared (s) | 431 (424–440) | 53 (52–54) |
| Segundos dentro del modelo de chat (proxy) | 370 (368–373) | 53 (52–54) |
| Citas devueltas | 4 | 8 |
| Citas literales en la especificación | 3 | 8 (8 de 8 ya literales antes de verificar) |
| Apartado correcto (x/8) | 4 | 8 |
| Caídas, errores HTTP | 0 | 0 |
| Requisitos reejecutados por el router | 14 por ejecución | — |
| Prompt más largo (tokens) | 1.510 | 748 |

Por requisito, igual en las 3 ejecuciones:

| Req. | Tipo | Verdad | A | B |
|---|---|---|---|---|
| R01 | directo | cumple | cumple ✔ | cumple ✔ |
| R02 | trampa cifra | no_cumple | abierto ✘ | no_cumple ✔ |
| R03 | trampa cifra | no_cumple | no_cumple ✔ | no_cumple ✔ |
| R04 | trampa negación | no_cumple | abierto ✘ | no_cumple ✔ |
| R05 | abierto | abierto | abierto ✔ | abierto ✔ |
| R06 | abierto | abierto | abierto ✔ | abierto ✔ |
| R07 | directo | cumple | cumple ✔ | cumple ✔ |
| R08 | directo | cumple | cumple ✔ | cumple ✔ |
| R09 | directo | cumple | abierto ✘ | cumple ✔ |
| R10 | directo | cumple | abierto ✘ | **no_cumple ✘** |

### Dónde falló cada una

- **B falló en R10, y con aplomo.** El modelo escribió que la especificación indica «100–240 V CA, 50/60 Hz» y aun así dictaminó `no_cumple` para 230 V / 50 Hz. La cita es literal y está verificada. La verificación de citas garantiza que la evidencia existe; no garantiza que el razonamiento sobre ella sea correcto. Es un error que solo detecta una persona o una regla numérica explícita.
- **A falló en R02, R04, R09 y R10, siempre hacia «abierto».** Nunca dio un `cumple` o `no_cumple` equivocado. Según el uso, eso puede valer más que un acierto: un «abierto» manda a revisar, mientras que un `no_cumple` falso se firma. Los mecanismos fueron dos:
  - **El lector repite la frase de escape.** Escribe «La especificación no trata este requisito» incluso cuando, justo después, copia la frase correcta: pasó en R09, con el apartado 8.1 citado literalmente. Esa frase de escape está en la tarea y B tiene una regla equivalente, pero B la aplica mejor porque ve los fragmentos directamente.
  - **El bucle de reintentos no ayuda.** El orquestador puso `aprobado=True` en 9 de 9 dictámenes `cumple` y en **0 de 63** `abierto` o `no_cumple`. El modelo confunde «apruebo la evidencia» con «el requisito se aprueba». Por eso todos los requisitos que no cumplen o quedan abiertos se reintentan hasta el máximo. La primera iteración ya sacaba 6/10, y tres iteraciones después seguía en 6/10. En un primer lote, descartado por el problema de medida que se explica más abajo, el resultado final osciló entre 5 y 7 con la misma primera iteración de 6/10: el bucle añade variación, no aciertos.
  - **El RAG, probablemente, en R02.** Con una comprobación aproximada hecha fuera de las ejecuciones con `comprobar_rag_a.py` (los mismos trozos de 800 caracteres, `mxbai-embed-large` y el texto literal del requisito como consulta), el apartado decisivo entra en el top-4 en 7 de los 8 requisitos con respuesta; el que falta es R02. CrewAI, además, reescribe la consulta con el LLM, así que esto es solo una aproximación.
- **Citas de A.** Solo 4 dictámenes traen cita. Una de ellas, la de R03, junta dos frases en forma de lista: las dos existen, pero el conjunto no es literal y el comprobador estricto la rechaza. El apartado que escribe el modelo acierta 4 de 8 veces, porque en los «abierto» erróneos no hay apartado.

### Lo que hizo bien CrewAI

- **No tuvo ningún falso `cumple` ni falso `no_cumple`.** B tuvo uno.
- **Acertó la trampa de cifra más sutil.** En R03, el −20 °C de almacenamiento frente al −10 °C de funcionamiento, acertó las 3 veces.
- **No se cayó nunca.** La salida estructurada llegó bien en los 72 de 72 kickoffs del Crew (24 por ejecución).
- **No hubo truncados.** Ningún prompt se acercó al límite de contexto: el más largo tuvo 1.510 tokens de 4.096.

## Qué hace la comparación injusta o frágil, y qué se corrigió

- **Primer lote descartado.** El proxy escuchaba solo en `127.0.0.1` y las dos variantes llamaban a `localhost`. En Windows, `localhost` resuelve primero a `::1`, así que cada conexión nueva esperaba unos 2 s antes de reintentar por IPv4. Inflaba el tiempo de pared de las dos variantes: A 579 s y B 80 s, frente a 431 s y 53 s ahora. Se corrigió haciendo que el proxy escuche en IPv4 e IPv6 y se repitieron las 6 ejecuciones. Los aciertos de A en ese lote fueron 7, 5 y 6, y los de B, 9, 9 y 9. Está todo en `resultados/descartadas_lote1/`.
- **Contexto de 4096 tokens en las dos variantes.** Por `/v1`, CrewAI no puede fijar `num_ctx`, así que se queda con el valor por defecto del servidor. B tampoco lo toca, para que las dos variantes trabajen en las mismas condiciones.
- **Endpoints distintos del mismo servidor.** A usa `/v1/chat/completions`, que es lo que hace CrewAI. B usa `/api/chat` con `format`, que restringe la decodificación al schema. En A, la salida estructurada del orquestador también va con `response_format`. Es parte de lo que se compara, pero conviene saberlo.
- **La recuperación es distinta a propósito.** A usa embeddings, que es lo idiomático en CrewAI; B usa BM25 sobre apartados. Una especificación sintética con títulos limpios y vocabulario compartido con los requisitos **favorece a BM25**: B recupera el apartado decisivo en primera posición en 8 de 8. Con un documento real y desordenado, la diferencia en recuperación podría ser menor o invertirse.
- **A vuelve a calcular los embeddings de la especificación en cada kickoff.** El patrón de la plantilla ata el `knowledge_source` al agente que se construye en `crew()`, así que cada uno de los 24 kickoffs incrusta la especificación otra vez: unos 90.000 tokens de embeddings por ejecución. Es evitable. Aun así, pesa poco en el tiempo: 12 s de 431.
- **El campo «aprobado» de A se podría redactar mejor.** Un nombre como `evidencia_suficiente` probablemente evitaría la confusión y recortaría la mayoría de los 14 reintentos, que pasarían de unas 96 llamadas a unas 40. **No se probó.** La primera iteración, sin bucle, ya da 6/10, así que no cabe esperar más aciertos solo por eso.
- **B pide una frase de `comparacion` antes del veredicto.** A tiene el equivalente en el analista y en el razonamiento libre de cada agente.

## Límites

- **Una sola tarea sintética**, escrita por la misma persona que diseñó B, con 10 requisitos y una especificación de unas 1.600 palabras. No es una muestra: es una prueba de concepto medida.
- **Un solo modelo de 7B** cuantizado (Q4_K_M) y parcialmente en CPU. Con un modelo mayor, las dos variantes mejorarían y la distancia en aciertos podría cerrarse. La distancia en llamadas y tokens es estructural y no depende del modelo.
- **Tres ejecuciones por variante** con temperatura 0 y seed fijo, y las tres salieron idénticas. Eso habla del determinismo, no de la varianza ante otros datos.
- **CrewAI 1.15.33** con la configuración descrita. CrewAI se puede afinar más: proceso jerárquico, un solo agente en vez de tres, conocimiento a nivel de Crew y persistido, herramientas de búsqueda propias, `guardrail` en la tarea para verificar la cita (que acercaría A a B), o quitar el bucle. No se probó ninguna de esas variantes.
- **Qué no se midió:**
  - memoria RAM y VRAM, y energía;
  - tiempo de desarrollo y mantenimiento, y legibilidad;
  - líneas de código: unas 300 en A entre YAML y Python, frente a unas 120 en B más 330 del toolkit copiado;
  - coste en la nube;
  - robustez ante documentos largos o PDFs reales;
  - la calidad de las explicaciones;
  - la latencia por requisito.

## Archivos

```
datos/spec.md, requisitos.json, verdad.json    tarea sintética y verdad
comun.py                                       configuración compartida (modelo, temperatura, proxy, top-k, troceado)
proxy.py                                       proxy de medida delante de Ollama
variante_a/auditoria_crew/                     A: Flow + Crew (main.py, crew.py, config/agents.yaml, config/tasks.yaml)
variante_b/auditar.py                          B: cinco pasos, una llamada por requisito
vendor/kit/                                    copia literal de tres módulos del toolkit (Apache-2.0)
correr.py                                      ejecuta y registra; evaluar.py puntúa y resume
comprobar_rag_a.py                             recall aproximado del RAG de A (fuera de la medición)
resultados/                                    runs.jsonl, resumen.json, RESULTADOS.md, salidas/, logs/, proxy.jsonl
resultados/descartadas_lote1/                  primer lote, descartado por el retardo IPv6 del proxy
requirements.txt                               versiones exactas (pip freeze)
```
