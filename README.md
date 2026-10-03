# Club 95 — sistema de gestión

Reemplaza la planilla `CLUB95_GESTION_ALE.xlsx`: caja diaria, gastos, membresías y panel del dueño.
Estado: **etapa 1 (modelo de datos, motor de cálculo e importación de septiembre 2026)**. Caja, Gastos, Membresías y Panel vienen en las etapas siguientes.

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
| Comisión | Jere 60% · Beni/Lucio 60% · Ale 100% (administración): $ 17.000 / $ 19.000 por corte / corte y barba |

Todo vive en tablas con vigencia por fecha (`Tariff`, `BarberRule`, `ProductPrice`), no en el código.
Las reglas de arranque están en `src/import/rules.ts`.

## Usuarios de ejemplo (solo desarrollo)

| usuario | PIN | rol |
|---|---|---|
| jere | 1111 | barbero |
| ale | 2222 | admin (y barbero) |
| beni | 3333 | barbero |
| dueno | 9999 | dueño |

Cambiar los PIN antes de cualquier deploy.

## Estructura

- `prisma/schema.prisma` — modelo (dinero en enteros ARS, fechas `YYYY-MM-DD`, baja lógica, auditoría).
- `src/domain/` — cálculo puro: tarifas con vigencia, comisión, caja del día, resumen mensual.
- `src/import/` — lectura de la planilla, verificación y carga.
- `tests/` — Vitest.

## Deploy

Pendiente de definir hosting. Para producción hay que cambiar `provider = "sqlite"` por `"postgresql"` en el esquema
y apuntar `DATABASE_URL` a la base (los "enums" son `String` justamente para que el cambio no toque el modelo).
