// Minimal className combiner — joins truthy class fragments with spaces.
// Avoids pulling in clsx/tailwind-merge for what is a one-liner here.
export type ClassValue = string | number | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
