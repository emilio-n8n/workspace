import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import type { SuiteAppKey } from "@workspace/config";
import { type SearchResult, searchEverything } from "@workspace/search";
import {
  Alert,
  EmptyState,
  IconCalendar,
  IconCheckSquare,
  IconClipboard,
  IconFileText,
  IconSearch,
} from "@workspace/ui";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { SkeletonGroup, SkeletonRow } from "../../dashboard/skeleton.tsx";
import { getAppUrlsFn } from "../../server/context.ts";

/** Recherche serveur : composition des services de modules (jamais leurs tables). */
const searchFn = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z
      .object({
        query: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SearchResult[]> => {
    const { actor } = await requireActor(getRequest().headers);
    return searchEverything(actor, data);
  });

export const Route = createFileRoute("/app/recherche")({
  component: SearchPage,
  head: () => ({
    meta: [
      {
        title: "Recherche — Workspace",
      },
      {
        name: "description",
        content: "Recherche globale dans Workspace : fichiers, documents, formulaires, tâches et événements.",
      },
    ],
  }),
});

const KIND_ICONS: Record<SearchResult["kind"], typeof IconSearch> = {
  file: IconFileText,
  task: IconCheckSquare,
  form: IconClipboard,
  event: IconCalendar,
};

/** Cible de navigation inter-applications d'un résultat. */
function hrefFor(result: SearchResult, urls: Record<SuiteAppKey, string>): string {
  switch (result.appId) {
    case "drive":
      return urls.drive;
    case "forms":
      return `${urls.forms}/form/${result.id}`;
    case "tasks":
      return `${urls.tasks}/`;
    case "calendar":
      return urls.calendar;
  }
}

function ResultRow({
  result,
  urls,
}: {
  result: SearchResult;
  urls: Record<SuiteAppKey, string> | null;
}) {
  const Icon = KIND_ICONS[result.kind];
  const href = urls ? hrefFor(result, urls) : null;
  const className = "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted";
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{result.title}</span>
        <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span>
      </span>
    </>
  );

  if (!href) return <span className={className}>{body}</span>;
  return (
    <a href={href} className={className}>
      {body}
    </a>
  );
}

function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [urls, setUrls] = useState<Record<SuiteAppKey, string> | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        setUrls(await getAppUrlsFn());
      } catch {
        // Sans URLs inter-apps, les résultats restent affichés sans lien.
      }
    })();
  }, []);

  const trimmed = query.trim();

  // Saisie débattue : 250 ms après la dernière frappe, la plus récente gagne.
  useEffect(() => {
    const value = query.trim();
    const current = ++requestId.current;

    if (value.length < 2) {
      setResults(null);
      setLoading(false);
      setFailed(false);
      return;
    }

    setLoading(true);
    setFailed(false);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await searchFn({ data: { query: value } });
          if (requestId.current !== current) return;
          setResults(found);
        } catch {
          if (requestId.current !== current) return;
          setFailed(true);
        } finally {
          if (requestId.current === current) setLoading(false);
        }
      })();
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Recherche</h1>
        <p className="text-sm text-muted-foreground">
          Fichiers, tâches, formulaires et événements — dans toute la suite.
        </p>
      </header>

      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Rechercher dans toute la suite"
          placeholder="Rechercher dans toute la suite…"
          className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 text-base text-foreground shadow-soft transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        />
      </div>

      {trimmed.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Tapez au moins deux caractères pour lancer la recherche.
        </p>
      ) : failed ? (
        <Alert tone="danger" title="Recherche impossible">
          La recherche n'a pas abouti. Réessayez dans un instant.
        </Alert>
      ) : loading && results === null ? (
        // Squelettes à la hauteur des résultats : aucun saut de mise en page.
        <SkeletonGroup
          label="Recherche en cours…"
          className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card p-2"
        >
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} className="h-14" />
          ))}
        </SkeletonGroup>
      ) : results === null ? (
        <p role="status" className="text-sm text-muted-foreground" />
      ) : results.length === 0 ? (
        <EmptyState
          icon={<IconSearch />}
          title={`Aucun résultat pour « ${trimmed} »`}
          hint="Vérifiez l'orthographe, ou essayez un mot plus court ou plus général."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {results.map((result) => (
            <li key={`${result.kind}:${result.id}`}>
              <ResultRow result={result} urls={urls} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
