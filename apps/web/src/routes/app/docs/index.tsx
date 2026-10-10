import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@workspace/ui";
import { type FormEvent, useEffect, useState } from "react";
import { IconFileText } from "../../../components/icons";
import { createDocumentFn, listDocumentsFn } from "../../../server/docs";

export const Route = createFileRoute("/app/docs/")({ component: DocsIndexPage });

type DocItem = { id: string; name: string; updatedAt: string };

function DocsIndexPage() {
  const router = useRouter();
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (title.length === 0) return;

    setCreating(true);
    setError(null);
    try {
      const created = await createDocumentFn({ data: { parentFolderId: null, title } });
      void router.navigate({ to: "/app/docs/$fileId", params: { fileId: created.fileId } });
    } catch {
      setError("Création impossible : un document portant ce titre existe peut-être déjà.");
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IconFileText /> Documents
        </h1>
        <p className="text-sm text-muted-foreground">
          Les documents vivent dans votre Drive : mêmes dossiers, mêmes partages, mêmes permissions.
          Créez-en un ici ou depuis « Nouveau » dans le Drive.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nouveau document</CardTitle>
          <CardDescription>Le titre deviendra le nom du fichier dans le Drive.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} method="post" className="flex max-w-xl items-end gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor="doc-title" className="text-sm font-medium">
                Titre
              </label>
              <Input
                id="doc-title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Compte rendu de réunion"
                maxLength={255}
              />
            </div>
            <Button type="submit" loading={creating} disabled={newTitle.trim().length === 0}>
              Créer
            </Button>
          </form>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vos documents</CardTitle>
          <CardDescription>
            Pour retrouver les documents rangés dans des dossiers, passez par le Drive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentsList />
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentsList() {
  const [items, setItems] = useState<DocItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const docs = await listDocumentsFn({ data: { parentFolderId: null } });
      if (!cancelled) setItems(docs);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (items === null) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Aucun document à la racine pour le moment.</p>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 py-2">
          <IconFileText />
          <Link
            to="/app/docs/$fileId"
            params={{ fileId: item.id }}
            className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
          >
            {item.name}
          </Link>
          <span className="text-xs text-muted-foreground">
            {new Date(item.updatedAt).toLocaleString("fr-FR", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
