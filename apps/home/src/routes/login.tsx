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
import { authErrorMessage, validateEmail, validatePassword } from "../auth/validation.ts";

export const Route = createFileRoute("/login")({ component: LoginPage });

type FieldName = "email" | "password";

/** Ordre de parcours du formulaire : le premier champ en erreur reçoit le focus. */
const FIELD_ORDER: FieldName[] = ["email", "password"];

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  /** Un champ n'affiche son erreur qu'après avoir été quitt (ou à l'envoi). */
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldRefs = { email: emailRef, password: passwordRef };

  /** Revalide un champ (validation en direct dès qu'il a été quitt une fois). */
  function checkField(field: FieldName, value: string): void {
    const message = field === "email" ? validateEmail(value) : validatePassword(value);
    setErrors((previous) => ({ ...previous, [field]: message }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextErrors: Partial<Record<FieldName, string>> = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    setTouched({ email: true, password: true });

    const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalid) {
      fieldRefs[firstInvalid].current?.focus();
      return;
    }

    setLoading(true);
    setFormError(null);
    const { error: signInError } = await authClient.signIn.email({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signInError) {
      setFormError(
        authErrorMessage(signInError.code, "Connexion impossible. Vérifiez vos identifiants."),
      );
      return;
    }

    await router.invalidate();
    void router.navigate({ to: "/app" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Connexion à Workspace</CardTitle>
          <CardDescription>
            Accédez à vos documents, fichiers et espaces de travail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4" noValidate>
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
                  autoComplete="current-password"
                  required
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
                    errors.password && touched.password ? "password-erreur" : undefined
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
              ) : null}
            </div>

            {/* Une seule annonce d'erreur à la fois : les erreurs de champ
                n'apparaissent que pour une saisie réellement incorrecte. */}
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}

            <Button type="submit" loading={loading} className="w-full">
              {loading ? "Connexion…" : "Se connecter"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Pas encore de compte ?{" "}
            <Link
              to="/signup"
              className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Créer un compte
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
