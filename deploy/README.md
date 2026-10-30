# Breja en el VPS

Repositorio: https://github.com/JuanArias115/Breja — rama `main`.

- VPS comprobado: `juan@217.216.92.208`.
- Checkout: `/home/juan/breja`.
- URL prevista: `https://breja.juanariasdev.com`.
- DNS requerido: registro A `breja` → `217.216.92.208`.
- Administrador inicial: `juanariasbdev@gmail.com` (obtiene el rol al verificar su correo).
- Compose: proyecto `breja`, alias privado `breja-web:4173`, red externa `allegro_ingress`.
- Base persistente: volumen `breja_breja_data`, archivo `/app/.data/breja.sqlite`.
- Proxy compartido existente: `/opt/deliciasBakery/nginx.conf`, contenedor `deliciasbakery-web-1`.

## Estado de preparación

El repositorio, Docker y GitHub Actions están preparados. La publicación sigue pendiente de Resend, DNS y certificado TLS. `BREJA_DEPLOY_ENABLED=false` permite ejecutar las pruebas y construir Docker sin intentar publicar una aplicación incompleta.

## Correo y entorno privado

El servidor necesita `/home/juan/breja/.env` con permisos 600. Ya se ha generado un secreto de sesión; no lo reemplaces durante los despliegues. Nunca subir `.env` a Git.

1. En [Resend Domains](https://resend.com/domains), añadir `mail.breja.juanariasdev.com`.
2. Copiar exactamente los registros DNS de verificación que muestre Resend y esperar el estado verificado. No modificar los registros de correo existentes del dominio principal.
3. Crear una API key exclusiva para Breja con permiso de envío y restringida a ese dominio.
4. Conectarse al VPS y editar el archivo privado:

   ```sh
   ssh -i ~/.ssh/breja_actions juan@217.216.92.208
   nano /home/juan/breja/.env
   ```

   Completar `RESEND_API_KEY` con la clave real y:

   ```dotenv
   MAIL_FROM="Breja FC <no-reply@mail.breja.juanariasdev.com>"
   ```

5. Mantener `AUTO_STATEMENTS=false` hasta revisar los datos reales.

Referencias: [dominios Resend](https://resend.com/docs/dashboard/domains/introduction), [claves API](https://resend.com/docs/dashboard/api-keys/introduction).

Google es opcional: si se configura `FIREBASE_CONFIG`, añadir también `breja.juanariasdev.com` a los dominios autorizados de Firebase Authentication. El inicio de sesión por email no necesita Firebase.

## Primera publicación

1. Confirmar que el registro A apunta al VPS y que no existe un AAAA incorrecto.
2. Con el `.env` completo, ejecutar en el checkout del VPS:

   ```sh
   git pull --ff-only origin main
   docker compose build --pull
   docker compose up -d --wait --wait-timeout 120
   ```

3. Un administrador del proxy debe guardar una copia de `/opt/deliciasBakery/nginx.conf` y añadir inicialmente solo el bloque HTTP de `nginx-breja.conf` para servir los desafíos ACME. Validar con `docker exec deliciasbakery-web-1 nginx -t` antes de recargar.
4. Emitir el certificado con el cliente ACME del servidor usando `/opt/deliciasBakery/certbot/www` como webroot y `/opt/deliciasBakery/certbot/conf` como directorio de certificados. Incluir Breja en la renovación automática existente.
5. Instalar también el bloque HTTPS de `nginx-breja.conf`, sin duplicar el bloque HTTP. Validar y recargar Nginx. No reemplazar los bloques de otros sitios.
6. Comprobar `https://breja.juanariasdev.com/api/bootstrap`: HTTP 200, `development: false`, sin datos privados. Probar el acceso de administrador y la entrega del código por correo.
7. Activar la variable de repositorio `BREJA_DEPLOY_ENABLED=true` y ejecutar el workflow manualmente para comprobar el recorrido completo.

El puerto 4173 no se publica en el host; el acceso público se hace exclusivamente mediante el proxy HTTPS.

## Despliegues posteriores

`.github/workflows/deploy.yml` ejecuta las comprobaciones, las pruebas y la construcción Docker para PRs y pushes a `main`. Tras activar la variable, cada push a `main` despliega por SSH, espera el healthcheck y comprueba HTTPS. También admite ejecución manual.

Secrets de Actions: `VPS_HOST`, `VPS_USER`, `VPS_PATH`, `VPS_SSH_KEY_B64`, `VPS_KNOWN_HOSTS`. La clave SSH de Breja es independiente de las de otros proyectos; la identidad del host se comprueba contra known_hosts. Las credenciales de Resend y sesión permanecen únicamente en el VPS.

Para diagnosticar sin imprimir el entorno privado:

```sh
cd /home/juan/breja
docker compose ps
docker compose logs --tail 100 web
```

## Copia de seguridad

No ejecutar `docker compose down -v`: elimina la base de datos. Antes de actualizaciones que cambien el esquema, crear una copia SQLite consistente con `VACUUM INTO` o detener el servicio y copiar el volumen completo, incluidos los archivos WAL. Guardar las copias fuera del volumen activo y probar su restauración. Un rollback de imagen no revierte migraciones de datos.
