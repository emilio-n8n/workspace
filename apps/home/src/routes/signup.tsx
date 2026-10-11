import { createFileRoute, useRouter } from "@tanstack/react-router";
import { authClient } from "@workspace/auth/client";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@workspace/ui";
import { type FormEvent, useState } from "react";
import { provisionWorkspaceFn } from "../server/context.ts";

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signUpError } = await authClient.signUp.email({ name, email, password });

    if (signUpError) {
      setLoading(false);
      setError(signUpError.message ?? "Création de compte impossible.");
      return;
    }

    // Espace personnel créé côté serveur (mêmes services, autorisation incluse).
    // Les erreurs d'exécution se propagent comme exceptions (aucun « error » en retour).
    await provisionWorkspaceFn();

    setLoading(false);

    await router.invalidate();
    void router.navigate({ to: "/app" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Créer un compte</CardTitle>
          <CardDescription>
            Votre espace personnel sera créé automatiquement. Vous pourrez ajouter des organisations
            d'équipe ensuite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Nom complet</Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Camille Dupont"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="prenom@exemple.org"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="10 caractères minimum"
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" loading={loading} className="w-full">
              {loading ? "Création…" : "Créer mon compte"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <a
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Se connecter
            </a>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
