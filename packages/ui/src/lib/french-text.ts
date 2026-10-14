/** Retourne « {n} {libellé} » avec accord français du libellé (singulier/pluriel). */
export function pluralizeFr(n: number, singular: string, plural?: string): string {
  return `${n} ${n > 1 ? (plural ?? `${singular}s`) : singular}`;
}
