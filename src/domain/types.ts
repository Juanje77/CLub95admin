export const SERVICE_TYPES = ["CORTE", "CORTE_BARBA", "BARBA_CEJAS"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_LABEL: Record<ServiceType, string> = {
  CORTE: "Corte",
  CORTE_BARBA: "Corte y barba",
  BARBA_CEJAS: "Barba y cejas",
};

export type Role = "DUENO" | "ADMIN" | "BARBERO";

/** Regla de pago de un barbero, vigente desde `validFrom`. */
export interface BarberRule {
  validFrom: string;
  /** Puntos básicos: 60% = 6000, 100% = 10000. */
  commissionBp: number;
  /** $ que se descuenta por servicio (bebida incluida) antes de aplicar la comisión. */
  drinkDeduction: number;
  /** $ de costo real de la bebida entregada por servicio. */
  drinkCost: number;
}

export interface TariffEntry {
  serviceType: ServiceType;
  validFrom: string;
  price: number;
}

export type ServiceCounts = Partial<Record<ServiceType, number>>;
