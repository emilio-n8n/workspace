import type { Readable } from "node:stream";

/** Entrée d'écriture : clé opaque + contenu. Les métadonnées vivent en base. */
export type PutInput = {
  /** Clé opaque, ex. `orgs/<orgId>/<uuid>` — jamais de nom de fichier utilisateur non assaini. */
  key: string;
  body: Buffer;
  contentType?: string;
};

export type ObjectStat = {
  key: string;
  size: number;
  contentType?: string;
};

/**
 * Interface de stockage (ADR-0005).
 * Deux implémentations : LocalFS (défaut auto-hébergé) et S3-compatible.
 * Les clés sont opaques ; la convention de nommage est :
 * `orgs/<orgId>/…` (préfixe d'organisation appliqué par les appelants).
 */
export interface StorageAdapter {
  readonly driver: "local" | "s3";

  /** Écriture (écrasement autorisé). Implémentations atomiques côté local. */
  put(input: PutInput): Promise<void>;

  /** Lecture complète ; `null` si l'objet n'existe pas. */
  get(key: string): Promise<Buffer | null>;

  /** Lecture en flux ; `null` si l'objet n'existe pas. */
  getStream(key: string): Promise<Readable | null>;

  /** Taille et type (si disponibles) ; `null` si l'objet n'existe pas. */
  stat(key: string): Promise<ObjectStat | null>;

  /** Suppression idempotente (pas d'erreur si absent). */
  delete(key: string): Promise<void>;
}
