# Club 95 — sistema de gestión

Reemplaza la planilla `CLUB95_GESTION_ALE.xlsx`. Se usa desde el celular (instalable como app) y mantiene **la misma forma de trabajo que la planilla**: los días van en columnas y solo se cargan **cantidades**; el resto se calcula.

| Módulo | Para qué | Quién |
|---|---|---|
| **Planilla** | Cantidad de servicios, socios, bebidas y ceras de cada día; control del día (ingresos, mano de obra, dinero que debe haber, **ganancia del día**); dinero ingresado y cierre de caja | barberos (lo suyo, hoy) · admin/dueño (todo) |
| **Socios** | Planilla mensual de socios (sesiones, total, cobrado, diferencia, estado), cuenta corriente que arrastra la deuda, cobros y ajustes con motivo; asistencia por día | barberos tildan hoy · admin/dueño todo |
| **Gastos** | Alta rápida con foto del comprobante, conceptos, gastos fijos con recordatorio, otros ingresos | admin/dueño |
| **Panel** | Resumen mensual tipo `TOTALES`, comparativo de 6 meses, ranking de barberos, días fuertes y flojos, descuadres. Excel y PDF | admin/dueño |
| **Efectivo** | Fila de efectivo acumulado, retiros de barberos, rendición al dueño | barbero (su retiro) · admin/dueño |
| **Alertas** | Todo lo que hay que atender para que la caja cierre todos los días | cada rol ve las suyas |
| **Configuración** | Equipo y comisiones, tarifas, productos y stock, PIN de cada usuario | admin/dueño |
| **Auditoría** | Quién cargó, modificó o borró cada cosa y cuándo | admin/dueño |

Estado: **completo** según el pedido original (caja diaria, gastos, membresías, panel del dueño, auditoría, importación de la planilla, carga sin señal, deploy en Vercel). Lo que no está hecho se lista en [Límites conocidos](#límites-conocidos).

---

## Cómo se usa (día a día)

1. **Entrar** con usuario y PIN. Cada uno puede cambiar su PIN en *Mi PIN*.
2. **Planilla:** en la columna de hoy, escribir la cantidad (cortes, corte y barba, barba y cejas, socios, bebidas, ceras) y tocar afuera o Enter. Se guarda solo.
   Si no hay señal, el número queda marcado como pendiente y se envía cuando vuelve la conexión.
3. **Al cerrar el día:** cargar el dinero ingresado (efectivo, Brubank, Brubank Juan, Mercado Pago) y el cambio dejado; tocar el número del día y **Cerrar el día**. Si hay diferencia, la nota es obligatoria.
4. **Socios:** tildar a los socios que vinieron hoy.
5. **El fin de semana (admin/dueño):** en *Más → Efectivo*, rendir el efectivo acumulado.
6. **A fin de mes (admin/dueño):** revisar el *Panel*, confirmar las compensaciones y exportar a Excel/PDF si hace falta.

Reglas de permisos: un barbero carga **lo suyo y solo hoy**; cargar un día pasado, o a nombre de otro, requiere admin/dueño. Un día cerrado no se edita: solo admin/dueño lo reabren, con motivo, y queda registrado.

---

## Reglas de negocio vigentes (septiembre 2026)

| | |
|---|---|
| Tarifas (iguales para todos) | Corte $ 20.000 · Corte y barba $ 22.000 · Barba y cejas $ 15.000 |
| Bebida incluida (se descuenta antes de la comisión) | Jere $ 1.500 · Ale y Lucio $ 3.000 |
| Comisión | Jere 60% · Lucio 60% (mismas condiciones que Beni, a confirmar) · Ale 100% (administración): $ 17.000 / $ 19.000 por corte / corte y barba |
| Membresía | Black $ 16.250 / $ 17.500 · Gold $ 20.000 / $ 23.000 (corte / corte y barba) **por sesión**; el barbero cobra (precio − bebida) × su comisión |

Nada de esto está fijo en el código: vive en tablas con **vigencia por fecha** (`Tariff`, `BarberRule`, `ProductPrice`, `MemberPrice`) y se cambia desde *Configuración*. Un cambio rige desde su fecha; el pasado no se reescribe (solo el dueño puede corregir hacia atrás).
Moneda ARS sin decimales (`$ 12.500`), fechas `dd/mm/aaaa`, zona horaria `America/Argentina/Buenos_Aires`.

### Cómo se calcula el día (como la hoja mensual)

- **Total ingresos** = servicios + bebidas sueltas + ceras/polvo/aceite.
- **Mano de obra** de cada barbero = (precio − bebida) × su comisión, por servicio.
- **Dinero que debe haber** = ingresos − mano de obra.
- **Ganancia del día** = parte del local en los servicios + margen de la bebida incluida + margen de las bebidas sueltas + margen de ceras/polvo/aceite. Las membresías se liquidan aparte.
- **Diferencia de caja** = dinero ingresado − (ingresos + cobros de socios del día). El cambio dejado **no** es ingreso.

### Cómo se calcula el mes (Panel)

Mismas filas que la hoja `TOTALES`: cantidades · ingresos (cortes, membresías por visita, bebidas, ceras, publicidad, alquiler de yerba) · mano de obra por barbero · **libre** (ingresos − mano de obra) · costos · **margen bruto** · gastos variables, de estructura e inversiones · **resultado final**.
Las compras de mercadería (`REPOSICION`) no restan del resultado: su costo ya está en "costos" por lo consumido.

---

## Cierre de caja, efectivo y compensación

- **Un cierre por día** para todo el local. Quien cierra declara el dinero ingresado; si no cuadra, nota obligatoria. Cerrado, no se edita.
- **Fila de efectivo acumulado:** cada cierre suma el efectivo del día; los retiros de barberos y las rendiciones al dueño restan. Al rendir se compara lo entregado con el saldo (nota obligatoria si no coincide).
- **Retiros en efectivo: el banco primero.** Los pagos son casi todos por transferencia y los barberos cobran de lo recaudado en el banco. Solo si el banco no cubrió lo que les corresponde ese día pueden completar con efectivo: el faltante es *mano de obra total − transferencias ingresadas* y se reparte en proporción. Un retiro por encima de eso exige un motivo y avisa al admin (`RETIRO_EFECTIVO_EXCEDE`).
- **Compensación de fin de mes:** compara lo que le corresponde a cada barbero (servicios + membresías que atendió + ajustes) contra lo que ya cobró (retiros en efectivo + transferencias a su cuenta propia). Positivo: el local le debe; negativo: cobró de más. Queda en borrador hasta que el admin la confirma. La parte de membresías sale sola de la asistencia.

## Membresías

Funciona como la hoja de socios (`OCTUBRE 2026` de `Club95_v3.xlsx`): **una fila por socio y por mes**.

- Cada socio tiene **plan** (Black / Gold), **tipo** (corte / corte y barba), barbero asignado y precio por sesión con vigencia. Precios por defecto: Black $ 16.250 / $ 17.500, Gold $ 20.000 / $ 23.000 (se cambian en `Setting` `memberPrices`; un socio puede tener un precio propio, como el de $ 13.750 de la planilla).
- **Sesiones del mes:** se escribe el número en la tabla (como la columna SESIONES). Si no se escribe, se cuentan las asistencias tildadas en la vista *Asistencia por día*. Vaciar el campo vuelve a contar la asistencia.
- Por fila: **total** (sesiones × precio), **cobrado**, **diferencia** (cobrado − total), **estado** (Pagó / Parcial / Impago), fecha del último pago y saldo.
- **Cuenta corriente** (si un socio no paga): lo que no se paga **se arrastra de un mes al siguiente** y queda a la vista en "quién debe" (con desde qué mes) y, por socio, en una tabla mes a mes con saldo acumulado.
- **Cobros:** llevan medio (efectivo / banco) y entran a la caja del día en que se cobran. El campo **Corresponde a** (la columna MES QUE CORRESPONDE) indica el mes de servicio que cubre: mes anterior, actual o siguiente; si se deja en automático, cubre el mes **más viejo que debe** (y si no debe nada, queda como pago adelantado).
- Los ajustes llevan motivo obligatorio y los movimientos se anulan (no se borran).
- El **barbero** cobra (precio − bebida) × su comisión por cada sesión que atendió, haya pagado o no el socio: si un socio no paga, el local es quien carga con esa deuda y la sigue reclamando en la cuenta corriente.
- Si la asistencia tildada no coincide con los "socios" cargados en la planilla del día, aparece una nota de diferencias (no se corrige sola).

### Cargar los socios desde el Excel

**Socios → "Cargar los socios desde la planilla de Excel"** (solo admin/dueño). Se sube `Club95_v3.xlsx`, se elige la hoja del mes y se ve una **vista previa antes de guardar**:

- Se crean los socios que faltan (plan, tipo, barbero, precio propio si la fila lo trae distinto del plan).
- Las **sesiones** y el **cobro** de cada fila van al mes que dice *MES QUE CORRESPONDE* (mes anterior / actual / siguiente de la hoja). Quien no pagó queda debiendo en la cuenta corriente.
- Los cobros se registran como transferencia/banco (la planilla no dice el medio). Si el cobro no tiene fecha, se usa el primer día del mes de la hoja. Si el día de un cobro ya está cerrado en la caja, **ese cobro no se carga** (para no mover un cierre): se avisa.
- Se avisa y **no se carga** lo que no se puede: filas sin plan o sin tipo, filas con datos pero sin nombre, nombres repetidos. Si el barbero de la planilla no está cargado en el equipo (por ejemplo Beni o Betún), el socio queda **sin asignar**.
- Se puede repetir sin duplicar socios ni cobros. Solo se lee la hoja elegida: lo que se debía de meses anteriores no se carga si no está en ella.

## Gastos

- **Lista cerrada de conceptos** administrable (reemplaza al control "MAL CARGADO EL CONCEPTO"), con categoría: variable, estructura, inversión o reposición.
- Alta rápida con fecha, concepto, monto, descripción y **foto del comprobante** (se reduce en el celular antes de subirla; solo la ve admin/dueño).
- **Gastos fijos recurrentes** (alquiler, luz, internet…): avisan si no se cargaron pasado su día.
- Filtros por mes y concepto, totales por categoría. Los gastos se borran con baja lógica y quedan en la auditoría.
- **Otros ingresos** (publicidad, alquiler de yerba) por mes.

---

## Alertas

Se recalculan al abrir cada pantalla y se guardan en la tabla `Alert` (sin duplicar; se resuelven solas cuando la situación se arregla). `npm run alerts` las imprime.

| Código | Cuándo | Gravedad | Quién |
|---|---|---|---|
| `CIERRE_PENDIENTE_HOY` | Hay ventas hoy y pasó la hora de aviso sin cerrar | aviso | barbero, admin |
| `CIERRE_ATRASADO` | Un día anterior con ventas quedó sin cerrar (a los 2 días suma al dueño) | error | barbero, admin (+dueño) |
| `DIA_SIN_MOVIMIENTO` | Martes a sábado sin ventas ni cierre ni marca de "no abrió" | aviso | admin (+dueño) |
| `VENTAS_SIN_MEDIO_DE_PAGO` | Ventas cargadas una por una sin medio de pago: no se puede cerrar | aviso | barbero, admin |
| `CIERRE_REABIERTO` | Se reabrió una caja y no se volvió a cerrar | aviso | todos |
| `CIERRE_CON_DESCUADRE` | La caja cerró con faltante o sobrante (error desde el umbral) | aviso / error | admin, dueño |
| `DESCUADRE_SIN_NOTA` | Hay diferencia sin nota explicativa | error | admin, dueño |
| `CIERRE_TARDIO` | Se cerró otro día distinto al de las ventas | info | admin, dueño |
| `CAMBIO_INSUFICIENTE` | Quedó menos cambio que el mínimo en el último cierre | aviso | barbero, admin |
| `EFECTIVO_ALTO` | Más de la mitad de lo cobrado fue efectivo (casi todo debería ser transferencia) | info | admin |
| `CAJA_EFECTIVO_NEGATIVA` | El efectivo acumulado dio negativo | error | admin, dueño |
| `EFECTIVO_ACUMULADO_ALTO` | El acumulado supera el límite: hay que rendir | aviso | admin, dueño |
| `RENDICION_ATRASADA` | 7 días o más sin rendir con saldo positivo | aviso | admin, dueño |
| `RENDICION_CON_DIFERENCIA` | Lo entregado no coincide con el saldo | error | admin, dueño |
| `RETIRO_EFECTIVO_EXCEDE` | Un barbero retiró efectivo estando cubierto por el banco (o más que el faltante) | aviso | admin, dueño |
| `STOCK_BAJO` | Un producto activo llegó al stock mínimo | aviso | admin, dueño |
| `GASTO_FIJO_PENDIENTE` | Un gasto fijo del mes venció y no está cargado | aviso | admin, dueño |
| `SOCIO_CON_DEUDA` | Un socio sigue debiendo de meses anteriores pasado el día de vencimiento | aviso | admin, dueño |
| `SOCIO_SIN_VENIR` | Un socio activo no viene hace 30 días o más | info | admin, dueño |
| `LIQUIDACION_PENDIENTE` | El mes anterior sin compensación confirmada (error desde el día 10) | aviso / error | admin, dueño |

Configuración en la tabla `Setting` (clave `alerts`, JSON). Valores por defecto:

```json
{ "closeReminderTime": "20:30", "requiredDays": [2,3,4,5,6], "descuadreErrorThreshold": 5000, "minChange": 5000,
  "boxMaxBalance": 200000, "boxMaxDays": 7, "cashShareWarn": 0.5, "cashShareMinTotal": 50000,
  "settlementErrorDay": 10, "startDate": null, "memberInactiveDays": 30, "memberDebtDay": 10 }
```

`startDate` es la fecha de arranque: los días anteriores no generan alertas. El primer deploy la fija en el día de arranque. Los feriados o días sin atender se marcan desde la pantalla de alertas ("No abrimos ese día").

---

## Cómo correrlo

```bash
npm install
cp .env.example .env        # DATABASE_URL (SQLite en desarrollo); SESSION_SECRET es opcional
npx prisma db push          # crea la base
npm run seed                # usuarios de ejemplo, tarifas, cuentas, productos y conceptos de gasto
npm run dev                 # http://localhost:3000  (en el celular: la IP de tu PC, misma red wifi)
npm test                    # tests (lógica, servicios, importación, cola sin señal)
npm run typecheck
npm run e2e                 # prueba en navegador móvil, arma su propia base (necesita CHROME=/ruta/a/chrome)
```

### Usuarios de ejemplo (solo desarrollo)

| usuario | PIN | rol |
|---|---|---|
| juan | 9999 | dueño |
| ale | 2222 | admin (y barbero) |
| jere | 1111 | barbero |
| lucio | 4444 | barbero |
| beni | 3333 | inactivo: figura solo en el histórico de septiembre |

En septiembre 2026 Beni y Lucio compartían el puesto y la planilla no los separa (columna "BENI / LUCIO"): esas ventas quedan a nombre de Beni (inactivo). **En producción los PIN se generan al azar** (ver deploy).

### Importar un mes de la planilla

Dejá el xlsx en `data/planilla.xlsx` (la carpeta `data/` no se versiona) y:

```bash
npm run import:planilla -- --month 2026-09 --dry-run   # solo verifica y escribe el reporte
npm run import:planilla -- --month 2026-09             # verifica y carga en la base
```

El reporte queda en `data/reports/import-AAAA-MM.md`. Importar de nuevo un mes da de baja lógica lo importado antes. El script **informa** las diferencias que encuentra en la planilla (códigos `WARN`/`ERROR`) y no las corrige en silencio: recalcula cada día con las fórmulas de la planilla y exige que coincida, y contrasta los totales del mes contra `TOTALES`.
Septiembre 2026 está verificado (30 días, 10 de 10 totales coinciden). Soporta las hojas con la estructura de ABR a OCT; **antes de septiembre no hay tarifas cargadas** en el sistema, así que no se pueden importar meses anteriores sin cargarlas primero.

---

## Deploy en Vercel

SQLite no sirve en Vercel (el disco es efímero), así que producción usa **Postgres (Neon)**. El modelo es el mismo: `scripts/prisma-pg.mjs` deriva `prisma/schema.postgres.prisma` del esquema de desarrollo cambiando solo el proveedor. Desarrollo y tests siguen con SQLite. Probado de punta a punta contra Postgres 16.

1. **Base de datos:** en Vercel, *Storage → Create → Neon (Postgres)*, región **São Paulo**, conectada al proyecto con los entornos **Production y Preview**. La integración crea sola las variables (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`…); el build las reconoce aunque tengan prefijo (`src/lib/db-env.ts`).
2. **Proyecto:** importar el repositorio. En *Settings → Git → Production Branch* poné la rama con la app. El build sale de `vercel.json` (`npm run vercel-build`).
3. **Primer deploy:** crea las tablas, los datos base (tarifas, productos, conceptos, cuentas) y, **solo si la base está vacía**, los usuarios con **PIN al azar**, que imprime **una sola vez** en el log del build (*Deployments → el deploy → Build Logs*, "Usuarios creados con PIN al azar"). Anotalos y cambialos enseguida desde *Mi PIN*.
4. Abrir la URL en el celular y "Agregar a la pantalla de inicio".

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DATABASE_URL` (o `POSTGRES_URL`…) | sí | La crea la integración de Neon. |
| `DATABASE_URL_UNPOOLED` (o `DIRECT_URL`) | recomendada | Conexión sin pooler para crear las tablas. La crea Neon. |
| `SESSION_SECRET` | no | Clave para firmar la sesión; si falta se deriva de la conexión a la base. Definir una propia permite rotarla sin tocar la base. |

El seed corre en cada deploy y **es seguro**: solo crea lo que falta, nunca pisa tarifas, comisiones, precios, stock ni PIN que ya existan. `prisma db push` también corre en cada build: si un cambio del esquema fuera destructivo, el build **falla** en vez de borrar datos.

### Copias de seguridad

Los datos están en Neon, que guarda el historial para **restaurar a un momento anterior** (*Neon → Branches → Restore*). Antes de cualquier operación riesgosa conviene crear una rama de la base. Además, el Panel exporta a Excel el resumen del mes y la planilla del mes.

### Importar septiembre a producción (opcional)

```bash
DATABASE_URL="<la de producción>" npm run import:planilla -- --month 2026-09
```

(necesita el cliente de Postgres: antes `node scripts/prisma-pg.mjs && npx prisma generate --schema prisma/schema.postgres.prisma`, y después `npx prisma generate` para volver al de desarrollo).

---

## Seguridad

- Login por usuario y PIN con hash `scrypt`; 5 intentos fallidos bloquean la cuenta 10 minutos; el mensaje y el tiempo de respuesta no revelan si el usuario existe.
- Sesión en cookie firmada (`HMAC-SHA256`), `httpOnly`, 12 horas.
- Todos los permisos se validan **en el servidor** (`src/services/*`), no en la pantalla; las exportaciones y los comprobantes exigen sesión de admin/dueño.
- Auditoría de cada alta, cambio y baja con usuario y hora (`AuditLog`); nunca guarda PIN. Nada se borra de verdad (baja lógica).
- Los PIN se pueden resetear (el admin resetea barberos; solo el dueño resetea admin/dueño) y el nuevo se muestra una sola vez.

## Estructura del código

- `prisma/schema.prisma` — modelo (dinero en enteros ARS, fechas `YYYY-MM-DD`, baja lógica, auditoría).
- `src/domain/` — lógica pura y testeada: tarifas con vigencia, comisión, caja del día, grilla, cobertura de retiros, socios, alertas.
- `src/services/` — operaciones con base de datos y sus reglas de permisos: planilla (grid), cierre, efectivo, compensación, gastos, socios, administración, reportes, exportación, auditoría.
- `src/import/` — lectura, verificación y carga de la planilla de Excel.
- `src/app/`, `src/components/` — pantallas (Next.js App Router, mobile-first).
- `src/lib/offline-queue.ts` — cola de cambios sin señal.
- `tests/` — Vitest (más de 200 casos) y `tests/e2e/run.mjs` (navegador móvil).

## Límites conocidos

- **Carga sin señal:** cubre la planilla y la asistencia de socios (los cambios son valores absolutos). La app necesita haberse abierto con conexión: sin señal no se puede iniciar sesión ni abrir pantallas nuevas.
- **Meses anteriores a septiembre 2026** no se pueden importar (no hay tarifas cargadas para esas fechas).
- **Un cierre por día para todo el local** (no por barbero), igual que la planilla.
- El **PDF** se genera con "Imprimir / guardar PDF" del navegador (hay estilos de impresión), no con un generador propio.
- Las **alertas** se muestran dentro de la app; no se envían notificaciones push ni mensajes.
- `prisma db push` en el build es cómodo mientras no haya datos reales delicados; más adelante conviene pasar a migraciones (`prisma migrate`).
