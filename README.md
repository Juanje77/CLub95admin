# Club 95 — sistema de gestión

Reemplaza la planilla `CLUB95_GESTION_ALE.xlsx`: caja diaria, gastos, membresías y panel del dueño.
Estado: **etapa 1 (modelo de datos, motor de cálculo, importación de septiembre 2026) + reglas de cierre diario, efectivo acumulado, compensación mensual y alertas**. Las pantallas de Caja, Gastos, Membresías y Panel vienen en las etapas siguientes.

## Cómo correrlo

```bash
npm install
cp .env.example .env        # DATABASE_URL (SQLite en desarrollo)
npx prisma db push          # crea la base
npm test                    # tests del motor de cálculo, PIN e importación
npm run typecheck
```

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

## Cierre de caja diario

- **Un cierre por día** para todo el local (`CashClose`, único por fecha). Quien cierra declara efectivo, transferencias y cambio dejado.
- El sistema calcula lo esperado desde las ventas (por medio de pago: casi todo es transferencia, algunos pagos son en efectivo) y la diferencia es `declarado − esperado`. **El cambio dejado no es ingreso**: no entra en la diferencia.
- Con diferencia (o efectivo/transferencia cruzados aunque el total cierre) la **nota es obligatoria**. No se cierra con ventas sin medio de pago.
- Cerrada, no se edita. Solo admin/dueño reabre, con **motivo**, y queda en la auditoría. Un barbero solo cierra el día de hoy; los días pasados requieren al admin.
- Lógica en `src/domain/closing.ts` (pura, con tests) y `src/services/closing.ts` (transacciones y auditoría).

### Fila de efectivo acumulado

Cada cierre **suma el efectivo del día** (`CashBoxEntry`, kind `CIERRE`). Los retiros de barberos (`RETIRO_BARBERO`) y las rendiciones al dueño (`RENDICION`) restan.
El saldo es lo que tiene que estar en la caja cuando pasás el fin de semana; al rendir se compara lo entregado contra el saldo y, si no coincide, hace falta una nota y salta una alerta.

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

## Deploy

Pendiente de definir hosting. Para producción hay que cambiar `provider = "sqlite"` por `"postgresql"` en el esquema
y apuntar `DATABASE_URL` a la base (los "enums" son `String` justamente para que el cambio no toque el modelo).
