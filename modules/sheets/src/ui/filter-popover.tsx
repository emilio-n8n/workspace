import { Button, Input } from "@workspace/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SortDirection } from "../sort.ts";
import type { ColumnFilter, FilterCondition } from "../tab-settings.ts";

type ConditionOp = FilterCondition["op"] | "none";

const CONDITIONS: { id: ConditionOp; label: string; needs: "text" | "number" | null }[] = [
  { id: "none", label: "Aucune condition", needs: null },
  { id: "contains", label: "Contient", needs: "text" },
  { id: "notContains", label: "Ne contient pas", needs: "text" },
  { id: "equals", label: "Est égal à", needs: "text" },
  { id: "notEquals", label: "Est différent de", needs: "text" },
  { id: "gt", label: "Supérieur à", needs: "number" },
  { id: "gte", label: "Supérieur ou égal à", needs: "number" },
  { id: "lt", label: "Inférieur à", needs: "number" },
  { id: "lte", label: "Inférieur ou égal à", needs: "number" },
  { id: "empty", label: "Est vide", needs: null },
  { id: "notEmpty", label: "N'est pas vide", needs: null },
];

export type FilterPopoverProps = {
  /** Lettre de la colonne (« B »), pour le nom accessible. */
  column: string;
  anchor: { left: number; top: number };
  values: string[];
  current: ColumnFilter | undefined;
  onApply: (criteria: ColumnFilter | null) => void;
  onSort: (direction: SortDirection) => void;
  onClose: () => void;
};

/**
 * Panneau du filtre automatique d'une colonne (bouton ▾ de l'en-tête) : tri,
 * liste des valeurs à cocher avec recherche, condition simple. Échap ou un
 * clic extérieur ferme sans appliquer.
 */
export function FilterPopover({
  column,
  anchor,
  values,
  current,
  onApply,
  onSort,
  onClose,
}: FilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set(current?.hidden ?? []));
  const [query, setQuery] = useState("");
  const [op, setOp] = useState<ConditionOp>(current?.condition?.op ?? "none");
  const [operand, setOperand] = useState(
    current?.condition && "value" in current.condition ? String(current.condition.value) : "",
  );
  const [position, setPosition] = useState(anchor);

  const shown = useMemo(
    () =>
      query.trim() === ""
        ? values
        : values.filter((value) =>
            value.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")),
          ),
    [query, values],
  );

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8)),
    });
  }, [anchor]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const needs = CONDITIONS.find((entry) => entry.id === op)?.needs ?? null;
  const numberValue = Number(operand.replace(",", "."));
  const conditionValid =
    needs === null ||
    (needs === "number"
      ? operand.trim() !== "" && Number.isFinite(numberValue)
      : operand.trim() !== "");

  function apply() {
    let condition: FilterCondition | undefined;
    if (op !== "none" && conditionValid) {
      if (op === "empty" || op === "notEmpty") condition = { op };
      else if (needs === "number") condition = { op: op as "gt", value: numberValue };
      else condition = { op: op as "contains", value: operand };
    }
    const criteria: ColumnFilter = {};
    if (hidden.size > 0) criteria.hidden = [...hidden];
    if (condition) criteria.condition = condition;
    onApply(criteria.hidden || criteria.condition ? criteria : null);
  }

  const allShown = shown.every((value) => !hidden.has(value));

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Filtre de la colonne ${column}`}
      className="fixed z-50 flex w-72 flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lift"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 justify-start"
          onClick={() => onSort("asc")}
        >
          Trier de A à Z
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 justify-start"
          onClick={() => onSort("desc")}
        >
          Trier de Z à A
        </Button>
      </div>
      <div className="h-px bg-border" />
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Condition
        <select
          aria-label="Condition"
          value={op}
          onChange={(event) => setOp(event.target.value as ConditionOp)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          {CONDITIONS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      {needs ? (
        <Input
          aria-label="Valeur de la condition"
          inputMode={needs === "number" ? "decimal" : undefined}
          value={operand}
          onChange={(event) => setOperand(event.target.value)}
          placeholder={needs === "number" ? "100" : "Texte"}
        />
      ) : null}
      <div className="h-px bg-border" />
      <Input
        aria-label="Rechercher une valeur"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher"
      />
      <ul
        aria-label="Valeurs"
        className="max-h-48 overflow-y-auto rounded-md border border-border p-1 text-sm"
      >
        <li>
          <label className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted">
            <input
              type="checkbox"
              checked={allShown}
              onChange={() =>
                setHidden((before) => {
                  const next = new Set(before);
                  for (const value of shown) {
                    if (allShown) next.add(value);
                    else next.delete(value);
                  }
                  return next;
                })
              }
            />
            <span className="font-medium">(Tout sélectionner)</span>
          </label>
        </li>
        {shown.map((value) => (
          <li key={value}>
            <label className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted">
              <input
                type="checkbox"
                checked={!hidden.has(value)}
                onChange={() =>
                  setHidden((before) => {
                    const next = new Set(before);
                    if (next.has(value)) next.delete(value);
                    else next.add(value);
                    return next;
                  })
                }
              />
              <span className="truncate">{value}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={() => onApply(null)}>
          Effacer le filtre
        </Button>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button size="sm" disabled={!conditionValid} onClick={apply}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
