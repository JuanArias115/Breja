# Breja FC

Despliegue del VPS y configuración de `breja.juanariasdev.com`: [deploy/README.md](deploy/README.md).

Aplicación web para organizar partidos, inscripciones, invitados y las cuentas del grupo. Interfaz en **inglés, alemán y español**, con el escudo original, diseño adaptable al móvil y animaciones que respetan la preferencia de movimiento reducido.

## Arranque

### Lugares

En **Lugares / Venues / Spielorte**, el administrador puede guardar lugares con nombre, dirección o enlace HTTPS al mapa y temporada (verano, invierno o todo el año). La temporada es una etiqueta: el administrador selecciona el lugar al crear cada partido. No hay un lugar predeterminado en Ajustes. La zona horaria del club sí es global; los partidos existentes conservan sus horarios.

Los jugadores ven la dirección y el acceso al mapa en el partido y en la invitación pública; el texto para compartir por WhatsApp también los incluye. Editar o archivar un lugar no modifica los partidos ya creados. Los lugares archivados se pueden restaurar. El lugar que estaba configurado antes se conserva; si no tenía dirección, hay que completarla.

### Noticias, cuenta e invitaciones

Las noticias se editan con pestañas English / Deutsch / Español. Basta completar título y mensaje en un idioma; las traducciones son opcionales. La vista previa utiliza el idioma seleccionado o la primera traducción disponible. Se puede adjuntar una portada JPG, PNG o WebP de hasta 10 MB: la app la reduce antes de guardarla y permite quitarla antes de publicar. Las imágenes se guardan en SQLite y solo se sirven a usuarios con sesión iniciada.

Los cargos en **Mi cuenta** enlazan al partido asociado e indican fecha y lugar. La invitación para compartir se prepara siempre en inglés e incluye horario, dirección, mapa, precio y enlace de inscripción; permite copiar tanto el mensaje completo como solo el enlace.

Los lugares con dirección incluyen un mapa de Google Maps, también en el formulario de creación y edición: se actualiza al escribir la dirección. Necesita conexión a internet. Si solo hay un enlace corto, se mantiene el botón de indicaciones sin inventar una posición en el mapa.

En **Partidos → Calendario** se puede navegar por meses, volver a hoy, elegir un día y abrir sus partidos. Las fechas se agrupan según la zona horaria global del club. La demo local incluye seis partidos históricos con cargos, pagos completos y parciales, saldo a favor y cuotas de invitados; todos los movimientos nuevos están vinculados a partidos. La carga de esos ejemplos es explícita e idempotente y no se ejecuta en producción.

### Ejecutar

Requiere **Node.js 24 o superior**. La aplicación utiliza SQLite incluido en Node y el SDK oficial Firebase Admin para verificar el acceso con Google.

```powershell
cd C:\Users\juana\Documents\Breja
npm ci
npm run dev
```

Abre **http://localhost:4173**. También puedes usar `npm start` sin el reinicio automático del modo desarrollo.

En la pantalla de acceso aparecen dos accesos de prueba:

- **Explore as organiser / Als Organisator testen**: cuenta de Alex, administrador.
- **Explore as member / Als Mitglied testen**: cuenta de Sam, miembro.

También funciona el registro y acceso por código. En desarrollo el código se muestra en la pantalla y los correos quedan en la base de datos; **no se envían mensajes externos**. Los cambios persisten en `.data/development.sqlite`. Las cuentas, partidos y pagos de demostración están separados de la futura base de producción.

### Google, alta manual y fotos

La configuración pública de Firebase se guarda en `FIREBASE_CONFIG` dentro de `.env`, como JSON de una línea con `apiKey`, `authDomain`, `projectId` y `appId`. No se usa Analytics ni se necesita una clave privada de servicio para verificar los ID tokens. Activar **Authentication → Google** en Firebase y añadir `localhost` a los dominios autorizados para desarrollo; al publicar, añadir también el dominio de la web. El botón Google aparece cuando existe esta configuración.

El navegador obtiene el ID token de Firebase y el servidor lo verifica con Firebase Admin. Solo acepta cuentas Google con correo verificado y autenticación reciente. La ficha se vincula por correo sin duplicar partidos ni saldo; una cuenta previamente vinculada no puede sustituirse por otro UID. `ADMIN_EMAIL` identifica al administrador inicial, con acceso verificado. Las sesiones y permisos del club siguen gestionados en el servidor. Desactivar una cuenta en Firebase no revoca por sí solo una sesión local ya emitida: la revocación coordinada queda pendiente antes de una publicación que requiera esa administración centralizada.

**Miembros → Añadir miembro** crea una ficha manual sin enviar invitaciones. Esa persona podrá acceder después con Google o el código por correo usando la misma dirección. La verificación por correo mantiene el proveedor actual de correo de la app; las fichas manuales no se crean anticipadamente en Firebase.

En **Mi perfil**, cada persona puede subir, previsualizar, sustituir y eliminar su foto. Se recorta al centro a 512 × 512; solo los miembros autenticados pueden verla. Las fotos se guardan localmente en SQLite, no requieren Cloud Storage. El ranking de inicio cuenta solo participaciones personales con asistencia “Jugó” en partidos finalizados; no suma invitados, ausencias ni partidos cancelados. Los empates comparten posición.

Referencias: [Google con Firebase](https://firebase.google.com/docs/auth/web/google-signin), [verificación de ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [planes de Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## Funciones implementadas

- Creación de partidos con fecha, horario, zona horaria, lugar, dirección, cupo, precio y plazo de cancelación; borradores, publicación y duplicación.
- Enlace de invitación que muestra únicamente los datos del partido a visitantes sin identificar. Copia del enlace y preparación del mensaje de WhatsApp para envío manual.
- Inscripciones personales e invitados bajo la responsabilidad del miembro que los añade.
- Cupos protegidos en el servidor; lista de espera por orden de llegada, oferta de plaza durante un máximo de dos horas, aceptación explícita y vencimiento automático mientras el servidor está activo.
- Cancelación gratis con **24 horas o más** de antelación; con **menos de 24 horas**, confirmación explícita del cargo. El plazo se puede configurar por partido.
- Revisión individual de asistencia al terminar el partido: jugó, no apareció o ausencia justificada. Invitados, ausencias y cancelaciones tardías conservan su motivo y responsable en cada cargo.
- Cierre idempotente: repetir la acción no duplica cargos. El precio de un partido no cambia al modificar los valores por defecto del club.
- Pagos parciales, anticipos, saldo a favor, método, pagador y vinculación opcional a una participación o invitado. El administrador puede anular una entrada con motivo; el original permanece en el historial.
- El miembro puede comunicar un pago. Solo la confirmación del administrador lo aplica al saldo.
- Cuentas privadas con movimientos y resúmenes mensuales. Los resúmenes incluyen saldos anteriores y respetan el calendario de la zona horaria del club.
- Generación mensual sin duplicados, bloqueada cuando quedan partidos abiertos del mes. Los mensajes quedan visibles en la bandeja de salida del administrador.
- Perfiles con foto, alta manual de miembros, ranking de participaciones, instrucciones de pago y noticias en inglés, alemán y español, y exportación CSV del libro de movimientos.
- Roles comprobados en el servidor, sesiones opacas con cookies HttpOnly, códigos de acceso de un solo uso, límites de intentos y comprobación del origen en modificaciones.

## Roles y altas

El primer acceso con Google o con código de correo abre una **solicitud de ingreso**. La persona completa su nombre, fecha de nacimiento y posición favorita; puede añadir una segunda posición distinta. La solicitud queda pendiente de revisión, sin acceso a las páginas privadas del club, fotos, noticias, cuentas o inscripciones. La restricción se aplica también en la API.

En **Miembros → Solicitudes de ingreso**, un administrador revisa el nombre, correo, fecha de nacimiento y posiciones antes de **aceptar o rechazar**. La aceptación permite entrar como miembro con la misma sesión al pulsar Actualizar; el rechazo mantiene el acceso bloqueado y se conserva en el historial de solicitudes. Volver a iniciar sesión no reinicia la solicitud ni evita la decisión. Al enviar una solicitud se encola un correo para cada administrador activo, con enlace a Miembros. No incluye datos personales del solicitante y no se duplica al repetir el envío. Las decisiones de aceptación o rechazo no generan correo adicional.

Las cuentas existentes conservan su acceso y sus datos. Las altas manuales mediante **Miembros → Añadir miembro** ya están aprobadas por el administrador. El administrador inicial definido en `ADMIN_EMAIL` queda aprobado al verificar por primera vez su identidad si todavía no existe ningún administrador, para poder gestionar las solicitudes. La fecha de nacimiento y los datos de la solicitud son visibles solo para la persona y los administradores.

Ya no existe una lista importada del Excel ni un proceso manual para vincular nombres. La migración retira esa lista sin borrar cuentas registradas, sesiones, partidos o movimientos. El Excel original se conserva localmente y no se incluye en Git.

En **Miembros → Cambiar rol**, un administrador puede asignar:

| Rol | Acceso |
| --- | --- |
| Miembro | Inscripciones, invitados, perfil y cuenta propia. |
| Administrador | Miembros y roles, asistencia, cobros, resúmenes, noticias, partidos, lugares y ajustes. |
| Desarrollador | Crear, duplicar y publicar partidos, gestionar lugares y ajustes generales; consultar noticias y editar su perfil. |

El desarrollador no recibe saldos, movimientos, resúmenes, instrucciones de pago ni contactos de otros miembros. No puede inscribirse, confirmar asistencia, cancelar partidos o realizar operaciones económicas. Los permisos se comprueban en cada petición; los cambios de rol se aplican a las sesiones existentes. Siempre debe quedar un administrador.

El contador de Inicio corresponde a las plazas reservadas del próximo partido. Al volver a cargar la vista tras su inicio, se muestra el siguiente partido disponible; el anterior queda en **Partidos → Anteriores**. Al finalizar, el administrador revisa la asistencia y cierra el partido: se generan los cargos y se actualiza el ranking de participaciones. El historial se conserva.

## Protección del acceso y de los correos

Se mantienen Google y los códigos por correo. En producción se exige Cloudflare Turnstile configurando **las dos** variables `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`. El servidor valida cada token con Cloudflare, comprueba el hostname exacto de `APP_ORIGIN` y la acción (`login_email` o `membership`), y rechaza la operación si la verificación falla o el proveedor no responde. No basta con mostrar el widget. Las claves de prueba de Cloudflare se rechazan en producción.

Los límites de autenticación se guardan en SQLite y sobreviven a reinicios, con identificadores HMAC en lugar de correos o IP en claro. Los contadores caducan y se limita su cantidad:

| Operación | Límite |
| --- | --- |
| Pedir código, por IP | 10 intentos / 10 minutos y 30 / 24 horas |
| Pedir código, por correo | 3 / 15 minutos y 6 / 24 horas; mínimo 60 segundos entre peticiones en producción |
| Códigos, conjunto de Breja | 30 / hora y 60 / 24 horas |
| Verificar código | 30 intentos / IP / 10 minutos; 10 / correo / 15 minutos; 5 por código |
| Google | 20 intentos / IP / 10 minutos |
| Solicitudes de ingreso | 10 intentos / IP / hora y 50 envíos / 24 horas en total |
| Sesiones | Máximo 5 sesiones guardadas por cuenta |

Los límites usan ventanas fijas que empiezan con la primera petición, no ventanas deslizantes. Las peticiones generales tienen además un límite en memoria de 300 por IP por minuto. Las respuestas HTTP 429 incluyen `Retry-After`.

`TRUSTED_PROXY_IPS` acepta solo direcciones exactas del proxy. Breja ignora las cabeceras de IP suministradas directamente por un visitante; un Nginx autorizado debe sobrescribir `X-Real-IP`. Si se recrea el proxy y cambia su IP, se debe actualizar esta variable. La aplicación no publica su puerto al exterior.

La cola de correo aplica un presupuesto persistente de **90 intentos / 24 horas** y **2500 / 30 días**, configurable con `EMAIL_DAILY_LIMIT` y `EMAIL_MONTHLY_LIMIT`. Cuenta intentos al proveedor, incluidos reintentos; borrar mensajes no repone presupuesto. Al alcanzar un tope, los mensajes esperan. Estos límites corresponden a Breja, no al consumo de otras aplicaciones ni a las cuotas/calendarios de la cuenta Resend. Se pueden consultar en **Health → Protección de acceso y correos**, exclusivo del rol `dev`.

El envío se espacia a un segundo y reintenta errores transitorios como máximo tres veces, conservando la clave de idempotencia. Los códigos caducados o sustituidos se cancelan, y su texto se borra después del envío. Los registros de correo terminados se limpian a los 30 días; los extractos y movimientos financieros permanecen. Una solicitud y sus notificaciones se guardan en la misma transacción. Las notificaciones no se envían a administradores que hayan perdido el rol o se hayan dado de baja.

El contenedor funciona sin privilegios adicionales, con raíz de solo lectura, datos persistentes en el volumen y límites de recursos. Se mantienen CSP, cookies HttpOnly/Secure, validación de origen, encabezados HTTPS y límites de tamaño/tiempo de petición. Turnstile protege formularios; **el dominio todavía no está detrás del proxy/WAF de Cloudflare**. Para esa capa hace falta migrar la zona DNS completa, verificando antes los registros de otros proyectos, MX, DKIM y SPF; después, TLS Full (strict), reglas para autenticación y protección del origen. Conviene activar MFA en Google/Cloudflare y usar una clave de Resend limitada al envío y al dominio remitente.

## Baja y anonimización de perfiles

En **Miembros → Eliminar y anonimizar perfil**, un administrador puede dar de baja otro perfil, incluidas solicitudes pendientes o rechazadas. La confirmación exige marcar que se entienden los efectos. No se permite eliminar la propia cuenta; siempre queda un administrador. La API exige sesión administradora, origen válido y `confirm: true`.

La baja es una operación atómica: conserva la fila y su identificador, añade `deleted_at`/`deleted_by`, reemplaza el nombre por una referencia `Deleted member · …`, vacía correo, teléfono, nacimiento y posiciones, desvincula el UID de Firebase y borra foto, sesiones y códigos pendientes. Se retiran de la base los correos guardados de esa cuenta y sus notas personales en pagos, reportes y auditoría vinculada. También se actualizan las copias del perfil en extractos. Los nombres de invitados dependientes se sustituyen por `Guest`, conservando cada inscripción por su identificador.

**Los pagos, cargos, anulaciones, métodos, fechas, vínculos e importes se conservan.** Los totales históricos de los extractos no se recalculan. La sección **Perfiles dados de baja** muestra la referencia y el saldo; permite registrar pagos para liquidarlo. Los totales de Pagos incluyen las bajas. Los pagos y anulaciones posteriores de estas cuentas no guardan nombres de pagadores ni notas personales.

Las inscripciones futuras de la persona y sus invitados se cancelan siguiendo el plazo habitual: una plaza confirmada fuera del plazo gratuito queda como cancelación tardía y se cobra al cerrar el partido. Las listas de espera avanzan. Las participaciones pasadas se conservan; el perfil deja de aparecer en el ranking. Volver a entrar con Google o correo crea una cuenta distinta que debe enviar una nueva solicitud, sin heredar permisos ni movimientos del perfil anterior.

Es una baja lógica con limpieza de los datos vinculados en la aplicación, sin opción de restauración desde la interfaz. No elimina la identidad del proveedor Firebase/Google, mensajes ya entregados o en curso de envío, exportaciones ni copias de seguridad anteriores. Tampoco busca nombres mencionados libremente en noticias, títulos de partidos o textos de otras cuentas. Las copias de seguridad deben tratarse por separado; restaurar una copia anterior también restaura los datos que contenía. No equivale a una purga física de los archivos SQLite.

## Datos y estructura

```text
public/                 Interfaz, traducciones, estilos y escudo
server/index.js         Servidor HTTP, autenticación, permisos y API
server/store.js         SQLite y reglas de partidos, cargos y resúmenes
server/seed.js          Datos de prueba para desarrollo
tests/                  Pruebas de negocio, API e interfaz
.data/                  Datos locales y privados (excluidos de Git)
```

SQLite utiliza WAL y claves foráneas. Los importes se guardan en céntimos y las fechas de eventos en UTC con una zona horaria explícita por partido. La zona inicial es Europe/Vienna y puede cambiarse en los ajustes. Las cuentas personales son privadas; la lista de jugadores muestra nombres visibles y la relación entre invitados y responsables, sin emails, teléfonos ni saldos ajenos.

Para una copia de seguridad sencilla, detén el servidor antes de copiar el directorio `.data/` completo. No copies únicamente el archivo `.sqlite` mientras hay escrituras activas, porque puede haber datos pendientes en el archivo WAL.

## Pruebas

```powershell
npm run check
npm test
```

Las pruebas de negocio y API requieren instalar las dependencias con npm ci; no necesitan conexiones de red. Cubren el límite exacto de 24 horas, el cupo, el orden de espera, ofertas caducadas, invitados, pagos parciales, saldo a favor, anulaciones, precios históricos, resúmenes por mes, permisos, privacidad de invitaciones y códigos de acceso de un solo uso.

La prueba `tests/browser.mjs` utiliza Playwright. Ejecuta el frontend contra los **mismos controladores de la API y una base SQLite en memoria**, interceptando todas las conexiones, sin abrir un servidor ni enviar emails. Para ejecutarla, instala Playwright en un entorno de herramientas o indica un módulo ya disponible y su navegador:

```powershell
$env:PLAYWRIGHT_MODULE = 'RUTA_ABSOLUTA\playwright\index.mjs'
$env:PLAYWRIGHT_EXECUTABLE = 'RUTA_ABSOLUTA\chrome-headless-shell.exe'
node tests/browser.mjs
```

Comprueba creación y persistencia tras recargar, inscripción, invitados, pagos, asistencia, resúmenes e interfaz en inglés/alemán a 320, 360 y 1440 píxeles. Guarda capturas en `test-results/`, excluido de Git. Esta prueba no sustituye una comprobación de conectividad del servidor HTTP real ni una prueba de entrega de email.

## Activación para el grupo

La dirección `localhost` solo sirve en este equipo. Para compartir enlaces utilizables por los participantes hace falta desplegar el servidor en una dirección HTTPS pública con almacenamiento persistente.

1. Copia `.env.example` a `.env` y configura `NODE_ENV=production`, `APP_ORIGIN`, `ADMIN_EMAIL`, `SESSION_SECRET`, `RESEND_API_KEY`, `MAIL_FROM`, `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`.
2. Publica el servidor detrás de un proxy HTTPS que conserve el encabezado `Host`. El proceso escucha en `127.0.0.1`; el proxy es quien recibe las conexiones públicas.
3. Verifica el dominio remitente en el proveedor de correo. La implementación del envío utiliza [la API de emails de Resend](https://github.com/resend/resend-openapi/blob/main/resend.yaml), con claves de idempotencia. Las credenciales se leen exclusivamente desde el entorno del servidor.
4. Accede con el email configurado en `ADMIN_EMAIL` para crear la primera cuenta administradora. En producción desaparecen las cuentas rápidas y los códigos visibles. Se usa una base independiente, `.data/breja.sqlite`.
5. Revisa participantes, zona horaria, importes e instrucciones de pago. Prueba el acceso y la entrega de correo con cuentas controladas antes de activar los envíos mensuales.
6. Para activar el cierre mensual automático, configura `AUTO_STATEMENTS=true` y mantén el servidor activo con un gestor de procesos. Durante los días 1–7 intenta crear el resumen del mes anterior; si quedan partidos abiertos, espera a que se cierren. Tras ese periodo puede generarse manualmente desde la aplicación. Los resúmenes existentes no se duplican.

El despliegue público está disponible en https://breja.juanariasdev.com, con HTTPS, SQLite persistente y Resend configurado. Un mensaje marcado `failed` en la bandeja requiere revisar el proveedor y la causa antes de reintentarlo; no se reenvía indefinidamente.

WhatsApp abre el mensaje preparado para que el organizador lo envíe. **El envío automático por WhatsApp y el cobro online no están integrados.** Los pagos se registran como dinero recibido, y se pueden indicar transferencias en las instrucciones del club.

Las correcciones de un mes ya resumido se conservan en la cuenta actual. Los resúmenes guardados conservan sus importes como instantáneas; una baja solo limpia los datos personales y notas de la copia, sin alterar sus totales. No se han implementado reprogramaciones de partidos con asistentes; para esta primera versión se cancela y se crea una nueva convocatoria.


## Health y registro técnico

La sección independiente **Health** (`/health`) y su API `GET /api/dev/health` están disponibles solo para cuentas aprobadas con rol `dev`. Ni `admin`, ni miembros, ni solicitudes pendientes tienen acceso. Los cambios de rol se comprueban en cada petición. No se cambia el rol de ninguna cuenta existente al desplegar.

Muestra una instantánea actualizable del proceso (tiempo activo y memoria), conexión SQLite, Turnstile, presupuesto de envío, mensajes en cola/fallidos/enviados y último envío. Es información de la aplicación, no monitorización completa del VPS ni de la cuenta Resend. Un error de las últimas 24 horas, mensajes fallidos o presupuesto agotado muestran «Requiere revisión».

La actividad registra accesos correctos/rechazados, límites, solicitudes y revisiones, cambios de roles y perfiles, ajustes, lugares, partidos, noticias y entregas de correo. El registro de errores recoge peticiones internas, tareas y entregas fallidas, con código controlado y estado HTTP cuando está disponible. Los reintentos aparecen como avisos. No es una auditoría forense ni expone el registro financiero administrativo.

Se guardan únicamente tipos de evento permitidos, área, rol, código, estado, fechas y contador. No se guardan identidades, IP, destinatarios, cuerpos de correo, códigos de acceso, claves, URLs, trazas de excepción ni detalles de pagos. Los registros empiezan con esta versión y persisten en SQLite entre reinicios. Retención máxima: 30 días o 2.000 grupos; repeticiones agrupadas por minuto. Cada lista muestra los últimos 100 grupos. Health es de consulta, sin botones para borrar registros o reenviar correos.

### Invitados / referidos por partido

El administrador puede marcar «Permitir invitados / referidos» al crear un partido y cambiarlo después desde Administrar en el detalle, guardando el cambio. Los partidos nuevos lo tienen desactivado por defecto; los existentes mantienen el permiso previo. Desactivarlo bloquea nuevas inscripciones de invitados también en la API, pero conserva inscripciones, listas de espera y pagos existentes. Los miembros siguen pudiendo inscribirse a sí mismos. El rol dev no puede activar este permiso.

### Idiomas

La interfaz y los correos admiten inglés, alemán, español, portugués y árabe. El árabe cambia la dirección de lectura a derecha a izquierda. Los perfiles guardan el idioma elegido; las noticias permiten traducciones opcionales en los cinco idiomas (sin traducir automáticamente contenido escrito por miembros). Las instrucciones de pago son editables por idioma. El máximo predeterminado para nuevas instalaciones es de 18 jugadores.
