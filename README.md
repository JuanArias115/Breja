# Breja FC

Aplicación local para organizar partidos, inscripciones, invitados y las cuentas del grupo. Interfaz en **inglés, alemán y español**, con el escudo original, diseño adaptable al móvil y animaciones que respetan la preferencia de movimiento reducido.

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

Las cuentas se crean al registrarse o mediante **Miembros → Añadir miembro**. Ya no existe una lista importada del Excel ni un proceso manual para vincular esos nombres. La migración retira esa lista sin borrar cuentas registradas, sesiones, partidos o movimientos. El Excel original se conserva localmente y no se incluye en Git.

En **Miembros → Cambiar rol**, un administrador puede asignar:

| Rol | Acceso |
| --- | --- |
| Miembro | Inscripciones, invitados, perfil y cuenta propia. |
| Administrador | Miembros y roles, asistencia, cobros, resúmenes, noticias, partidos, lugares y ajustes. |
| Desarrollador | Crear, duplicar y publicar partidos, gestionar lugares y ajustes generales; consultar noticias y editar su perfil. |

El desarrollador no recibe saldos, movimientos, resúmenes, instrucciones de pago ni contactos de otros miembros. No puede inscribirse, confirmar asistencia, cancelar partidos o realizar operaciones económicas. Los permisos se comprueban en cada petición; los cambios de rol se aplican a las sesiones existentes. Siempre debe quedar un administrador.

El contador de Inicio corresponde a las plazas reservadas del próximo partido. Al volver a cargar la vista tras su inicio, se muestra el siguiente partido disponible; el anterior queda en **Partidos → Anteriores**. Al finalizar, el administrador revisa la asistencia y cierra el partido: se generan los cargos y se actualiza el ranking de participaciones. El historial se conserva.

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

1. Copia `.env.example` a `.env` y configura `NODE_ENV=production`, `APP_ORIGIN`, `ADMIN_EMAIL`, `SESSION_SECRET`, `RESEND_API_KEY` y `MAIL_FROM`.
2. Publica el servidor detrás de un proxy HTTPS que conserve el encabezado `Host`. El proceso escucha en `127.0.0.1`; el proxy es quien recibe las conexiones públicas.
3. Verifica el dominio remitente en el proveedor de correo. La implementación del envío utiliza [la API de emails de Resend](https://github.com/resend/resend-openapi/blob/main/resend.yaml), con claves de idempotencia. Las credenciales se leen exclusivamente desde el entorno del servidor.
4. Accede con el email configurado en `ADMIN_EMAIL` para crear la primera cuenta administradora. En producción desaparecen las cuentas rápidas y los códigos visibles. Se usa una base independiente, `.data/breja.sqlite`.
5. Revisa participantes, zona horaria, importes e instrucciones de pago. Prueba el acceso y la entrega de correo con cuentas controladas antes de activar los envíos mensuales.
6. Para activar el cierre mensual automático, configura `AUTO_STATEMENTS=true` y mantén el servidor activo con un gestor de procesos. Durante los días 1–7 intenta crear el resumen del mes anterior; si quedan partidos abiertos, espera a que se cierren. Tras ese periodo puede generarse manualmente desde la aplicación. Los resúmenes existentes no se duplican.

No se ha hecho un despliegue público ni una prueba de entrega real de correo. El proveedor de email, el dominio, el alojamiento y los saldos históricos requieren configuración/revisión del club. Un mensaje marcado `failed` en la bandeja requiere revisar el proveedor y la causa antes de reintentarlo; no se reenvía indefinidamente.

WhatsApp abre el mensaje preparado para que el organizador lo envíe. **El envío automático por WhatsApp y el cobro online no están integrados.** Los pagos se registran como dinero recibido, y se pueden indicar transferencias en las instrucciones del club.

Las correcciones de un mes ya resumido se conservan en la cuenta actual. Los resúmenes guardados son instantáneas y no se reescriben silenciosamente. No se han implementado reprogramaciones de partidos con asistentes; para esta primera versión se cancela y se crea una nueva convocatoria.
