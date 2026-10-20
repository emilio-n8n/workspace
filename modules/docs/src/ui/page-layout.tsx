import { Button, Dialog, Label, Menu, type MenuItem } from "@workspace/ui";
import { useEffect, useState } from "react";
import {
  MARGIN_PRESETS,
  marginPresetOf,
  PAPER_SIZES,
  type PageMargins,
  type PageSetup,
  type PaperSizeId,
  PX_PER_MM,
  pageSizeMm,
  rulerTicks,
} from "../page-setup.ts";

/** Classe commune des champs du dialogue (mêmes jetons que `Input`). */
const FIELD_CLASS =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type PageSetupDialogProps = {
  open: boolean;
  value: PageSetup;
  onClose: () => void;
  onApply: (setup: PageSetup) => void;
};

/** Champ de marge en centimètres (la valeur stockée reste en millimètres). */
function MarginField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (mm: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        step={0.1}
        min={0}
        max={8}
        value={Math.round(value) / 10}
        onChange={(event) => {
          const cm = Number(event.target.value.replace(",", "."));
          if (Number.isFinite(cm)) onChange(Math.round(cm * 100) / 10);
        }}
        className={FIELD_CLASS}
      />
    </div>
  );
}

/**
 * Fichier › Mise en page : format, orientation et marges (cm), comme la boîte
 * « Mise en page » de Word. Appliquer pose l'attribut sur le document (une
 * seule étape d'annulation).
 */
export function PageSetupDialog({ open, value, onClose, onApply }: PageSetupDialogProps) {
  const [draft, setDraft] = useState<PageSetup>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const setMargin = (side: keyof PageMargins) => (mm: number) =>
    setDraft((current) => ({ ...current, margins: { ...current.margins, [side]: mm } }));

  return (
    <Dialog open={open} onClose={onClose} title="Mise en page">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="page-size">Format du papier</Label>
            <select
              id="page-size"
              value={draft.size}
              onChange={(event) =>
                setDraft((current) => ({ ...current, size: event.target.value as PaperSizeId }))
              }
              className={FIELD_CLASS}
            >
              {PAPER_SIZES.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Orientation</legend>
            <div className="flex gap-3 text-sm">
              {(
                [
                  ["portrait", "Portrait"],
                  ["landscape", "Paysage"],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="page-orientation"
                    checked={draft.orientation === id}
                    onChange={() => setDraft((current) => ({ ...current, orientation: id }))}
                    className="accent-[var(--primary)]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="page-margin-preset">Marges</Label>
          <select
            id="page-margin-preset"
            value={marginPresetOf(draft.margins) ?? "custom"}
            onChange={(event) => {
              const preset = MARGIN_PRESETS.find((option) => option.id === event.target.value);
              if (preset) setDraft((current) => ({ ...current, margins: preset.margins }));
            }}
            className={FIELD_CLASS}
          >
            {MARGIN_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            <option value="custom" disabled>
              Personnalisées
            </option>
          </select>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <MarginField
            id="margin-top"
            label="Haut (cm)"
            value={draft.margins.top}
            onChange={setMargin("top")}
          />
          <MarginField
            id="margin-bottom"
            label="Bas (cm)"
            value={draft.margins.bottom}
            onChange={setMargin("bottom")}
          />
          <MarginField
            id="margin-left"
            label="Gauche (cm)"
            value={draft.margins.left}
            onChange={setMargin("left")}
          />
          <MarginField
            id="margin-right"
            label="Droite (cm)"
            value={draft.margins.right}
            onChange={setMargin("right")}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Appliquer
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Règle horizontale au-dessus de la page : graduations en centimètres depuis
 * la marge gauche, zones de marge grisées. Information visuelle (hors arbre
 * d'accessibilité) ; les marges se règlent dans « Mise en page ».
 */
export function DocRuler({ setup, scale }: { setup: PageSetup; scale: number }) {
  const { width } = pageSizeMm(setup);
  const px = (mm: number) => mm * PX_PER_MM * scale;
  return (
    <div
      aria-hidden
      data-doc-ruler
      className="relative mx-auto h-5 shrink-0 select-none overflow-hidden rounded-sm border border-border bg-card text-[9px] text-muted-foreground"
      style={{ width: px(width) }}
    >
      <div
        className="absolute inset-y-0 left-0 bg-muted"
        style={{ width: px(setup.margins.left) }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-muted"
        style={{ width: px(setup.margins.right) }}
      />
      {rulerTicks(setup).map((tick) => (
        <span
          key={tick.mm}
          className="absolute bottom-0 w-px bg-muted-foreground/50"
          style={{ left: px(tick.mm), height: tick.major ? 6 : 3 }}
        >
          {tick.label ? (
            <span className="absolute bottom-1.5 -translate-x-1/2 tabular-nums">{tick.label}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export type DocMenu = { id: string; label: string; items: MenuItem[] };

/**
 * Barre de menus du document (Fichier, Édition, Affichage, Insertion, Format,
 * Outils) — chaque menu est un `Menu` du design system, donc entièrement
 * maniable au clavier ; ←/→ passent d'un menu à l'autre.
 */
export function DocMenuBar({ menus }: { menus: DocMenu[] }) {
  return (
    <nav
      aria-label="Menus du document"
      className="print-hide flex items-center gap-0.5"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const target = event.target as HTMLElement;
        if (target.getAttribute("aria-haspopup") !== "menu") return;
        const triggers = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button[aria-haspopup='menu']"),
        );
        const index = triggers.indexOf(target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        triggers[(index + step + triggers.length) % triggers.length]?.focus();
      }}
    >
      {menus.map((menu) => (
        <Menu
          key={menu.id}
          label={menu.label}
          align="start"
          items={menu.items}
          triggerClassName="h-7 border-transparent bg-transparent px-2 text-[13px] font-normal hover:bg-muted focus-visible:ring-offset-0"
          className="[&_[role=menu]]:max-h-[70vh] [&_[role=menu]]:min-w-64 [&_[role=menu]]:overflow-y-auto"
        />
      ))}
    </nav>
  );
}
