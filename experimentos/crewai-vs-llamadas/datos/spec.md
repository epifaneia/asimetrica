# Especificación técnica del producto — Controlador de riego RiegoNet R2

Documento ficticio creado para un experimento. Fabricante ficticio: Hidrovalle Sistemas. Cualquier parecido con productos o empresas reales es casual.

Referencia del documento: HV-R2-ET, revisión C.

## 1. Objeto y alcance

### 1.1 Objeto del documento

Este documento describe las características técnicas del controlador de riego RiegoNet R2, en adelante «el R2». Su finalidad es que instaladores, distribuidores y clientes profesionales puedan comprobar si el equipo se ajusta a las necesidades de una instalación concreta antes de comprarlo. El documento no sustituye al manual de instalación ni al manual de usuario, que se entregan con el equipo y amplían los procedimientos de montaje, cableado y puesta en marcha.

### 1.2 Alcance

La especificación cubre la unidad de control R2 en su configuración estándar, los accesorios propios de Hidrovalle Sistemas que se citan expresamente y la aplicación móvil RiegoNet en la versión vigente en la fecha de esta revisión. Quedan fuera del alcance las electroválvulas, el cableado de campo, las bombas y cualquier equipo de otros fabricantes que el cliente decida conectar. Cuando un dato de este documento dependa de un accesorio, se indica de forma explícita en el apartado correspondiente.

## 2. Descripción general del sistema

### 2.1 Arquitectura

El R2 es un controlador de riego para instalaciones residenciales grandes, comunidades de vecinos, pequeños parques y viveros. Consta de una unidad de control con pantalla y teclado frontal, una placa de bornas para las salidas de zona y las entradas de sensor, una fuente de alimentación interna y un módulo de comunicaciones inalámbricas integrado. Toda la lógica de riego reside en la propia unidad de control: la aplicación y el portal web son herramientas de configuración y consulta, no intervienen en la ejecución de los riegos.

### 2.2 Zonas de riego

El R2 gestiona 16 zonas de riego independientes en su configuración estándar, sin módulos adicionales. Cada zona dispone de su propia salida de 24 V CA para una electroválvula y puede programarse con duraciones, horarios y días distintos de las demás. Además de las 16 salidas de zona, el equipo ofrece una salida dedicada para el relé de arranque de bomba o para una válvula maestra, que se activa automáticamente siempre que haya una zona en riego.

### 2.3 Interfaz local

La pantalla frontal es monocroma, de 3,5 pulgadas, retroiluminada y legible a pleno sol. El teclado tiene ocho teclas de membrana y un selector giratorio. Desde la interfaz local se accede a todas las funciones del equipo, incluidas las de diagnóstico de las salidas y la consulta del registro de eventos.

## 3. Características eléctricas y alimentación

### 3.1 Alimentación de entrada

Alimentación de entrada: 100–240 V CA, 50/60 Hz, mediante fuente interna; no requiere transformador externo. El consumo propio de la unidad, sin válvulas activas, es inferior a 4 W. La entrada de red está protegida con un fusible rearmable y con un varistor contra sobretensiones de origen atmosférico.

### 3.2 Salidas de zona

Cada salida de zona entrega 24 V CA y admite una corriente máxima de 0,5 A, suficiente para dos electroválvulas estándar conectadas en paralelo. La corriente total que puede entregar el conjunto de salidas activas simultáneamente es de 1,5 A. Si una salida detecta un cortocircuito, el R2 la desconecta, registra el fallo y continúa regando el resto de zonas del programa.

### 3.3 Batería de respaldo

El R2 incorpora una batería interna recargable de iones de litio. Ante un corte de red, la batería de respaldo permite seguir ejecutando los riegos programados durante un máximo de 48 horas; transcurrido ese tiempo, el R2 detiene las válvulas y conserva los programas en memoria no volátil. La batería se recarga automáticamente cuando vuelve la alimentación de red y el tiempo de recarga completa es de unas seis horas.

## 4. Condiciones ambientales y mecánicas

### 4.1 Temperatura y humedad

Temperatura de funcionamiento: de −10 °C a +60 °C. Temperatura de almacenamiento, con el equipo desconectado y en su embalaje original: de −20 °C a +70 °C. Humedad relativa de funcionamiento: del 10 % al 95 %, sin condensación. Por debajo de 0 °C la pantalla puede responder con más lentitud, sin que ello afecte a la ejecución de los riegos.

### 4.2 Carcasa e instalación

La carcasa es de policarbonato estabilizado contra la radiación ultravioleta, con tapa abatible y cierre con llave. Las dimensiones exteriores son 260 × 210 × 95 mm y el peso de la unidad es de 1,9 kg. El equipo está pensado para montaje en pared, en interior o en exterior. La carcasa tiene grado de protección IP65 con la tapa cerrada y los prensaestopas originales correctamente apretados.

### 4.3 Vida útil de diseño

El R2 se ha diseñado para una vida útil de 8 años en condiciones normales de uso en exterior, con un ciclo diario de riego y la temperatura dentro del rango de funcionamiento. La pantalla y el teclado son los componentes con mayor desgaste previsto.

## 5. Programación y funcionamiento local

### 5.1 Programas de riego

El R2 dispone de seis programas independientes, cada uno con hasta ocho horas de inicio diarias. Los programas pueden definirse por días de la semana, por días pares o impares o por intervalos de entre uno y treinta días. La función de ajuste estacional permite aumentar o reducir de forma global la duración de todos los riegos, entre el 10 % y el 200 % del valor programado.

### 5.2 Funcionamiento sin conexión

Toda la programación puede realizarse desde el teclado frontal sin conexión a internet; los programas se ejecutan localmente aunque se pierda la conexión. Cuando la conexión se restablece, el R2 envía a la aplicación los eventos ocurridos durante el periodo sin conexión y sincroniza los cambios que se hayan hecho en uno u otro lado, dando prioridad a los cambios más recientes.

### 5.3 Riego manual y suspensión

El usuario puede lanzar un riego manual de cualquier zona o programa desde el teclado o desde la aplicación. También puede suspender todos los riegos durante un número de días configurable, entre uno y catorce, por ejemplo durante un periodo de lluvias o de obras en el jardín.

## 6. Sensores y accesorios

### 6.1 Entrada de sensor de lluvia (SEN1)

El R2 no admite sensores de lluvia de otros fabricantes: la entrada SEN1 solo reconoce el sensor HV-Pluvio, que se identifica mediante un protocolo propio. Cuando el HV-Pluvio detecta lluvia, el R2 suspende los riegos programados y los reanuda automáticamente una vez transcurrido el tiempo de secado que haya configurado el usuario.

### 6.2 Entrada de caudalímetro (SEN2)

La entrada SEN2 admite caudalímetros de impulsos de otros fabricantes, siempre que su salida sea de contacto libre de potencial y la frecuencia de impulsos no supere los 100 Hz. Hidrovalle Sistemas recomienda su caudalímetro HV-Flujo, que se suministra ya calibrado para el R2.

### 6.3 Detección de fugas y caudal anómalo

Con un caudalímetro conectado, el R2 compara el caudal medido en cada zona con el caudal aprendido durante los primeros riegos. Si el caudal supera en más de un 30 % el valor aprendido, el equipo interrumpe la zona, la marca como averiada y envía una notificación a la aplicación.

## 7. Conectividad y aplicación

### 7.1 Comunicaciones inalámbricas

El R2 incorpora Wi-Fi 802.11 b/g/n en la banda de 2,4 GHz. El equipo no dispone de conexión Ethernet por cable. La configuración de la red inalámbrica se realiza desde el teclado frontal o desde la aplicación mediante un emparejamiento por Bluetooth de baja energía, que solo se utiliza durante esa configuración inicial.

### 7.2 Aplicación RiegoNet y portal web

La aplicación RiegoNet, disponible para teléfonos Android e iOS, y el portal web de Hidrovalle Sistemas permiten consultar el estado del equipo, modificar programas, lanzar riegos manuales y recibir notificaciones de averías, cortes de red y riegos suspendidos por lluvia. Una misma cuenta puede gestionar varios controladores, y el titular puede invitar a otros usuarios con permisos de solo lectura o de administración.

### 7.3 Seguridad de las comunicaciones

Las comunicaciones entre el R2 y los servidores de Hidrovalle Sistemas van cifradas. Cada equipo se identifica con un certificado único grabado en fábrica. Las actualizaciones de firmware se descargan de forma automática, se verifican mediante firma digital antes de instalarse y solo se aplican fuera de los horarios de riego programados.

## 8. Registro de datos, garantía y soporte

### 8.1 Registro de consumo

Con un caudalímetro conectado a SEN2, el R2 registra el consumo de agua de cada zona en litros y conserva el histórico de los últimos 24 meses en memoria interna. El histórico puede consultarse en la pantalla, en la aplicación y en el portal web, y exportarse desde el portal en formato de hoja de cálculo.

### 8.2 Registro de eventos

El R2 guarda los últimos 2.000 eventos de funcionamiento, entre ellos inicios y finales de riego, cortes de red, fallos de salida, suspensiones por lluvia y cambios de programación. Cada evento incluye la fecha, la hora y el origen del cambio: teclado, aplicación o portal web.

### 8.3 Garantía y soporte

Hidrovalle Sistemas ofrece una garantía comercial de 3 años desde la fecha de compra, que cubre los defectos de fabricación de la unidad de control. Las actualizaciones de firmware se publicarán durante al menos 5 años desde la fecha de lanzamiento del producto. El soporte técnico atiende a instaladores profesionales por teléfono y correo electrónico en días laborables.
