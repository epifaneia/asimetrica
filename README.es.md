# Asimétrica

*[Read in English](README.md)*

> La voz se está optimizando para la velocidad. Y la velocidad está reñida con el trabajo intelectual riguroso, que es donde está el valor. Si el silencio no te asusta, crea sin mirar una sola pantalla.

Asimétrica es una app Android para pensar en voz alta mientras paseas. Hablas por unos auriculares de cable; un modelo fuerte analiza lo que has dicho, se toma su tiempo y te contesta al oído. Todo queda ordenado en carpetas y listo para compartir. **El móvil no sale del bolsillo.**

La asimetría es el diseño: tú hablas tres minutos, la app piensa uno y te devuelve una postura pensada, no una respuesta rápida. El resto de la app existe para que ese minuto se soporte y para que no se pierda nada de lo dicho en la calle.

Expo / React Native, TypeScript, API de Gemini. Cada usuario pone su propia clave.

<p>
<img src="docs/capturas/inicio.png" width="23%" alt="Inicio: carpetas y el dock de los cuatro perfiles">
<img src="docs/capturas/sesion.png" width="23%" alt="Sesión: pantalla negra, un círculo que late, Corto y Cambio">
<img src="docs/capturas/ajustes.png" width="23%" alt="Ajustes: clave y modos de sesión">
<img src="docs/capturas/acciones.png" width="23%" alt="Acciones de un documento: continuar en otro modo, fusión IA, compartir">
</p>

## Interfaz cero

- **El botón del auricular lleva la sesión.** Una pulsación es *Cambio*: tu turno ha terminado, envíalo. Dos seguidas son *Corto*: la sesión termina con una nota final breve del perfil, que no es un resumen.
- **El sonido es el único canal de estado.** Cuatro avisos estilo radio (micro abierto, recibido, éxito, error) y vibración. La pantalla de sesión es negra, con un círculo que late; las fases se ven iguales a propósito.
- **Espera activa.** Mientras el analista piensa, un modelo rápido te lee lo que ha entendido: las anclas literales de la transcripción (nombres, cifras, términos) y tus ideas en frases cortas. Confirma que la transcripción salió bien y te reubica después de tres minutos hablando. Las anclas se extraen tal cual, nunca se parafrasean, para que un nombre mal oído no pueda sonar bien.
- **Una cama sonora continua.** La música no se para en toda la sesión; solo sube y baja de volumen con rampas (en silencio mientras hablas, baja bajo la voz, más alta mientras esperas). Los huecos de la síntesis pasan a ser pausas musicales en vez de parecer que la app se ha colgado.

## Cuatro perfiles: registro, no tarea

Cada perfil fija un estado de ánimo y un apetito de riesgo, no una tarea. Cualquier modelo hace cualquier tarea si se la pides; lo que merece la pena separar es la postura.

| Perfil | Postura |
|---|---|
| **Siembra** | De muy buen humor, en el momento de abrir. No juzga; prefiere decir algo que quizá esté mal antes que callarse. Nunca te alaba |
| **Poda** | Taciturno, en el momento de cerrar. Va despacio y dice sin rodeos lo que no se sostiene. Duro con la idea, correcto con la persona. Taciturno y no enfadado, porque el enfado vuelve descuidado al crítico |
| **Custom** | Vacío a propósito: escribes el tuyo en Ajustes |
| **Investigación** | Sin registro; es una capacidad. Contesta con la búsqueda de Google y puede escalar al agente Deep Research de Gemini, que tarda minutos y cuesta unos 1–3 $, así que la escalada se lee en voz alta antes de gastar nada |

Los nombres, los iconos y los prompts se pueden editar.

## Biblioteca de obra: pensar contra tu propio canon

Subes tu novela, tu esqueleto o tus normas de estilo y los asignas a carpetas. En esas carpetas pasan a ser canon vinculante para el analista.

- **Los documentos pequeños entran enteros.** Una hoja de estilo no puede depender de que la recuperación la traiga.
- **Los grandes se indexan con embeddings** y en cada turno se recuperan los pasajes más cercanos. La consulta incluye tu turno anterior, porque «y eso cómo encaja con lo de antes» no tiene nada que buscar por sí solo.
- **Un umbral relativo, no absoluto.** Probado con embeddings reales, un corte absoluto de similitud de 0,5 lo dejaba pasar todo (6 de 6 pasajes ante una pregunta que no tenía nada que ver), así que un turno sobre el fontanero habría metido páginas al azar de la novela como «canon relevante». Ahora el corte es relativo a la mediana, y un turno que no tiene que ver se queda sin biblioteca.
- **Los PDF** se leen con Gemini multimodal; solo viaja el texto. La ingesta se puede reanudar: si la app muere a mitad, sigue desde la última fase terminada sin pagar dos veces los embeddings.

## Nada se pierde en la calle

- **Bandeja de pendientes.** Si el pipeline falla en mitad del paseo, el audio pasa a almacenamiento persistente y se reprocesa después contra la conversación tal como esté entonces. El `.m4a` solo se borra cuando el turno queda guardado.
- **Recuperación de sesión.** Si la app muere en mitad de una conversación, al abrirla ofrece retomarla.
- **Voz de emergencia.** Si falla la voz en la nube, la voz del propio móvil lee el turno en vez de romper el paseo.

## El pipeline, un modelo por etapa

| Etapa | Modelo por defecto | Por qué |
|---|---|---|
| Voz a texto | Flash Lite | Transcripción literal. En modo *Ágil* también limpia el texto en la misma llamada |
| Sanear (solo *Profundo*) | Flash Lite | Quitar muletillas sin cambiar el sentido ni contestar |
| Lectura de vuelta | Flash Lite | Corre en paralelo; no alimenta a nadie |
| Analizar | Pro, razonamiento alto (*Ágil*: medio) | El núcleo. Su salida es interna y nunca se dice en voz alta |
| Interlocutor | Flash, en streaming | Convierte el análisis en habla: solo prosa, con la estructura metida en las palabras |
| Texto a voz | Flash TTS, por trozos | Ver abajo |

Los dos modos se diferencian solo en una cosa: cuánto piensa el analista. Mismas ideas, misma extensión.

**La voz, en trozos crecientes.** Gemini TTS sintetiza a unos 0,6–0,9× tiempo real. Enviada entera, una respuesta larga dejaba 17 s de silencio absoluto a mitad (hasta 100 s en el modo profundo). Ahora el primer trozo es corto y los siguientes crecen, se piden tres en paralelo y cada corte cae en un final de frase. Mientras suena un trozo, se genera más audio del que dura. Las cifras están en los comentarios de `services/ttsPlaybackService.ts`.

El modelo y el nivel de razonamiento de cada etapa se cambian con una variable `EXPO_PUBLIC_GEMINI_*` (`services/geminiModels.ts`).

## Por qué no CrewAI

Antes de quedarme con llamadas directas medí la alternativa. Las dos variantes usaron la misma tarea, el mismo modelo local (`qwen2.5:7b`, temperatura 0) y el mismo proxy de medida. La tarea era auditar 10 requisitos de cliente contra una especificación técnica inventada, con veredicto, cita literal y apartado para cada uno. Hubo 3 ejecuciones por variante.

| | CrewAI Flow (patrón de la plantilla) | Llamadas propias (5 pasos, 1 llamada al modelo) |
|---|---|---|
| Aciertos | **6 / 10** | **9 / 10** |
| Llamadas al modelo de chat | 96 (+48 de embeddings) | 10 |
| Tokens de entrada / salida | 80.530 / 7.907 | 7.071 / 1.160 |
| Tiempo de pared por ejecución | 431 s | 53 s |
| Citas literales en la especificación | 3 de 4 | 8 de 8 |

Las tres ejecuciones de cada variante dieron los mismos veredictos.

**Dónde falló cada una:**
- **Los cuatro fallos de CrewAI fueron «abierto», nunca un «cumple» o «no cumple» equivocado.** Para quien revisa, es el fallo más seguro. También acertó la trampa más sutil (temperatura de almacenamiento frente a la de funcionamiento). La mayoría de sus 96 llamadas salen del bucle de reintentos: el orquestador entendió `aprobado` como «el requisito se cumple», así que reintentó hasta el máximo cada requisito que no cumplía, y los reintentos no cambiaron ni una respuesta.
- **La versión de llamadas propias cometió un error con aplomo.** La especificación dice 100–240 V y contestó «no cumple» para 230 V, con una cita correcta y verificada. Comprobar la cita demuestra que la evidencia existe, no que el razonamiento sobre ella sea correcto.

**Por qué no es la última palabra:**
- La especificación es sintética, con títulos limpios, y eso favorece la búsqueda por palabras (BM25) frente a los embeddings.
- Hubo una sola tarea, un modelo de 7B y 3 ejecuciones. Un modelo mayor acortaría la distancia en aciertos; la distancia en llamadas y tokens es estructural.
- Cambiar el nombre de `aprobado` dejaría probablemente a CrewAI en unas 40 llamadas, pero no subiría su 6/10. No se probó.

El código, los datos, los logs en bruto y el informe completo, incluido lo que se hizo para no presentar un CrewAI de paja, están en [`experimentos/crewai-vs-llamadas/`](experimentos/crewai-vs-llamadas/README.md).

## Instalarla en el móvil

La app no está en Google Play; se instala con un fichero APK. Hace falta Android 7.0 o posterior y unos cinco minutos.

1. **Descarga el APK.** Desde el móvil, abre la [última versión](https://github.com/epifaneia/asimetrica/releases/latest) y toca `asimetrica-<versión>.apk`. Si el navegador avisa de que el archivo puede ser dañino, elige *Descargar de todas formas*.
2. **Abre el fichero.** Toca la notificación de la descarga, o abre *Archivos → Descargas* y toca el APK.
3. **Permite la instalación.** La primera vez, Android dice que el navegador no puede instalar aplicaciones. Toca *Ajustes*, activa *Permitir desde esta fuente*, vuelve atrás y toca *Instalar*.
4. **Si Play Protect pregunta**, toca *Más detalles → Instalar de todas formas*. Pregunta porque la app no viene de Play Store, no porque haya encontrado nada.
5. **Consigue una clave de Gemini.** Abre [Google AI Studio](https://aistudio.google.com/apikey), entra con una cuenta de Google y toca *Create API key*. Mira allí los límites de tu plan: la etapa de análisis usa un modelo Pro.
6. **Pega la clave.** Abre Asimétrica, entra en *Ajustes* y pégala en el campo de la clave de Google. Se queda en el móvil.
7. **Habla.** Permite el micrófono la primera vez y toca uno de los cuatro perfiles de la pantalla de inicio. Con unos auriculares de cable con botón tienes *Cambio* y *Corto* sin tocar el móvil.

Para actualizar, instala el APK nuevo encima del anterior: se conservan las carpetas y los ajustes. Para quitarla, desinstálala como cualquier otra app; eso borra también todo lo que guardó.

## Arrancarla desde el código

```bash
npm install
npx expo run:android      # dev build; el botón del auricular la necesita (Expo Go no tiene eventos de tecla nativos)
```

La clave de Gemini va en **Ajustes**, dentro de la app, o en un `.env` local como `EXPO_PUBLIC_GOOGLE_API_KEY` para desarrollar. El APK publicado se compila con `EXPO_NO_DOTENV=1`, así que ningún valor del `.env` puede acabar dentro, y antes de subirlo se comprueba que el bundle no contiene claves de API.

Los cuatro avisos se generan con `python scripts/generar_avisos.py`. Créditos del audio: [CREDITS.md](CREDITS.md).

## Privacidad y límites

- **El audio, el texto y los documentos de la biblioteca van a Google** (API de Gemini): el audio en cada turno, el texto de la biblioteca al indexarlo y los pasajes que se usan en cada análisis. Carpetas, conversaciones, biblioteca y ajustes viven en el móvil.
- **La clave se guarda en AsyncStorage tal cual**, no en el Keystore de Android.
- **Nunca compiles un APK para compartir con una clave en `.env`.** Expo incrusta las variables `EXPO_PUBLIC_*` en el bundle de JavaScript, así que cualquiera con el APK puede leerlas.
- **Deep Research cuesta dinero de verdad** (unos 1–3 $ por investigación). Nunca es la opción por defecto y se lee en voz alta antes de empezar.
- **El camino del audio no se puede probar desde una mesa.** Cada cambio de sonido se comprueba paseando.
- **El botón del cable y buena parte de la interfaz cero son solo de Android.**
- No hay tests automáticos en el repositorio; `npx tsc --noEmit` pasa sin errores.
- La interfaz, los perfiles y los prompts están en español; el analista contesta en el idioma en que hables.
