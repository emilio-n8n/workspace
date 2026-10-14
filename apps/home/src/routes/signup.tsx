import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
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
import { type FormEvent, useRef, useState } from "react";
import {
  authErrorMessage,
  PASSWORD_MIN_LENGTH,
  validateEmail,
  validateName,
  validateNewPassword,
} from "../auth/validation.ts";
import { provisionWorkspaceFn } from "../server/context.ts";

export const Route = createFileRoute("/signup")({ component: SignupPage });

type FieldName = "name" | "email" | "password";

/** Ordre de parcours du formulaire : le premier champ en erreur reçoit le focus. */
const FIELD_ORDER: FieldName[] = ["name", "email", "password"];

function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  /** Un champ n'affiche son erreur qu'après avoir été quitt (ou à l'envoi). */
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldRefs = { name: nameRef, email: emailRef, password: passwordRef };

  /** Revalide un champ (validation en direct dès qu'il a été quitt une fois). */
  function checkField(field: FieldName, value: string): void {
    const message =
      field === "name"
        ? validateName(value)
        : field === "email"
          ? validateEmail(value)
          : validateNewPassword(value);
    setErrors((previous) => ({ ...previous, [field]: message }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors: Partial<Record<FieldName, string>> = {
      name: validateName(name),
      email: validateEmail(email),
      password: validateNewPassword(password),
    };
    setErrors(nextErrors);
    setTouched({ name: true, email: true, password: true });

    const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalid) {
      fieldRefs[firstInvalid].current?.focus();
      return;
    }

    setLoading(true);
    setFormError(null);

    const { error: signUpError } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    });

    if (signUpError) {
      setLoading(false);
      setFormError(authErrorMessage(signUpError.code, "Création de compte impossible. Réessayez."));
      return;
    }

    // Espace personnel créé côté serveur (mêmes services, autorisation incluse).
    // Un échec ici n'annule pas le compte : il faut le dire, avec la marche à suivre.
    try {
      await provisionWorkspaceFn();
    } catch {
      setLoading(false);
      setFormError(
        "Votre compte est créé, mais votre espace personnel n'a pas pu l'être. Reconnectez-vous pour continuer.",
      );
      return;
    }

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
                onChange={(event) => {
                  setName(event.target.value);
                  if (touched.name) checkField("name", event.target.value);
                }}
                onBlur={() => {
                  setTouched((previous) => ({ ...previous, name: true }));
                  checkField("name", name);
                }}
                aria-invalid={errors.name && touched.name ? true : undefined}
                aria-describedby={errors.name && touched.name ? "name-erreur" : undefined}
                placeholder="Camille Dupont"
              />
              {errors.name && touched.name ? (
                <p id="name-erreur" role="alert" className="text-sm text-destructive">
                  {errors.name}
                </p>
              ) : null}
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
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (touched.email) checkField("email", event.target.value);
                }}
                onBlur={() => {
                  setTouched((previous) => ({ ...previous, email: true }));
                  checkField("email", email);
                }}
                aria-invalid={errors.email && touched.email ? true : undefined}
                aria-describedby={errors.email && touched.email ? "email-erreur" : undefined}
                placeholder="prenom@exemple.org"
              />
              {errors.email && touched.email ? (
                <p id="email-erreur" role="alert" className="text-sm text-destructive">
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (touched.password) checkField("password", event.target.value);
                  }}
                  onBlur={() => {
                    setTouched((previous) => ({ ...previous, password: true }));
                    checkField("password", password);
                  }}
                  aria-invalid={errors.password && touched.password ? true : undefined}
                  aria-describedby={
                    errors.password && touched.password ? "password-erreur" : "password-aide"
                  }
                  className="pr-20"
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  className="absolute right-1 top-1 h-7 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
                >
                  {passwordVisible ? "Masquer" : "Afficher"}
                </button>
              </div>
              {errors.password && touched.password ? (
                <p id="password-erreur" role="alert" className="text-sm text-destructive">
                  {errors.password}
                </p>
              ) : (
                // Rappel de la règle tant que rien n'est fautif.
                <p id="password-aide" className="text-xs text-muted-foreground">
                  {PASSWORD_MIN_LENGTH} caractères minimum. Le bouton « Afficher » permet de
                  vérifier votre saisie.
                </p>
              )}
            </div>

            {/* Une seule annonce d'erreur à la fois : les erreurs de champ
                n'apparaissent que pour une saisie réellement incorrecte. */}
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}

            <Button type="submit" loading={loading} className="w-full">
              {loading ? "Création…" : "Créer mon compte"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Déjà un compte ?{" "}
            <Link
              to="/login"
              className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Se connecter
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
