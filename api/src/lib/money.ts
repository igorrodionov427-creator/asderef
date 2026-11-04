import { Prisma } from "@prisma/client";

/** Integer cents from a number / Decimal / string. Avoids float drift in comparisons. */
export function toCents(v: number | string | Prisma.Decimal | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const d = new Prisma.Decimal(v.toString());
  return d.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export function fromCents(c: number): string {
  return new Prisma.Decimal(c).div(100).toFixed(2);
}

/** 50% deposit rounded half-up to the cent. */
export function halfOf(totalCents: number): number {
  return Math.floor((totalCents + 1) / 2);
}

export const money = (v: Prisma.Decimal | null | undefined) => (v == null ? null : v.toFixed(2));
