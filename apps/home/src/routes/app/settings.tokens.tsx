import { createFileRoute } from "@tanstack/react-router";
import { WORKSPACE_SCOPES, type WorkspaceScope } from "@workspace/auth/client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  IconCopy,
  IconKey,
  IconTrash,
  Input,
  Label,
} from "@workspace/ui";
import { useCallback, useEffect, useState } from "react";
import { createTokenFn, listTokensFn, revokeTokenFn, type TokenView } from "../../server/tokens";

export const Route = createFileRoute("/app/settings/tokens")({
  component: TokensPage,
  head: () => ({
    meta: [
      {
        title: "Agents et jetons — Workspace",
      },
      {
        name: "description",
        content: "Gérez les jetons d'accès pour agents IA compatibles MCP : minimaux, scopés et révocables.",
      },
    ],
  }),
});

type CreatedToken = { id: string; token: string; prefix: string };

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function tokenStatus(token: TokenView): {
  label: string;
  variant: "outline" | "accent" | "default";
} {
  if (token.revokedAt) return { label: "Révoqué", variant: "default" };
  if (token.expiresAt && new Date(token.expiresAt) < new Date())
    return { label: "Expiré", variant: "default" };
  return { label: "Actif", variant: "accent" };
}

function TokensPage() {
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<WorkspaceScope>>(new Set(["drive:read"]));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<TokenView | null>(null);
  const [revoking, setRevoking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTokensFn();
      setTokens(list);
      setError(null);
    } catch {
      setError("Chargement des jetons impossible — rechargez la page.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggleScope(scope: WorkspaceScope) {
    setScopes((previous) => {
      const next = new Set(previous);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function onCreate() {
    setError(null);
    setCreating(true);
    try {
      const result = await createTokenFn({
        data: { name: name.trim(), scopes: [...scopes] },
      });
      setCreated(result);
      setCopied(false);
      setName("");
      await refresh();
    } catch {
      setError("Création impossible : vérifiez le nom et les scopes sélectionnés.");
    } finally {
      setCreating(false);
    }
  }

  async function onRevokeConfirm() {
    if (!revokeTarget) return;
    setRevoking(true);
    setError(null);
    try {
      await revokeTokenFn({ data: { id: revokeTarget.id } });
      setRevokeTarget(null);
      await refresh();
    } catch {
      setError("Révocation impossible — réessayez.");
    } finally {
      setRevoking(false);
    }
  }

  async function onCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IconKey /> Agents & jetons
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Créez des jetons à privilèges minimaux pour connecter des agents IA compatibles MCP ou des
          intégrations. Chaque jeton utilise exactement vos permissions, est révocable immédiatement
          et ses usages sont journalisés.
        </p>
      </header>

      {created ? (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base">
              Votre nouveau jeton — affiché une seule fois
            </CardTitle>
            <CardDescription>
              Copiez-le maintenant et conservez-le dans un coffre de secrets. Il ne pourra plus être
              affiché.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
              {created.token}
            </code>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onCopy}>
                <IconCopy /> {copied ? "Copié !" : "Copier"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Masquer
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Créer un jeton</CardTitle>
          <CardDescription>
            Nommez le jeton (ex. « Agent Claude — Drive lecture ») et cochez uniquement les scopes
            nécessaires.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="token-name">Nom</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Agent Drive — lecture"
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Scopes</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {WORKSPACE_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={scopes.has(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <code className="text-xs">{scope}</code>
                </label>
              ))}
            </div>
          </fieldset>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div>
            <Button
              onClick={onCreate}
              loading={creating}
              disabled={name.trim().length < 2 || scopes.size === 0}
            >
              Créer le jeton
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jetons existants</CardTitle>
          <CardDescription>
            La révocation est immédiate : l'agent perd l'accès à la requête suivante.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun jeton pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Nom</th>
                    <th className="py-2 pr-4 font-medium">Scopes</th>
                    <th className="py-2 pr-4 font-medium">Créé le</th>
                    <th className="py-2 pr-4 font-medium">Dernier usage</th>
                    <th className="py-2 pr-4 font-medium">Statut</th>
                    <th className="py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => {
                    const status = tokenStatus(token);
                    return (
                      <tr key={token.id} className="border-b border-border/60">
                        <td className="py-3 pr-4">
                          <p className="font-medium">{token.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{token.prefix}</p>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {token.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="outline"
                                className="font-mono text-[10px]"
                              >
                                {scope}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(token.createdAt)}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {formatDate(token.lastUsedAt)}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="py-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(token.revokedAt)}
                            onClick={() => setRevokeTarget(token)}
                            aria-label={`Révoquer ${token.name}`}
                          >
                            <IconTrash />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connecter un agent MCP</CardTitle>
          <CardDescription>
            Exemple de configuration (serveur local, transport stdio).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {`{
  "mcpServers": {
    "workspace": {
      "command": "pnpm",
      "args": ["--filter", "@workspace/mcp-server", "start"],
      "env": { "WORKSPACE_TOKEN": "wsk_…votre-jeton…" }
    }
  }
}`}
          </pre>
        </CardContent>
      </Card>

      <Dialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title={revokeTarget ? `Révoquer « ${revokeTarget.name} » ?` : "Révoquer le jeton"}
      >
        <p className="text-sm text-muted-foreground">
          Les agents qui utilisent ce jeton perdront immédiatement l'accès. Cette action est
          irréversible.
        </p>
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="ghost" onClick={() => setRevokeTarget(null)}>
            Annuler
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={revoking}
            onClick={() => void onRevokeConfirm()}
          >
            Révoquer
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
