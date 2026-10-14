import {
  Badge,
  EmptyState,
  IconGraduation,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui";
import { averageTone, formatAverage, formatGradedCount, gradeMention } from "../grades.ts";
import type { ClassGrades, GradeSummary } from "../server.ts";

/** Teinte d'une moyenne, mappée sur les tokens sémantiques des pastilles. */
const TONE_VARIANT = {
  accent: "accent",
  attention: "default",
  neutral: "outline",
  danger: "destructive",
} as const;

/** Surcharge de variante pour la seule tonalité sans token dédié (ambre). */
const TONE_CLASS = {
  accent: "",
  attention: "bg-attention text-attention-foreground",
  neutral: "",
  danger: "",
} as const;

/**
 * Pastille de moyenne : la teinte suit le seuil (`averageTone`), le libellé
 * est fourni par l'appelant. La tonalité n'est dérivée qu'une fois.
 */
function AverageBadge({ average, children }: { average: number | null; children: string }) {
  const tone = averageTone(average);
  return (
    <Badge variant={TONE_VARIANT[tone]} className={TONE_CLASS[tone] || undefined}>
      {children}
    </Badge>
  );
}

/**
 * Panneau des notes d'un cours.
 *
 * Côté élève : sa moyenne, son nombre de devoirs corrigés, et la mention qui
 * va avec. Côté enseignant : la moyenne de la classe puis chaque élève, par
 * ordre alphabétique — un tableau, parce qu'un carnet de notes est un tableau.
 * La moyenne est toujours provisoire et le dit : elle ne compte que le travail
 * déjà corrigé.
 */
export function GradesPanel({
  myGrades,
  classGrades,
}: {
  /** Notes de l'élève connecté ; `null` pour un enseignant. */
  myGrades: GradeSummary | null;
  /** Carnet de la classe ; `null` pour un élève. */
  classGrades: ClassGrades | null;
}) {
  if (myGrades) {
    return (
      <section aria-labelledby="grades-title" className="flex flex-col gap-3">
        <h2 id="grades-title" className="font-display text-sm font-semibold">
          Mes notes
        </h2>
        {myGrades.total === 0 ? (
          <EmptyState
            icon={<IconGraduation />}
            title="Aucun devoir pour le moment"
            hint="Votre moyenne apparaîtra dès qu'un devoir aura été créé et corrigé."
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tabular-nums">
                {formatAverage(myGrades.average)}
              </span>
              <span className="text-sm text-muted-foreground">moyenne du cours</span>
            </p>
            <AverageBadge average={myGrades.average}>
              {gradeMention(myGrades.average) ?? "En attente"}
            </AverageBadge>
            {/* Une moyenne provisoire doit se dire : sinon elle se lit comme un verdict. */}
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {myGrades.graded === 0
                ? `Moyenne indisponible : aucun de vos ${myGrades.total} devoir${myGrades.total > 1 ? "s" : ""} n'est encore corrigé.`
                : `Moyenne provisoire sur ${formatGradedCount(myGrades)} — ${myGrades.earned} point${myGrades.earned > 1 ? "s" : ""} obtenu${myGrades.earned > 1 ? "s" : ""} sur ${myGrades.possible} possible${myGrades.possible > 1 ? "s" : ""}.`}
            </p>
          </div>
        )}
      </section>
    );
  }

  if (classGrades) {
    const { summary, students } = classGrades;
    return (
      <section aria-labelledby="grades-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="grades-title" className="font-display text-sm font-semibold">
            Notes de la classe
          </h2>
          <AverageBadge average={summary.average}>
            {`Moyenne ${formatAverage(summary.average)}`}
          </AverageBadge>
          <span className="text-xs text-muted-foreground">
            {formatGradedCount(summary)} · {students.length} élève{students.length > 1 ? "s" : ""}
          </span>
        </div>

        {summary.graded === 0 ? (
          <EmptyState
            icon={<IconGraduation />}
            title="Aucune copie corrigée"
            hint="Notez une copie pour voir apparaître la moyenne de la classe et celle de chaque élève."
          />
        ) : (
          <Table>
            <TableCaption>
              Moyenne de chaque élève, sur 20. Seuls les devoirs corrigés sont comptés ; un devoir
              non rendu n'est pas un zéro.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Élève</TableHead>
                <TableHead align="right">Moyenne</TableHead>
                <TableHead align="right">Points</TableHead>
                <TableHead align="right">Corrigés</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow key={student.studentId}>
                  <TableCell className="font-medium">{student.name}</TableCell>
                  <TableCell align="right" numeric>
                    {formatAverage(student.average)}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {student.earned}/{student.possible}
                  </TableCell>
                  <TableCell align="right" numeric>
                    {formatGradedCount(student)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    );
  }

  // Ni l'un ni l'autre : les notes ne sont pas encore chargées.
  return null;
}
