import { Link, useRouter } from "@tanstack/react-router";
import { IconChevronDown, IconFolder, Menu, type MenuItem } from "@workspace/ui";
import { useCallback, useState } from "react";
import { type BreadcrumbItem, listDriveFn } from "../server.ts";
import {
  type Crumb,
  overflowLabel,
  ROOT_TRAIL_LABEL,
  SUBFOLDER_MENU_LABEL,
  trailLabel,
  trailParts,
} from "./breadcrumb.ts";

type Props = {
  /** Chemin du dossier courant, racine exclue, du plus haut au plus proche. */
  crumbs: BreadcrumbItem[];
};

/** État du menu des sous-dossiers du dossier courant. */
type SubfoldersState =
  | { status: "idle"; forId: string | null }
  | { status: "loading"; forId: string }
  | { status: "ready"; forId: string; folders: Crumb[] }
  | { status: "error"; forId: string };

/** Points de suspension du repli — géométrie des icônes de la suite. */
function EllipsisGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="currentColor"
      stroke="none"
      aria-hidden
    >
      <circle cx="3.5" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="12.5" cy="8" r="1.2" />
    </svg>
  );
}

/**
 * Fil d'Ariane cliquable.
 *
 * Chaque segment est un lien vers son dossier ; un chemin long est replié en
 * menu « … » dont les entrées mènent aux dossiers masqués ; le dossier courant
 * porte un menu listant ses sous-dossiers pour y descendre en un geste.
 * Le chemin complet est donné en nom accessible : un lecteur d'écran ne
 * « voit » pas le repli.
 */
export function Breadcrumbs({ crumbs }: Props) {
  const router = useRouter();
  const currentId = crumbs.length > 0 ? crumbs[crumbs.length - 1]?.id : undefined;
  const [subfolders, setSubfolders] = useState<SubfoldersState>({
    status: "idle",
    forId: null,
  });
  const [menuOpen, setMenuOpen] = useState(false);

  const parts = trailParts(crumbs);

  // Le dossier courant a changé ? La liste en main ne vaut plus rien. Plutôt
  // qu'un effet de remise à zéro, l'état retient le dossier qu'il décrit.
  const stale = subfolders.forId !== (currentId ?? null);

  const loadSubfolders = useCallback(async () => {
    if (!currentId) return;
    setSubfolders({ status: "loading", forId: currentId });
    try {
      const rows = await listDriveFn({ data: { parentId: currentId } });
      setSubfolders({
        status: "ready",
        forId: currentId,
        folders: rows.filter((row) => row.kind === "folder"),
      });
    } catch {
      setSubfolders({ status: "error", forId: currentId });
    }
  }, [currentId]);

  function subfolderItems(): MenuItem[] {
    // Une entrée désactivée n'a pas d'action, mais le type du primitif l'exige.
    const inert = (id: string, label: string): MenuItem => ({
      id,
      label,
      onSelect: () => undefined,
      disabled: true,
    });

    if (stale) return [inert("idle", "Chargement…")];
    if (subfolders.status === "loading") return [inert("loading", "Chargement…")];
    if (subfolders.status === "error") {
      return [
        inert("error", "Chargement impossible"),
        { id: "retry", label: "Réessayer", onSelect: () => void loadSubfolders() },
      ];
    }
    const folders = subfolders.status === "ready" ? subfolders.folders : [];
    if (folders.length === 0) return [inert("empty", "Aucun sous-dossier")];
    return folders.map((folder) => ({
      id: folder.id,
      label: folder.name,
      icon: <IconFolder />,
      onSelect: () => void router.navigate({ to: "/$entryId", params: { entryId: folder.id } }),
    }));
  }

  return (
    <nav
      aria-label={`Fil d'Ariane : ${trailLabel(crumbs)}`}
      className="flex min-w-0 flex-1 items-center"
    >
      <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
        <li className="flex min-w-0 items-center gap-1">
          <Link to="/" className="font-medium hover:underline">
            {ROOT_TRAIL_LABEL}
          </Link>
        </li>

        {parts.leading.map((crumb) => (
          <li key={crumb.id} className="flex min-w-0 items-center gap-1">
            <span className="text-muted-foreground" aria-hidden>
              /
            </span>
            <Link
              to="/$entryId"
              params={{ entryId: crumb.id }}
              className="truncate hover:underline"
            >
              {crumb.name}
            </Link>
          </li>
        ))}

        {parts.overflow.length > 0 ? (
          <li className="flex items-center gap-1">
            <span className="text-muted-foreground" aria-hidden>
              /
            </span>
            {/* Le primitif `Menu` de @workspace/ui, avec un déclencheur ramené
                à la taille d'un segment de fil (variantes descendantes). */}
            <Menu
              label={overflowLabel(parts.overflow.length)}
              align="start"
              triggerIcon={<EllipsisGlyph />}
              className="[&>button]:size-7 [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-0"
              items={parts.overflow.map((crumb) => ({
                id: crumb.id,
                label: crumb.name,
                icon: <IconFolder />,
                onSelect: () =>
                  void router.navigate({ to: "/$entryId", params: { entryId: crumb.id } }),
              }))}
            />
          </li>
        ) : null}

        {parts.trailing.map((crumb, index) => {
          const isLast = index === parts.trailing.length - 1;
          return (
            <li key={crumb.id} className="flex min-w-0 items-center gap-1">
              <span className="text-muted-foreground" aria-hidden>
                /
              </span>
              {isLast ? (
                <span className="flex min-w-0 items-center gap-0.5">
                  <span className="truncate font-medium" aria-current="page">
                    {crumb.name}
                  </span>
                  {currentId ? (
                    <Menu
                      label={SUBFOLDER_MENU_LABEL}
                      align="start"
                      open={menuOpen}
                      onOpenChange={(next) => {
                        setMenuOpen(next);
                        // Chargement paresseux : la liste n'est demandée qu'à
                        // la première ouverture du menu (ou après un changement
                        // de dossier).
                        if (next && (subfolders.status === "idle" || stale)) {
                          void loadSubfolders();
                        }
                      }}
                      triggerIcon={<IconChevronDown />}
                      className="[&>button]:size-7 [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-0"
                      items={subfolderItems()}
                    />
                  ) : null}
                </span>
              ) : (
                <Link
                  to="/$entryId"
                  params={{ entryId: crumb.id }}
                  className="truncate hover:underline"
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
