# Prompt: sistema de gestión para Club 95 (barbería)

Copiá todo lo que sigue y pegalo como primer mensaje en una sesión nueva de Claude Code, dentro del repo `CLub95admin`.

---

## ROL

Actuá como un arquitecto de software senior especializado en sistemas de gestión para barberías y comercios de servicios en Argentina. Conocés caja diaria, comisiones por barbero, membresías/abonos, control de stock chico (bebidas, ceras) y administración de gastos. Priorizás simplicidad de uso: los empleados cargan datos desde el celular, entre cliente y cliente, y no son técnicos.

## OBJETIVO

Reemplazar la planilla de Excel actual (`CLUB95_GESTION_ALE.xlsx`) por una aplicación web (usable desde el celular, instalable como PWA) con tres módulos y un panel para el dueño:

1. **Caja diaria** (la usa el empleado/barbero): cargar cortes, ventas y cerrar caja.
2. **Gastos** (usa el administrador).
3. **Membresías** (usa el administrador y, para marcar asistencia, el empleado).
4. **Panel del dueño**: resultados por mes (reemplaza la hoja TOTALES).

Antes de escribir código: leé la planilla (`openpyxl`), confirmá que entendiste la lógica y mostrame un plan corto (stack, modelo de datos, pantallas). Después construí por etapas, probando cada una.

## COMO FUNCIONA HOY (extraído de la planilla)

**Hoja mensual (ene-26 … oct-26)**, una por mes, con una columna por día:
- Tarifas arriba: CORTE SOLO, CORTE Y BARBA SOLO, BARBA Y CEJAS SOLO (en meses viejos también "con bebida"). Ejemplo junio: 17.000 / 19.000 / 13.000. Los precios **cambian mes a mes**, así que el sistema necesita historial de precios.
- Por barbero (JERE, ALE, BENI): cantidad de servicios por tipo cada día; ingreso = cantidad × tarifa.
- "Cortes por mes" (membresías) se cuentan aparte.
- Ventas de bebidas: con corte (valor fijo, ej. $1.500) y sin corte (Monster $2.800, Coca/Fanta/Sprite/Aquarius $1.600), con costo de compra por bebida.
- Ventas de ceras, polvo y aceite (cera $20.000, polvo $13.000, aceite $10.000) con su costo.
- **Mano de obra**: Jere y Beni cobran 60% del ingreso por servicios (descontando el valor de la bebida incluida); Ale cobra 100% (es el dueño/admin, se computa distinto). El 40% restante queda para el local.
- **Cierre del día**: "dinero total que debe haber" = ingresos por cortes + bebidas − mano de obra. Se compara contra lo realmente ingresado: Brubank, Brubank Juan, MP Jere, efectivo y cambio dejado. Hoy la diferencia se mira a ojo.
- Membresía cobrada en efectivo / en Brubank o MP.

**Hoja Gastos**: fecha, mes, concepto, monto, descripción. Conceptos: ALQUILER, LUZ, INTERNET, MUNICIPAL, INGRESOS BRUTOS, MONOTRIBUTO, FONDO DE COMERCIO, GESTION, RECEPCION, SOL CM, GAS, REPARACIONES, LIMPIEZA, HOJA DE AFEITAR, CUELLOS, GUANTES, FARMACIA, DESINFECTANTE, ACEITE, REPOSICION DE BEBIDAS. Se agrupan en gastos variables, de estructura e inversiones (TV, estufa). Hay un control que avisa si un gasto quedó con concepto mal cargado. También hay una hoja de gastos estimados (agosto/septiembre).

**Hojas de membresías**: lista de clientes (plan BLACK), tipo (corte o corte y barba), barbero asignado, asistencia por fecha (tildes), cobro = asistencias × precio ($15.000 corte / $16.500 corte y barba, con ajustes manuales +/−). Hoja XMES: cuenta corriente por cliente (fecha, cliente, barbero, mes, debe, haber, saldo, efectivo/Brubank).

**TOTALES**: por mes — cantidades, ingresos por cortes, ingresos extra (bebidas, ceras, publicidad, alquiler de yerba), total ingresos, mano de obra por barbero, "libre" (ingresos − mano de obra), costos, margen bruto, gastos variables, gastos de estructura, inversiones.

**Otras**: RIFA (números, vendedor, comprador, precio, resumen efectivo/MP/gastos) y presupuesto de TV. Dejalas como módulo opcional de fase 2.

## REQUISITOS FUNCIONALES

### 1. Caja diaria (empleado)
- Login por usuario y PIN. Cada barbero ve solo su caja del día.
- Pantalla móvil con botones grandes: sumar un servicio (tipo de servicio, con o sin bebida, método de pago: efectivo / transferencia / MP). Poder deshacer el último.
- Venta de bebidas y productos (ceras, polvo, aceite) con descuento automático de stock.
- Marcar si el cliente es de membresía (no cobra el corte, descuenta asistencia).
- **Cierre de caja**: el sistema calcula lo que debe haber (ingresos − mano de obra del barbero) y el empleado declara efectivo, transferencias y cambio dejado. Muestra la diferencia, exige una nota si hay descuadre y bloquea la edición una vez cerrada (solo el admin puede reabrir, con registro).
- Poder cargar un día pasado solo con permiso del admin.

### 2. Gastos (admin)
- Alta rápida: fecha, concepto (lista cerrada con categoría variable / estructura / inversión), monto, descripción, comprobante opcional (foto).
- Conceptos administrables; eso elimina el "MAL CARGADO EL CONCEPTO".
- Gastos fijos recurrentes (alquiler, luz, internet) con recordatorio mensual.
- Filtros por mes y concepto, y total por categoría.

### 3. Membresías (admin)
- Alta de socio: nombre, plan, tipo (corte / corte y barba), barbero asignado, precio vigente.
- Asistencia: tildar al cliente cuando viene (desde la caja del barbero).
- Cobro mensual con cuenta corriente: debe / haber / saldo, medio de pago, ajustes manuales con motivo.
- Alertas: socios con deuda, socios que no vinieron en X días, vencimientos.
- Cuánto aporta cada socio al barbero y al local.

### 4. Panel del dueño
- Resumen mensual igual al de la hoja TOTALES: cantidades, ingresos por cortes y extras, mano de obra por barbero, libre, costos, margen bruto, gastos variables y de estructura, resultado final.
- Comparativo contra meses anteriores, ranking de barberos, días flojos/fuertes.
- Historial de descuadres de caja por barbero.
- Exportar a Excel/PDF.

## REGLAS DE NEGOCIO (parametrizables, nunca fijas en el código)
- Tarifas con vigencia por fecha.
- Porcentaje de comisión por barbero (hoy Jere 60%, Beni 60%, Ale 100%) con vigencia.
- El valor de la bebida incluida en el corte se descuenta antes de calcular la comisión.
- Costo de cada producto y stock mínimo con aviso.
- Moneda ARS, sin decimales, formato `$ 12.500`, fechas dd/mm/aaaa, zona horaria America/Argentina/Buenos_Aires.

## REQUISITOS TÉCNICOS
- Stack simple y mantenible, a definir en tu plan (sugerido: Next.js o similar + Postgres/SQLite con Prisma, autenticación por roles `dueño`, `admin`, `barbero`).
- Mobile-first, funciona con mala conexión, interfaz en español rioplatense.
- Auditoría: quién cargó, editó o borró cada registro y cuándo. Nada se borra de verdad (baja lógica).
- Tests automáticos para el cálculo de caja, comisiones y totales mensuales.
- **Migración**: script que importe el histórico de la planilla (servicios por día, gastos, membresías, XMES) y que verifique que los totales por mes coinciden con la hoja TOTALES. Informá cualquier diferencia que encuentres en la planilla en lugar de corregirla en silencio.
- README con cómo correrlo, usuarios de ejemplo y deploy.

## FORMA DE TRABAJO
1. Leé la planilla y devolveme: modelo de datos, pantallas y dudas abiertas (máximo 8 preguntas concretas).
2. Esperá mi OK y construí en este orden: modelo + migración de datos, Caja diaria, Gastos, Membresías, Panel.
3. Al terminar cada etapa, corré los tests, mostrame cómo probarla y recién ahí seguí.
4. Commits chicos y descriptivos en la rama de trabajo; no abras pull request salvo que te lo pida.
5. Si algo de la planilla es ambiguo (por ejemplo "40% JERE NO PAGO", ajustes manuales en membresías, "alquiler de yerba"), preguntá en vez de suponer.
