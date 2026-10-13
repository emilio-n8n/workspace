import { Button, EmptyState, IconChevronDown, IconTrash, Input, Label } from "@workspace/ui";
import {
  BLOCKS_LIMITS,
  type BlockField,
  type BlockFieldGroup,
  blockFieldsByGroup,
  blockGroups,
  blockLabel,
  type SiteBlock,
  type SiteBlockValue,
  type SiteInlineBlock,
  safeImageUrl,
  safeUrl,
} from "../blocks.ts";
import { BlockGlyph } from "./block-icon.tsx";

export type BlockPropertiesProps = {
  /** Bloc sélectionné ; `null` = aucun (panneau à l'état vide). */
  block: SiteBlock | null;
  canEdit: boolean;
  /**
   * Modifie une propriété d'un bloc : l'identifiant est fourni par le panneau
   * (bloc sélectionné ou enfant d'un bloc « colonnes »).
   */
  onPatch: (blockId: string, key: string, value: SiteBlockValue) => void;
  /** Déplace un bloc à l'intérieur de sa colonne. */
  onMoveChild: (id: string, direction: "up" | "down") => void;
  /** Ajoute un bloc simple dans un bloc « colonnes ». */
  onAddChild: (kind: "heading" | "text") => void;
  onRemoveChild: (id: string) => void;
};

/** Titres des trois familles de propriétés (contenu, lien, style). */
const GROUP_TITLES: Record<BlockFieldGroup, string> = {
  content: "Contenu",
  link: "Lien",
  style: "Style",
};

/**
 * Panneau de propriétés du bloc sélectionné (TASK-003) : contenu, lien et
 * style. Les champs sont **dérivés** de la description du bloc
 * (`BLOCK_LIBRARY`) : ajouter une propriété à un type de bloc la fait
 * apparaître ici, sans toucher ce fichier.
 */
export function BlockProperties({
  block,
  canEdit,
  onPatch,
  onMoveChild,
  onAddChild,
  onRemoveChild,
}: BlockPropertiesProps) {
  if (!block) {
    return (
      <EmptyState
        className="border-dashed p-6"
        icon={<BlockGlyph kind="text" className="size-5" />}
        title="Aucun bloc sélectionné"
        hint="Sélectionnez un bloc dans la page pour modifier son contenu, son lien et son style."
      />
    );
  }

  return (
    <section aria-labelledby="block-properties-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2
          id="block-properties-title"
          className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
        >
          Propriétés du bloc
        </h2>
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-muted-foreground">
            <BlockGlyph kind={block.kind} />
          </span>
          {blockLabel(block.kind)}
        </p>
      </div>

      {blockGroups(block.kind).map((group) => (
        <fieldset key={group} className="flex flex-col gap-3">
          <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {GROUP_TITLES[group]}
          </legend>
          {blockFieldsByGroup(block.kind, group).map((field) => (
            <FieldControl
              key={field.key}
              block={block}
              field={field}
              canEdit={canEdit}
              onPatch={(key, value) => onPatch(block.id, key, value)}
            />
          ))}
        </fieldset>
      ))}

      {block.kind === "columns" ? (
        <ColumnsFields
          items={block.children}
          canEdit={canEdit}
          onPatch={onPatch}
          onMoveChild={onMoveChild}
          onAddChild={onAddChild}
          onRemoveChild={onRemoveChild}
        />
      ) : null}
    </section>
  );
}

/** Contrôle d'une propriété, choisi par son type déclaratif. */
function FieldControl({
  block,
  field,
  canEdit,
  onPatch,
}: {
  block: SiteBlock;
  field: BlockField;
  canEdit: boolean;
  onPatch: (key: string, value: SiteBlockValue) => void;
}) {
  const id = `block-${block.id}-${field.key}`;
  const value = readValue(block, field.key);
  const invalidUrl =
    field.type === "link" ? value.trim().length > 0 && !isUsable(field, value) : false;

  return (
    <div className="flex flex-col gap-1.5">
      {field.type === "toggle" ? (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={value === "true"}
            disabled={!canEdit}
            onChange={(event) => onPatch(field.key, event.currentTarget.checked)}
            className="size-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Label htmlFor={id}>{field.label}</Label>
        </div>
      ) : field.type === "select" ? (
        <>
          <Label htmlFor={id}>{field.label}</Label>
          <select
            id={id}
            value={value}
            disabled={!canEdit}
            onChange={(event) => onPatch(field.key, event.currentTarget.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <Label htmlFor={id}>{field.label}</Label>
          {field.type === "text" && field.multiline ? (
            <textarea
              id={id}
              value={value}
              disabled={!canEdit}
              onChange={(event) => onPatch(field.key, event.currentTarget.value)}
              maxLength={field.maxLength}
              placeholder={field.placeholder}
              rows={4}
              className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm leading-relaxed text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          ) : (
            <Input
              id={id}
              value={value}
              disabled={!canEdit}
              onChange={(event) => onPatch(field.key, event.currentTarget.value)}
              maxLength={field.type === "link" ? field.maxLength : undefined}
              placeholder={field.type === "link" ? field.placeholder : undefined}
              aria-invalid={invalidUrl || undefined}
              type="text"
              inputMode={field.type === "link" ? "url" : undefined}
            />
          )}
        </>
      )}

      {invalidUrl ? (
        <p role="alert" className="text-xs text-attention">
          {field.type === "link" && field.target === "image"
            ? "URL d'image non prise en charge : utilisez http(s) ou un chemin interne."
            : "Lien non pris en charge : utilisez http(s), mailto ou un chemin interne (/ ou #)."}
        </p>
      ) : field.help ? (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      ) : null}
    </div>
  );
}

/** Contenu d'un bloc « colonnes » : ses blocs enfants, éditables un par un. */
function ColumnsFields({
  items,
  canEdit,
  onPatch,
  onMoveChild,
  onAddChild,
  onRemoveChild,
}: {
  /** Blocs de la colonne, dans l'ordre. */
  items: readonly SiteInlineBlock[];
  canEdit: boolean;
  onPatch: (blockId: string, key: string, value: SiteBlockValue) => void;
  /** Déplace un bloc à l'intérieur de la colonne. */
  onMoveChild: (id: string, direction: "up" | "down") => void;
  onAddChild: (kind: "heading" | "text") => void;
  onRemoveChild: (id: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Colonnes
      </legend>
      {items.map((child, index) => (
        <div key={child.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`block-${child.id}-text`}>Colonne {index + 1}</Label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Monter la colonne ${index + 1}`}
                title={`Monter la colonne ${index + 1}`}
                disabled={!canEdit || index === 0}
                onClick={() => onMoveChild(child.id, "up")}
                className="size-7 justify-center p-0 text-muted-foreground"
              >
                <IconChevronDown className="rotate-180" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Descendre la colonne ${index + 1}`}
                title={`Descendre la colonne ${index + 1}`}
                disabled={!canEdit || index === items.length - 1}
                onClick={() => onMoveChild(child.id, "down")}
                className="size-7 justify-center p-0 text-muted-foreground"
              >
                <IconChevronDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Retirer la colonne ${index + 1}`}
                title={`Retirer la colonne ${index + 1}`}
                disabled={!canEdit}
                onClick={() => onRemoveChild(child.id)}
                className="size-7 justify-center p-0 text-muted-foreground hover:text-destructive"
              >
                <IconTrash />
              </Button>
            </div>
          </div>
          <textarea
            id={`block-${child.id}-text`}
            value={child.text}
            disabled={!canEdit}
            onChange={(event) => onPatch(child.id, "text", event.currentTarget.value)}
            maxLength={child.kind === "heading" ? BLOCKS_LIMITS.heading : BLOCKS_LIMITS.text}
            rows={2}
            className="min-h-16 w-full rounded-md border border-input bg-background p-3 text-sm leading-relaxed text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canEdit || items.length >= BLOCKS_LIMITS.children}
          onClick={() => onAddChild("heading")}
        >
          ＋ Titre
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canEdit || items.length >= BLOCKS_LIMITS.children}
          onClick={() => onAddChild("text")}
        >
          ＋ Texte
        </Button>
      </div>
    </fieldset>
  );
}

/** L'URL saisie est-elle acceptée au rendu ? */
function isUsable(field: BlockField, value: string): boolean {
  if (field.type !== "link") return true;
  return field.target === "image" ? safeImageUrl(value) !== null : safeUrl(value) !== null;
}

/**
 * Lit une propriété d'un bloc sous forme de chaîne : la forme concrète
 * (chaîne, nombre ou booléen) dépend du type de bloc, les contrôles, eux,
 * manipulent toujours des chaînes.
 */
function readValue(block: SiteBlock, key: string): string {
  const record = block as unknown as Record<string, unknown>;
  const value = record[key];
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}
