# Mundialito FC Breja

Web pública en `/mundialito`, independiente de las sesiones y de los datos privados del club.

- `index.html`: portada y navegación.
- `styles.css`: diseño adaptable.
- `data.js`: archivo de equipos, jugadores, goles y campeones. `null` significa registro no disponible; no sustituir por cero. Los autogoles no cuentan en el ranking de goleadores.
- `app.js`: vistas y enlaces compartibles mediante `edition` y `section`.

La edición 2026 incluye la clasificación corregida: Schnitzelona, Galataspeckaray, Kasspress Rangers y Wurst Ham United. En 2024, André y Lucca fueron porteros compartidos. Se conservan los nombres históricos sin fusionar identidades no confirmadas.

La edición 2027 conserva nombres, horarios y marcadores pendientes. Esta versión es de consulta: aún no incluye un editor de resultados ni cálculo automático de puntos. Actualizar los datos en el repositorio y publicar por el flujo existente de Breja. No introducir correos, pagos ni datos de las cuentas del club en estos archivos públicos.

Validación: `npm run check` y `npm test`.
