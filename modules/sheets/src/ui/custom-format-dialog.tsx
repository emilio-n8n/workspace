import { Button, Dialog, Input, Label } from "@workspace/ui";
import { useEffect, useState } from "react";
import {
  CUSTOM_FORMAT_PRESETS,
  formatCustom,
  isValidCustomFormat,
  MAX_CUSTOM_FORMAT_LENGTH,
} from "../custom-format.ts";
import { parseCellNumber } from "../number-format.ts";

/**
 * Dialogue « Format personnalisé » : code Excel libre, exemples cliquables et
 * aperçu en direct sur la valeur de la cellule active (ou 1234,5).
 */
export function CustomFormatDialog({
  open,
  initial,
  sample,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: string;
  sample: string;
  onClose: () => void;
  onApply: (pattern: string | null) => void;
}) {
  const [pattern, setPattern] = useState(initial);
  useEffect(() => {
    if (open) setPattern(initial);
  }, [open, initial]);
  const value = parseCellNumber(sample) === null && sample.trim() === "" ? "1234.5" : sample;
  const valid = isValidCustomFormat(pattern);
  const preview = valid ? formatCustom(value, pattern, parseCellNumber(value)).text : "—";

  return (
    <Dialog open={open} onClose={onClose} title="Format personnalisé">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onApply(pattern);
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="custom-format">Code de format</Label>
          <Input
            id="custom-format"
            value={pattern}
            maxLength={MAX_CUSTOM_FORMAT_LENGTH}
            spellCheck={false}
            onChange={(event) => setPattern(event.target.value)}
            placeholder="# ##0,00 €"
            className="font-mono"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Aperçu : <output className="font-medium text-foreground tabular-nums">{preview}</output>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CUSTOM_FORMAT_PRESETS.map((preset) => (
            <button
              key={preset.pattern}
              type="button"
              onClick={() => setPattern(preset.pattern)}
              title={preset.pattern}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Sections « positif;négatif;zéro;texte », <code>0</code> et <code>#</code> pour les
          chiffres, <code>%</code>, <code>E+00</code>, <code>"texte"</code>, dates{" "}
          <code>jj/mm/aaaa</code>, couleurs <code>[Rouge]</code>.
        </p>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => onApply(null)}>
            Retirer le format
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={!valid}>
              Appliquer
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
