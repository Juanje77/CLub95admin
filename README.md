# Club 95 — sistema de gestión

Reemplaza la planilla `CLUB95_GESTION_ALE.xlsx`: caja diaria, gastos, membresías y panel del dueño.
Estado: **etapa 1** (modelo, motor de cálculo, importación de septiembre 2026, reglas de cierre/efectivo/compensación/alertas) y **etapa 2: Caja diaria** (app web móvil). Gastos, Membresías y Panel del dueño vienen en las etapas siguientes.

## Cómo correrlo

```bash
npm install
cp .env.example .env        # DATABASE_URL (SQLite en desarrollo) y SESSION_SECRET
npx prisma db push          # crea la base
npm run seed                # usuarios de ejemplo, tarifas, cuentas y productos
npm run dev                 # http://localhost:3000  (en el celular: la IP de tu PC, misma red wifi)
npm test                    # tests del motor de cálculo, servicios, PIN y sesión
npm run typecheck
```

En producción correr `npm run build && npm start` (ver más abajo el deploy en Vercel; `SESSION_SECRET` es recomendada, si no se define se deriva de la base).
La app se puede instalar en el celular como PWA ("Agregar a la pantalla de inicio").

### Prueba de punta a punta (navegador móvil)

```bash
npm run build
SESSION_SECRET=algo-largo-1234 DATABASE_URL=file:/tmp/e2e.db npx next start -p 3100 &
BASE_URL=http://localhost:3100 CHROME=/ruta/a/chrome SHOTS=/tmp/shots npm run e2e
```

Recorre: login (y PIN incorrecto), carga de servicios, deshacer, bebidas, socio, cierre con y sin diferencia, caja cerrada bloqueada, cobertura de retiros, efectivo acumulado, reapertura y alertas, y deja capturas.

### Importar un mes de la planilla

Dejá el xlsx en `data/planilla.xlsx` (la carpeta `data/` no se versiona) y:

```bash
npm run import:planilla -- --month 2026-09 --dry-run   # solo verifica y escribe el reporte
npm run import:planilla -- --month 2026-09             # verifica y carga en la base
```

El reporte queda en `data/reports/import-AAAA-MM.md`. Importar de nuevo un mes da de baja lógica lo importado antes.
El script **informa** las diferencias que encuentra en la planilla (códigos `WARN`/`ERROR`); no las corrige en silencio.
Soporta las hojas con la estructura de ABR-26 a OCT-26; ENE a MAR tienen otra estructura y se agregan después.

## Reglas de negocio vigentes (septiembre 2026)

| | |
|---|---|
| Tarifas (iguales para todos) | Corte $ 20.000 · Corte y barba $ 22.000 · Barba y cejas $ 15.000 |
| Bebida incluida (se descuenta antes de la comisión) | Jere $ 1.500 · Ale y Beni/Lucio $ 3.000 |
| Comisión | Jere 60% · Beni/Lucio 60% (Lucio, desde octubre, con las mismas condiciones: a confirmar) · Ale 100% (administración): $ 17.000 / $ 19.000 por corte / corte y barba |

Todo vive en tablas con vigencia por fecha (`Tariff`, `BarberRule`, `ProductPrice`), no en el código.
Las reglas de arranque están en `src/import/rules.ts`.

## Pantallas (etapa 2)

| Pantalla | Quién | Qué hace |
|---|---|---|
| Login | todos | Usuario + PIN. 5 intentos fallidos bloquean la cuenta 10 minutos. Sesión de 12 horas en cookie firmada. |
| Hoy | barbero / admin | Botones grandes por servicio con el precio vigente; medio de pago (transferencia por defecto, efectivo, MP); visita de socio; venta de bebidas/productos con stock; deshacer la última; resumen y ventas del día. El admin puede mirar y cargar otro día y elegir el barbero. |
| Cierre | barbero / admin | Muestra lo que tiene que haber, calcula la diferencia en vivo, exige nota si no cuadra y bloquea el día al cerrar. El admin reabre con motivo. |
| Efectivo | barbero / admin | El barbero ve cuánto puede retirar hoy en efectivo. El admin ve la fila acumulada, registra rendiciones y retiros. |
| Alertas | barbero / admin | Las alertas que le corresponden por rol; el admin puede marcar un día como "no abrimos". |

Las reglas (quién puede cargar qué, día cerrado, día pasado) viven en `src/services/*` y están cubiertas por tests; las pantallas solo las invocan.

**Pendiente de esta etapa:** la carga offline. Hoy, si no hay señal, la app avisa que no se guardó nada y hay que reintentar; una cola de operaciones sin conexión se agrega como mejora.

## Cierre de caja diario

- **Un cierre por día** para todo el local (`CashClose`, único por fecha). Quien cierra declara efectivo, transferencias y cambio dejado.
- El sistema calcula lo esperado desde las ventas (por medio de pago: casi todo es transferencia, algunos pagos son en efectivo) y la diferencia es `declarado − esperado`. **El cambio dejado no es ingreso**: no entra en la diferencia.
- Con diferencia (o efectivo/transferencia cruzados aunque el total cierre) la **nota es obligatoria**. No se cierra con ventas sin medio de pago.
- Cerrada, no se edita. Solo admin/dueño reabre, con **motivo**, y queda en la auditoría. Un barbero solo cierra el día de hoy; los días pasados requieren al admin.
- Lógica en `src/domain/closing.ts` (pura, con tests) y `src/services/closing.ts` (transacciones y auditoría).

### Fila de efectivo acumulado

Cada cierre **suma el efectivo del día** (`CashBoxEntry`, kind `CIERRE`). Los retiros de barberos (`RETIRO_BARBERO`) y las rendiciones al dueño (`RENDICION`) restan.
El saldo es lo que tiene que estar en la caja cuando pasás el fin de semana; al rendir se compara lo entregado contra el saldo y, si no coincide, hace falta una nota y salta una alerta.

### Retiros de barberos: el banco primero

Los pagos son casi todos por transferencia y los barberos cobran de lo recaudado en el banco. **Solo si el banco no cubrió lo que les corresponde cobrar ese día pueden completar con efectivo** de la caja
(`src/domain/coverage.ts`): por barbero, efectivo permitido = mano de obra del día − transferencias recaudadas en sus ventas.
Un retiro en efectivo por encima de ese faltante es una excepción: el sistema exige un motivo y deja la alerta `RETIRO_EFECTIVO_EXCEDE` para admin y dueño.

### Compensación de fin de mes

Los barberos van cobrando durante el mes. A fin de mes `computeSettlement` compara **lo que les corresponde** (servicios + membresías + ajustes) contra **lo que ya cobraron** (retiros en efectivo + transferencias a su cuenta propia, p. ej. MP de Jere).
`balance > 0`: el local le debe; `balance < 0`: cobró de más y devuelve. Queda en borrador hasta que el admin la confirma.
La parte de membresías se carga a mano hasta que esté el módulo de Membresías.

## Alertas

`npm run alerts` calcula las alertas con el estado actual y las guarda en la tabla `Alert` (sin duplicar; se resuelven solas cuando la situación se arregla). Pensado para correr cada ~15 minutos.

| Código | Cuándo | Gravedad | Quién |
|---|---|---|---|
| `CIERRE_PENDIENTE_HOY` | Hay ventas hoy y pasó la hora de aviso sin cerrar | aviso | barbero, admin |
| `CIERRE_ATRASADO` | Un día anterior con ventas quedó sin cerrar (a los 2 días suma al dueño) | error | barbero, admin (+dueño) |
| `DIA_SIN_MOVIMIENTO` | Martes a sábado sin ventas ni cierre ni marca de "no abrió" | aviso | admin (+dueño) |
| `VENTAS_SIN_MEDIO_DE_PAGO` | Ventas del día sin medio de pago: no se puede cerrar | aviso | barbero, admin |
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
| `LIQUIDACION_PENDIENTE` | El mes anterior sin compensación confirmada (error desde el día 10) | aviso / error | admin, dueño |

Configuración en la tabla `Setting` (clave `alerts`, JSON). Valores por defecto:

```json
{ "closeReminderTime": "20:30", "requiredDays": [2,3,4,5,6], "descuadreErrorThreshold": 5000, "minChange": 5000,
  "boxMaxBalance": 200000, "boxMaxDays": 7, "cashShareWarn": 0.5, "cashShareMinTotal": 50000,
  "settlementErrorDay": 10, "startDate": null }
```

`startDate` es la fecha de arranque del sistema: **hay que configurarla el día que se empieza a usar**, si no los días anteriores sin datos generan alertas de "sin movimiento".
Los días que no se abre (feriados, vacaciones) se marcan con `markClosedDay`.

## Usuarios de ejemplo (solo desarrollo)

| usuario | PIN | rol |
|---|---|---|
| jere | 1111 | barbero |
| ale | 2222 | admin (y barbero) |
| lucio | 4444 | barbero (desde octubre 2026) |
| beni | 3333 | inactivo: figura solo en el histórico de septiembre |
| dueno | 9999 | dueño |

En septiembre 2026 Beni y Lucio compartían el puesto y la planilla no los separa (columna "BENI / LUCIO"): esas ventas quedan a nombre de Beni (inactivo).

Cambiar los PIN antes de cualquier deploy.

## Estructura

- `prisma/schema.prisma` — modelo (dinero en enteros ARS, fechas `YYYY-MM-DD`, baja lógica, auditoría).
- `src/domain/` — cálculo puro: tarifas con vigencia, comisión, caja del día, resumen mensual.
- `src/services/` — operaciones con base de datos: cierre, reapertura, efectivo acumulado, rendición, compensación, alertas.
- `src/import/` — lectura de la planilla, verificación y carga.
- `tests/` — Vitest.

## Deploy en Vercel

SQLite no sirve en Vercel (el disco es efímero), así que producción usa **Postgres (Neon)**. El modelo es el mismo: `scripts/prisma-pg.mjs`
deriva `prisma/schema.postgres.prisma` del esquema de desarrollo cambiando solo el proveedor. Desarrollo y tests siguen con SQLite.
Probado de punta a punta contra Postgres 16 (tablas, usuarios, build, login y la prueba en navegador móvil).

### Pasos

1. **Base de datos:** en Vercel, *Storage → Create → Neon (Postgres)*, región **São Paulo**, y conectala a este proyecto con los entornos
   **Production y Preview**. La integración crea sola las variables (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`…): **no hay que copiar nada a mano**.
   El build las reconoce aunque tengan prefijo o se llamen distinto (`src/lib/db-env.ts`).
2. **Proyecto:** *Add New → Project → importar `Juanje77/CLub95admin`*. En *Settings → Git → Production Branch* poné la rama que tiene la app.
   El build lo toma de `vercel.json` (`npm run vercel-build`).
3. **Primer deploy:** el build crea las tablas y, **solo si la base está vacía**, crea los usuarios jere, ale, lucio y dueno con **PIN al azar**
   y los imprime **una sola vez** en el log del build (*Deployments → el deploy → Build Logs*, buscá "Usuarios creados con PIN al azar").
   **Anotá los PIN y no compartas capturas del log.** En los deploys siguientes no cambia ningún PIN. También fija como fecha de arranque de las alertas el día del primer deploy.
4. Abrí la URL de Vercel en el celular y "Agregar a la pantalla de inicio".

### Variables de entorno

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DATABASE_URL` (o `POSTGRES_URL`…) | sí | La crea la integración de Neon. |
| `DATABASE_URL_UNPOOLED` (o `DIRECT_URL`) | recomendada | Conexión sin pooler para crear las tablas. La crea Neon. |
| `SESSION_SECRET` | no | Clave para firmar la sesión. Si no se define, se **deriva de la conexión a la base** (que ya es un secreto). Definir una propia (`openssl rand -base64 32`) permite rotarla sin tocar la base; al cambiarla se cierran todas las sesiones. |

### Importar septiembre a producción (opcional)

```bash
DATABASE_URL="<la de producción>" npm run import:planilla -- --month 2026-09
```

(con la planilla en `data/planilla.xlsx`; necesita el cliente de Postgres: correr antes `node scripts/prisma-pg.mjs && npx prisma generate --schema prisma/schema.postgres.prisma`, y después `npx prisma generate` para volver al de desarrollo).

### Notas

- `prisma db push` corre en cada build: si un cambio del esquema fuera destructivo, el build **falla** en vez de borrar datos. Cuando haya datos reales conviene pasar a migraciones (`prisma migrate`).
- `npm run seed:prod` sigue disponible para crear los usuarios a mano contra una base, pero ya no hace falta.
- Los datos de la planilla y `data/` no se suben al repositorio.
