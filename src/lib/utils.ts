import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind sınıflarını çakışmasız birleştirir. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Sayıyı Türkçe biçimde gösterir: 12842 → "12.842" */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('tr-TR').format(value);
}

/** Tahmin Gücü gösterimi: 88.6 → "89" */
export function formatPower(value: number): string {
  return String(Math.round(value));
}

/** Yüzde gösterimi: 0.842 → "%84" */
export function formatPercent(ratio: number, digits = 0): string {
  return `%${(ratio * 100).toFixed(digits)}`;
}
