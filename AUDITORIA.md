# Auditoría del sistema

Revisión completa de permisos, seguridad, reglas de plata, rendimiento, diseño y usabilidad. Cada hallazgo corregido tiene
su prueba (vitest, e2e o el recorrido automático de pantallas `scripts/audit-ui.sh`).

## Cómo se auditó

| Qué | Cómo |
|---|---|
| Permisos | Se recorrieron todas las acciones del servidor y todas las pantallas: cada escritura pasa por un chequeo de rol en el servicio (no solo en la interfaz). Un barbero que abre `/panel`, `/gastos`, `/barberos`, `/cuentas`, `/config`, `/auditoria` o `/mas` vuelve a la planilla (lo verifica `tests/e2e/audit.mjs`). |
| Sesión y PIN | Cookie firmada, vencimiento de 12 h, bloqueo a los 5 intentos, mismo tiempo de respuesta con usuarios que no existen. |
| Interfaz | `tests/e2e/audit.mjs` recorre 14 pantallas de admin y 5 de barbero, en celular (390 px) y escritorio (1280 px), en claro y oscuro: desborde horizontal, objetivos táctiles chicos, campos sin etiqueta, texto fuera de pantalla y errores de consola. Capturas en `/tmp/club95-audit`. |
| Contraste | Se calculó la relación de contraste (WCAG AA, 4,5:1) de cada par de colores de la marca en claro y oscuro. |
| Rendimiento | Se buscaron consultas repetidas en bucles y tablas sin índice. |

## Hallazgos corregidos

| # | Área | Severidad | Qué pasaba | Qué se hizo |
|---|---|---|---|---|
| 1 | Funcional | **Alta** | En Configuración, el "vigente desde" de tarifas, precios y reglas se completaba con la fecha UTC. Después de las 21:00 (hora argentina) proponía **mañana**, y el cambio de precio no regía hoy. | Ahora usa la fecha de Buenos Aires (`todayBA`). |
| 2 | Seguridad | **Alta** | Cambiar o resetear el PIN no cerraba las sesiones ya abiertas: un celular perdido seguía entrando hasta 12 h. | La sesión lleva una huella del PIN; si el PIN cambia, las demás sesiones dejan de valer. Quien cambia su propio PIN sigue adentro. Prueba en `tests/session.test.ts`. |
| 3 | Rendimiento | **Alta** | "A pagar a los barberos" (también el Panel y Socios) leía **todos los socios por cada barbero y por cada mes** para arrastrar el saldo: con un par de años de historia eran cientos de consultas por pantalla. | Precios y lo de los socios se leen una vez por mes y se comparten; los meses se calculan en paralelo. Prueba de tiempo con 12 meses de arrastre. |
| 4 | Rendimiento | Media | Faltaban índices en `MemberLedger` (socio/período y fecha), `CashCloseLine` (cierre) y `AuditLog` (fecha). | Índices agregados (se aplican solos con `prisma db push`). |
| 5 | Seguridad | Media | Faltaban cabeceras de seguridad (HSTS, política de permisos, CSP de encuadre). | Agregadas: `Strict-Transport-Security`, `Permissions-Policy`, `Content-Security-Policy` (`frame-ancestors`, `base-uri`, `form-action`, `object-src`). |
| 6 | Validación | Media | Retiros de efectivo y rendiciones aceptaban cualquier monto entero (sin tope). | Tope de 100.000.000 como en el resto de los montos. |
| 7 | Diseño | Media | El color de advertencia (`#b26a00`) tenía contraste 4,0:1 sobre tarjetas y 3,8:1 sobre su fondo (menos de 4,5:1). | Oscurecido a `#8a5200` (5,7:1). |
| 8 | Diseño | Media | En modo oscuro, los avisos de confirmación y las insignias llevaban texto blanco sobre verde/rojo claro (contraste ~2:1). | Texto oscuro sobre esos fondos en modo oscuro. |
| 9 | Diseño | Media | Botones de anular (✕), "Dar de baja", "Sacar", "Reintentar ahora" y los filtros de socios tenían menos de 44 px de alto; las celdas de la planilla, 34 px. | Mínimo de 44 px en botones y 38–40 px en celdas de planilla. |
| 10 | Diseño | Media | Enlaces dentro de párrafos ("panel del dueño", "Socios → Efectivo y cuentas") de 16 px de alto, difíciles de tocar. | Área táctil ampliada sin cambiar el aspecto del texto; "Volver a Socios" ahora es un botón. |
| 11 | Diseño | Baja | Los enlaces con aspecto de botón (Excel del panel, Ver todo lo que les debo) salían subrayados y desalineados. | Estilo de botón consistente (sin subrayado, centrado). |
| 12 | Usabilidad | Baja | En el Panel, tres botones de exportación ocupaban tres renglones antes de ver una sola cifra en el celular. | Quedaron en un desplegable "Exportar o imprimir". |
| 13 | Diseño | Baja | El mayor de barberos cortaba los encabezados de columna. | Encabezados en dos líneas, total del mes resaltado. |

## Verificado, sin problemas

- Todas las escrituras de servicios validan el rol; los servicios sin chequeo propio (`setProductCount`, `setDeclared`, `setChangeLeft`, ventas) pasan por `guardEdit` (un barbero solo edita el día de hoy y lo suyo; los días cerrados no se tocan).
- Descarga de comprobantes y exportaciones a Excel solo con sesión de admin/dueño.
- Sin desborde horizontal de página, sin campos sin etiqueta y sin errores de consola en ninguna pantalla (celular y escritorio, claro y oscuro).
- Fechas del servidor siempre con `todayBA` (zona de Buenos Aires); no quedan usos de `toISOString()` para "hoy".

## Pendiente: necesita decisión del dueño

| # | Tema | Detalle |
|---|---|---|
| A | Qué ve un barbero en la planilla | Hoy ve los **Ingresos, Mano de obra y Ganancia del mes del local** y las filas de los demás barberos (es como la planilla compartida original). No ve socios, panel ni cuentas. Si preferís que cada barbero vea solo lo suyo, es un cambio chico. |
| B | Stock negativo | Cargar una venta de producto con stock 0 deja el stock en negativo (no bloquea). Sirve para no frenar una venta, pero conviene cargar el stock real en Configuración. |
| C | Anular con `prompt()` | Los motivos de anulación usan el cuadro del navegador. Funciona, pero se ve poco cuidado en el celular; se puede cambiar por una hoja propia. |
| D | Fechas en el selector del teléfono | El formato (dd/mm o mm/dd) lo decide el idioma del teléfono; en un teléfono configurado en español de Argentina sale dd/mm/aaaa. |
| E | Límite de texto en notas | Las notas y descripciones no tienen largo máximo (solo las pueden cargar usuarios con sesión). |
