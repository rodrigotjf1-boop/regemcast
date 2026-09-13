import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes e deixa a última vencer (`p-2` + `p-4` = `p-4`). */
export function cn(...valores: ClassValue[]): string {
  return twMerge(clsx(valores));
}
