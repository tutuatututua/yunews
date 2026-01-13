import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combines class names safely.
 * We keep this even if the app uses mostly plain CSS so we can gradually adopt Tailwind utility classes.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
