#!/usr/bin/env node
/**
 * Jeu de données de démonstration « Espace démo » — `pnpm seed:demo`.
 *
 * Rend la suite présentable en moins de 30 secondes (captures, démo Vercel,
 * accueil d'un nouveau collègue) : deux comptes, une organisation et du
 * contenu réaliste dans les principaux modules (Drive, Docs, Sheets, Slides,
 * Tâches, Agenda, Formulaires, Sites, Chat, Classroom, Mail).
 *
 * Usage :
 *   pnpm seed:demo                           # crée le contenu (idempotent)
 *   pnpm seed:demo --dry-run                 # valide les imports et le plan, sans écriture
 *   DEMO_SEED_ALLOW_REMOTE=1 pnpm seed:demo  # autorise explicitement une base non locale
 *
 * Choix d'implémentation :
 * - TypeScript exécuté par tsx (devDependency racine) ; les modules du
 *   workspace sont importés par chemin relatif car la racine ne les déclare
 *   pas (liaison pnpm stricte : aucune dépendance ajoutée aux modules).
 * - `MAIL_WEBHOOK_SECRET` est forcé sur « seed-demo » AVANT tout appel à
 *   `getServerEnv()` (cache paresseux de @workspace/config) : l'ingestion
 *   entrante de Mail se teste sans dépendre du secret réel de l'instance.
 * - Idempotence : si l'organisation « demo » existe, on s'arrête proprement.
 * - Échec partiel : les données créées sont supprimées (cascade depuis
 *   l'organisation) pour permettre une relance propre.
 */
import { randomUUID } from "node:crypto";
import { getServerEnv, loadDotEnv } from "@workspace/config";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import { eq, inArray } from "drizzle-orm";
import type { Actor } from "../packages/permissions/src/index.ts";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const DEMO_ORG_SLUG = "demo";
const DEMO_ORG_NAME = "Espace démo";
const DEMO_EMAIL = "demo@exemple.org";
const DEMO_NAME = "Camille Demo";
const COLLEAGUE_EMAIL = "demo2@exemple.org";
const COLLEAGUE_NAME = "Sacha Collègue";
const DEMO_PASSWORD = "demo-workspace-2026";
const SEED_MAIL_SECRET = "seed-demo";
const TEXT_MIME = "text/plain; charset=utf-8";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

// Fixé avant le premier getServerEnv() : la valeur est figée pour le processus.
process.env.MAIL_WEBHOOK_SECRET = SEED_MAIL_SECRET;

const argv = process.argv.slice(2);
const wantsHelp = argv.includes("--help") || argv.includes("-h");
const dryRun = argv.includes("--dry-run") || argv.includes("-n");
const unknownArgs = argv.filter((arg) => !["--help", "-h", "--dry-run", "-n"].includes(arg));

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

const must = <T,>(value: T | undefined | null, label: string): T => {
  if (value === undefined || value === null) {
    throw new Error(`Donnée de démo introuvable : ${label}.`);
  }
  return value;
};

const bytes = (body: string): Buffer => Buffer.from(body, "utf8");

/** Date locale de démo : `at(0, 9, 30)` = aujourd'hui 09:30. */
const at = (dayOffset: number, hour: number, minute = 0): Date => {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, hour, minute);
};

const iso = (dayOffset: number, hour: number, minute = 0): string =>
  at(dayOffset, hour, minute).toISOString();

/** Cible lisible sans jamais afficher les identifiants de connexion. */
const formatTarget = (target: URL): string =>
  `${target.hostname}:${target.port || "5432"}${target.pathname}`;

async function loadModules() {
  const [drive, docs, sheets, slides, tasks, calendar, forms, sites, chat, classroom, mail, auth] =
    await Promise.all([
      import("../modules/drive/src/index.ts"),
      import("../modules/docs/src/index.ts"),
      import("../modules/sheets/src/index.ts"),
      import("../modules/slides/src/index.ts"),
      import("../modules/tasks/src/index.ts"),
      import("../modules/calendar/src/index.ts"),
      import("../modules/forms/src/index.ts"),
      import("../modules/sites/src/index.ts"),
      import("../modules/chat/src/index.ts"),
      import("../modules/classroom/src/index.ts"),
      import("../modules/mail/src/index.ts"),
      import("../packages/auth/src/index.ts"),
    ]);
  return {
    drive,
    docs,
    sheets,
    slides,
    tasks,
    calendar,
    forms,
    sites,
    chat,
    classroom,
    mail,
    auth,
  };
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

function printHelp(): void {
  console.log(`pnpm seed:demo [options]

Remplit la base locale avec le jeu de données « Espace démo »
(organisation « demo », comptes demo@exemple.org et demo2@exemple.org).

Options :
  --dry-run, -n   valide les imports et affiche le plan, sans aucune écriture
  --help, -h      affiche cette aide

Variables :
  DATABASE_URL            connexion utilisée (défaut : .env à la racine)
  DEMO_SEED_ALLOW_REMOTE  =1 pour autoriser explicitement une base non locale`);
}

/** Refuse une base non locale sauf dérogation explicite. */
function assertSafeDatabase(databaseUrl: string): URL {
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL est invalide — vérifiez votre fichier .env (voir .env.example).");
  }
  if (!LOCAL_HOSTS.has(target.hostname) && process.env.DEMO_SEED_ALLOW_REMOTE !== "1") {
    throw new Error(
      `DATABASE_URL pointe vers « ${target.hostname} » (non local). ` +
        "Pour viser volontairement un environnement distant, exportez DEMO_SEED_ALLOW_REMOTE=1 — puis vérifiez deux fois la cible.",
    );
  }
  return target;
}

function printPlan(target: URL): void {
  const locality = LOCAL_HOSTS.has(target.hostname) ? "locale ✓" : "NON locale (dérogation active)";
  console.log(`
🧪 mode --dry-run : imports validés, aucune écriture en base.

Cible prévue : ${formatTarget(target)} (${locality})

Plan (organisation « ${DEMO_ORG_NAME} », slug « ${DEMO_ORG_SLUG} ») :
  Comptes     ${DEMO_EMAIL}, ${COLLEAGUE_EMAIL} (mot de passe : ${DEMO_PASSWORD})
  Drive       3 dossiers (Produits, Clients, RH) + 3 fichiers texte
  Docs        « Plan produit 2027 » (ProseMirror riche) + « Compte rendu — lancement »
  Sheets      « Budget 2027 » : onglets Budget et Hypothèses, ligne =SUM
  Slides      « Pitch investisseurs » : 3 diapositives (texte et formes)
  Tâches      listes « Lancement v1.0 » et « Personnel », statuts et priorités variés
  Agenda      agenda partagé « Équipe » : point d'équipe ×2, revue de lancement, déjeuner
  Formulaires « Satisfaction interne » : 3 questions + 3 réponses
  Sites       « Intranet » : pages Accueil et Guide de contribution
  Chat        canaux #général et #produit, quelques messages
  Classroom   cours « Onboarding » : 1 devoir, 1 copie notée 18/20
  Mail        3 messages reçus dans la boîte de ${DEMO_EMAIL}

✔ Import des modules vérifié — rien n'a été écrit.`);
}

// ---------------------------------------------------------------------------
// Comptes, organisation et nettoyage
// ---------------------------------------------------------------------------

async function ensureUser(modules: Modules, email: string, name: string): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: coreSchema.user.id })
    .from(coreSchema.user)
    .where(eq(coreSchema.user.email, email))
    .limit(1);
  if (existing) return existing.id;

  // Passage par better-auth : mot de passe haché selon sa politique, ligne
  // `account` créée comme à l'inscription (aucun bricolage SQL).
  const created = await modules.auth.auth.api.signUpEmail({
    body: { name, email, password: DEMO_PASSWORD },
  });
  return created.user.id;
}

async function cleanupDemo(): Promise<void> {
  const db = getDb();
  // L'organisation part en cascade (tout le contenu) ; les comptes ensuite.
  await db.delete(coreSchema.organization).where(eq(coreSchema.organization.slug, DEMO_ORG_SLUG));
  await db
    .delete(coreSchema.user)
    .where(inArray(coreSchema.user.email, [DEMO_EMAIL, COLLEAGUE_EMAIL]));
}

// ---------------------------------------------------------------------------
// Documents ProseMirror (Docs)
// ---------------------------------------------------------------------------

type PmNode = { type: string; attrs?: Record<string, unknown>; content?: PmNode[]; text?: string };
const tn = (text: string): PmNode => ({ type: "text", text });
const par = (...lines: string[]): PmNode => ({ type: "paragraph", content: lines.map(tn) });
const head = (level: number, text: string): PmNode => ({
  type: "heading",
  attrs: { level },
  content: [tn(text)],
});
const li = (text: string): PmNode => ({ type: "listItem", content: [par(text)] });
const list = (kind: "bulletList" | "orderedList", items: string[]): PmNode => ({
  type: kind,
  content: items.map(li),
});
const quote = (text: string): PmNode => ({ type: "blockquote", content: [par(text)] });
const code = (text: string): PmNode => ({
  type: "codeBlock",
  attrs: { language: "ts" },
  content: [tn(text)],
});
const doc = (...nodes: PmNode[]): PmNode => ({ type: "doc", content: nodes });

const PLAN_PRODUIT_2027 = doc(
  head(1, "Plan produit 2027"),
  par(
    "Notre cap : une suite qui s'ouvre en moins de deux secondes et qui ne perd jamais une idée.",
  ),
  head(2, "Priorités du semestre"),
  list("bulletList", [
    "Recherche unifiée entre les applications.",
    "Mode hors ligne sur Docs et Sheets.",
    "Invitations en un clic, sans compte à créer.",
  ]),
  quote("La simplicité est un choix par défaut, pas un effort supplémentaire."),
  head(2, "Extrait technique"),
  code("const demo = await seedDemo();\nconsole.log(demo.organisation); // « Espace démo »"),
);

const COMPTE_RENDU_LANCEMENT = doc(
  head(1, "Compte rendu — lancement"),
  par(
    "Douze personnes, quarante minutes, deux décisions. Merci à toutes et à tous pour la préparation.",
  ),
  list("orderedList", [
    "La bêta ouvre lundi à 9 h, sur invitation.",
    "Le formulaire de satisfaction part vendredi.",
    "Prochain point : mardi 14 h, salle Curie.",
  ]),
  quote("« On lance, on écoute, on corrige. Le reste suivra. » — Camille"),
);

// ---------------------------------------------------------------------------
// Diapositives (Slides)
// ---------------------------------------------------------------------------

type Element = {
  kind: "text" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
};
const el = (
  kind: Element["kind"],
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  fontSize = 24,
  bold = false,
  align: Element["align"] = "left",
): Element => ({ kind, x, y, w, h, text, fontSize, bold, align });

const PITCH_SLIDES = [
  {
    title: "Pitch investisseurs",
    notes: "Ouvrir sur le problème : trop d'outils, trop d'onglets.",
    elements: [
      el("shape", 0, 0, 100, 100, "", 12),
      el("text", 8, 30, 84, 18, "Workspace", 64, true, "center"),
      el("text", 8, 52, 84, 12, "La suite qui respecte votre attention", 24, false, "center"),
    ],
  },
  {
    title: "Le problème",
    notes: "Chiffres à sourcer avant la réunion.",
    elements: [
      el("text", 8, 12, 60, 12, "Le problème", 40, true),
      el(
        "text",
        8,
        30,
        70,
        40,
        "11 onglets ouverts.\n0 idée retrouvée.\nLes équipes perdent 6 h par semaine à chercher.",
        22,
      ),
    ],
  },
  {
    title: "La demande",
    notes: "Insister sur l'équipe et le rythme de livraison.",
    elements: [
      el("text", 8, 12, 84, 12, "2 M€ pour 18 mois", 44, true, "center"),
      el(
        "text",
        12,
        40,
        76,
        30,
        "Une équipe de 6 personnes, un produit qui s'améliore chaque semaine, des clients qui restent.",
        20,
        false,
        "center",
      ),
    ],
  },
];

// ---------------------------------------------------------------------------
// Pages (Sites)
// ---------------------------------------------------------------------------

const SITE_ACCUEIL = `# Bienvenue sur l'intranet

Ici, **tout ce qui compte** pour l'équipe : liens utiles, guides et nouvelles.

## Raccourcis

- Plan produit 2027 — dans Docs.
- Budget 2027 — dans Sheets, onglet Budget.
- Guide de contribution — la page juste à côté.

> Une idée vaut mieux écrite que mémorisée.

## Cette semaine

Le point d'équipe se tient chaque matin à 9 h 30. La revue de lancement est ouverte à toutes et à tous.`;

const SITE_GUIDE = `# Guide de contribution

Écrire une page de l'intranet prend cinq minutes.

## En trois étapes

1. Créez une page depuis l'espace « Intranet ».
2. Écrivez simplement : titres, listes, citations, \`code\`.
3. Enregistrez — c'est publié.

## Bonnes pratiques

- Une page, une idée.
- Des phrases courtes.
- Une décision, une date, un nom.

*Merci de relire avant de publier.*`;

// ---------------------------------------------------------------------------
// Contenu par module
// ---------------------------------------------------------------------------

async function seedContent(
  m: Modules,
  actor: Actor,
  colleague: Actor,
  colleagueId: string,
): Promise<void> {
  // --- Drive : dossiers + fichiers texte -----------------------------------
  const produits = await m.drive.createFolder(actor, { name: "Produits" });
  await m.drive.createFolder(actor, { name: "Clients" });
  await m.drive.createFolder(actor, { name: "RH" });
  await m.drive.uploadFile(actor, {
    parentId: produits.id,
    name: "roadmap-q4.txt",
    contentType: TEXT_MIME,
    body: bytes(
      "Roadmap Q4 — Produits\n\nOctobre  : recherche unifiée (bêta)\nNovembre : mode hors ligne\nDécembre : invitations en un clic\n\nLe reste attendra janvier.",
    ),
  });
  await m.drive.uploadFile(actor, {
    name: "notes-réunion.txt",
    contentType: TEXT_MIME,
    body: bytes(
      "Notes de la réunion du lundi\n\nPrésents : Camille, Sacha, l'équipe design.\n\n- La bêta ouvre lundi.\n- Relire le pitch avant jeudi.\n- Penser à remercier les testeurs.",
    ),
  });
  await m.drive.uploadFile(actor, {
    name: "politique-télétravail.txt",
    contentType: TEXT_MIME,
    body: bytes(
      "Politique de télétravail\n\nDeux jours par semaine, mardi et jeudi.\nLe reste du temps, on se retrouve au bureau — la machine à café compte aussi.",
    ),
  });
  console.log("  ✔ Drive : 3 dossiers, 3 fichiers");

  // --- Docs ----------------------------------------------------------------
  const plan = await m.docs.createDocument(actor, { title: "Plan produit 2027" });
  await m.docs.saveDocument(actor, plan.entry.id, { content: PLAN_PRODUIT_2027 });
  const compteRendu = await m.docs.createDocument(actor, { title: "Compte rendu — lancement" });
  await m.docs.saveDocument(actor, compteRendu.entry.id, { content: COMPTE_RENDU_LANCEMENT });
  console.log("  ✔ Docs : 2 documents (ProseMirror riche)");

  // --- Sheets : en-têtes, données, ligne =SUM, deuxième onglet -------------
  const budget = await m.sheets.createSpreadsheet(actor, { title: "Budget 2027" });
  const firstTab = must(
    (await m.sheets.getSpreadsheet(actor, budget.entry.id)).tabs[0],
    "onglet initial",
  );
  await m.sheets.renameTab(actor, firstTab.id, "Budget");
  const rowsToCells = (rows: string[][]) =>
    rows.flatMap((values, row) => values.map((value, col) => ({ row, col, value })));
  await m.sheets.saveCells(actor, budget.entry.id, {
    tabId: firstTab.id,
    updates: rowsToCells([
      ["Poste", "Budget", "Réalisé"],
      ["Produit", "420", "385"],
      ["Marketing", "210", "154"],
      ["Événements", "120", "96"],
      ["Outillage", "75", "81"],
      ["Total", "=SUM(B2:B5)", "=SUM(C2:C5)"],
    ]),
  });
  const hypotheses = must(
    (await m.sheets.addTab(actor, budget.entry.id, "Hypothèses")).find(
      (tab) => tab.name === "Hypothèses",
    ),
    "onglet « Hypothèses »",
  );
  await m.sheets.saveCells(actor, budget.entry.id, {
    tabId: hypotheses.id,
    updates: rowsToCells([
      ["Hypothèse", "Valeur"],
      ["Croissance", "12 %"],
      ["Devise", "k€ (milliers)"],
    ]),
  });
  console.log("  ✔ Sheets : « Budget 2027 », 2 onglets, ligne =SUM");

  // --- Slides ---------------------------------------------------------------
  const pitch = await m.slides.createPresentation(actor, { title: "Pitch investisseurs" });
  await m.slides.savePresentation(actor, pitch.entry.id, { revision: 1, slides: PITCH_SLIDES });
  console.log("  ✔ Slides : 3 diapositives");

  // --- Tâches : statuts, priorités, échéances et un assigné ----------------
  const lancement = await m.tasks.createList(actor, { name: "Lancement v1.0" });
  const personnel = await m.tasks.createList(actor, { name: "Personnel" });
  const taskSpecs: {
    listId: string;
    title: string;
    priority: "low" | "medium" | "high";
    dueAt?: string;
    status?: "in_progress" | "done";
    assigneeId?: string;
    notes?: string;
  }[] = [
    {
      listId: lancement.id,
      title: "Finaliser la page de connexion",
      priority: "high",
      dueAt: iso(2, 18),
      status: "in_progress",
    },
    {
      listId: lancement.id,
      title: "Relire le pitch investisseurs",
      priority: "medium",
      dueAt: iso(3, 12),
      assigneeId: colleagueId,
    },
    {
      listId: lancement.id,
      title: "Corriger le décalage horaire du calendrier",
      notes: "Reproduit sur les navigateurs en UTC+1.",
      priority: "high",
      dueAt: iso(5, 17),
    },
    { listId: lancement.id, title: "Préparer la démo client", priority: "medium", status: "done" },
    {
      listId: personnel.id,
      title: "Réserver la salle pour la revue",
      priority: "low",
      dueAt: iso(2, 9),
    },
    {
      listId: personnel.id,
      title: "Mettre à jour le trombinoscope",
      priority: "low",
      status: "done",
    },
  ];
  for (const { status, dueAt, ...spec } of taskSpecs) {
    const task = await m.tasks.createTask(actor, { ...spec, dueAt: dueAt ?? null });
    if (status) await m.tasks.updateTask(actor, task.id, { status });
  }
  console.log("  ✔ Tâches : 2 listes, 6 tâches");

  // --- Agenda : agenda partagé + 4 événements cette semaine ----------------
  const equipe = await m.calendar.createCalendar(actor, { name: "Équipe", shared: true });
  const primary = await m.calendar.ensurePrimaryCalendar(actor);
  const standup = {
    calendarId: equipe.id,
    title: "Point d'équipe",
    description: "Stand-up de 15 minutes, café en main.",
    attendees: [COLLEAGUE_EMAIL],
  };
  const events = [
    { ...standup, startsAt: iso(0, 9, 30), endsAt: iso(0, 9, 45) },
    { ...standup, startsAt: iso(1, 9, 30), endsAt: iso(1, 9, 45) },
    {
      calendarId: equipe.id,
      title: "Revue de lancement",
      description: "Passer en revue les retours de la bêta et décider du calendrier public.",
      location: "Salle Curie",
      attendees: [COLLEAGUE_EMAIL],
      startsAt: iso(2, 14),
      endsAt: iso(2, 15, 30),
    },
    {
      calendarId: primary,
      title: "Déjeuner équipe",
      location: "Cantine, table 4",
      startsAt: iso(3, 12, 30),
      endsAt: iso(3, 13, 30),
    },
  ];
  for (const event of events) await m.calendar.createEvent(actor, event);
  console.log("  ✔ Agenda : agenda partagé « Équipe », 4 événements cette semaine");

  // --- Formulaire + 3 réponses ---------------------------------------------
  const formEntry = await m.forms.createForm(actor, { title: "Satisfaction interne" });
  const form = await m.forms.saveForm(actor, formEntry.entry.id, {
    description: "Trois questions, deux minutes — merci !",
    status: "open",
    questions: [
      { kind: "scale", label: "Recommanderiez-vous la suite à un collègue ?", required: true },
      {
        kind: "choice",
        label: "Quel module utilisez-vous le plus ?",
        required: true,
        options: ["Drive", "Docs", "Tâches", "Chat"],
      },
      { kind: "long_text", label: "Une idée pour améliorer votre quotidien ?" },
    ],
  });
  const [q1, q2, q3] = form.questions.map((question) => question.id);
  const answers = [
    {
      [must(q1, "question 1")]: "5",
      [must(q2, "question 2")]: "Docs",
      [must(q3, "question 3")]: "Un bouton « partager » sur chaque page.",
    },
    {
      [must(q1, "question 1")]: "4",
      [must(q2, "question 2")]: "Drive",
      [must(q3, "question 3")]: "Prévisualiser les fichiers sans les ouvrir.",
    },
    {
      [must(q1, "question 1")]: "5",
      [must(q2, "question 2")]: "Chat",
      [must(q3, "question 3")]: "Rien de plus : c'est déjà bien rangé !",
    },
  ];
  for (const response of answers) {
    await m.forms.submitResponse(form.slug, response);
  }
  console.log("  ✔ Formulaires : 3 questions, 3 réponses");

  // --- Site : accueil + guide ----------------------------------------------
  const site = await m.sites.createSite(actor, { title: "Intranet" });
  const accueil = must(
    (await m.sites.getSite(actor, site.entry.id)).pages.find((page) => page.slug === "accueil"),
    "page « Accueil »",
  );
  await m.sites.savePage(actor, site.entry.id, accueil.id, {
    title: "Accueil",
    content: SITE_ACCUEIL,
  });
  const guide = await m.sites.addPage(actor, site.entry.id, { title: "Guide de contribution" });
  await m.sites.savePage(actor, site.entry.id, guide.pageId, {
    title: "Guide de contribution",
    content: SITE_GUIDE,
  });
  console.log("  ✔ Sites : « Intranet », 2 pages");

  // --- Chat : deux canaux, quelques messages -------------------------------
  const general = await m.chat.createChannel(actor, "général");
  for (const body of [
    "Bonjour à toutes et à tous 👋 — la démo de vendredi tient toujours ?",
    "Oui ! Je prépare les captures ce matin, elles seront sur l'intranet.",
    "Parfait. Pensez à relire le plan produit 2027 avant la revue.",
  ]) {
    await m.chat.sendMessage(actor, general.id, body);
  }
  const produit = await m.chat.createChannel(actor, "produit");
  for (const body of [
    "Le budget 2027 est dans Sheets — onglet Budget, ligne Total en formule.",
    "J'ai relu le pitch : il reste une coquille sur la dernière diapositive.",
    "Corrigé, merci ! Le canevas est prêt pour vendredi.",
  ]) {
    await m.chat.sendMessage(actor, produit.id, body);
  }
  console.log("  ✔ Chat : #général et #produit, 6 messages");

  // --- Classroom : cours, devoir, copie notée 18/20 ------------------------
  const course = await m.classroom.createCourse(actor, {
    name: "Onboarding",
    section: "Promo 2026",
  });
  const detail = await m.classroom.getCourse(actor, course.id);
  if (!detail.joinCode) throw new Error("Code d'accès du cours introuvable.");
  await m.classroom.joinByCode(colleague, detail.joinCode);
  const assignment = await m.classroom.createAssignment(actor, course.id, {
    title: "Rédiger sa présentation",
    instructions: "Qui êtes-vous, ce qui vous met en mouvement, et une chose que personne ne sait.",
    dueAt: iso(7, 18),
    points: 20,
  });
  await m.classroom.submitAssignment(
    colleague,
    assignment.id,
    "Bonjour ! Moi c'est Sacha. J'aime les interfaces calmes et les tableaux bien alignés. Personne ne sait que je collectionne les cartes postales de gares.",
  );
  const submission = must(
    (await m.classroom.listSubmissions(actor, assignment.id))[0],
    "copie de l'élève",
  );
  await m.classroom.gradeSubmission(actor, submission.id, {
    grade: 18,
    feedback: "Très clair et personnel — hâte de te voir en démo !",
  });
  console.log("  ✔ Classroom : cours « Onboarding », copie notée 18/20");

  // --- Mail : 3 messages entrants (webhook internalisé) ---------------------
  const mailbox = await m.mail.ensureMailbox(actor);
  const messages = [
    {
      from: "claire@partenaire.fr",
      fromName: "Claire Fontaine",
      subject: "Retour sur votre démo",
      body: "Bonjour Camille,\n\nLa présentation d'hier était très claire. Peut-on en reparler la semaine prochaine ?\n\nClaire",
    },
    {
      from: "support@fournisseur.io",
      fromName: "Support Fournisseur",
      subject: "Votre facture de septembre est disponible",
      body: "Bonjour,\n\nVotre facture de septembre est disponible dans votre espace client. Aucune action n'est requise.\n\nBonne journée,",
    },
    {
      from: "sacha@exemple.org",
      fromName: "Sacha Collègue",
      subject: "Notes pour la revue de lancement",
      body: "Salut !\n\nJ'ai regroupé les retours de la bêta dans un fichier Drive : « notes-réunion.txt ».\n\nÀ mardi !",
    },
  ];
  for (const [index, message] of messages.entries()) {
    await m.mail.createInboundMessage(
      { to: mailbox.address, ...message, externalId: `seed-demo-${index + 1}` },
      SEED_MAIL_SECRET,
    );
  }
  console.log(`  ✔ Mail : 3 messages reçus (${mailbox.address})`);
}

// ---------------------------------------------------------------------------
// Déroulé principal
// ---------------------------------------------------------------------------

async function seed(modules: Modules, target: URL): Promise<void> {
  const started = Date.now();
  const db = getDb();
  const { member, organization } = coreSchema;

  console.log(`\n▶ Cible : ${formatTarget(target)}`);

  const [existingOrg] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, DEMO_ORG_SLUG))
    .limit(1);
  if (existingOrg) {
    console.log(
      "Déjà consolidé — rien à faire (supprimez l'organisation « demo » et ses deux comptes pour re-générer).",
    );
    return;
  }

  let partial = false;
  try {
    console.log("▶ Comptes et organisation…");
    partial = true; // toute écriture à partir d'ici est nettoyable en bloc
    const demoId = await ensureUser(modules, DEMO_EMAIL, DEMO_NAME);
    const colleagueId = await ensureUser(modules, COLLEAGUE_EMAIL, COLLEAGUE_NAME);

    const orgId = randomUUID();
    await db
      .insert(organization)
      .values({ id: orgId, name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG, createdAt: new Date() });
    await db.insert(member).values([
      {
        id: randomUUID(),
        organizationId: orgId,
        userId: demoId,
        role: "owner",
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        organizationId: orgId,
        userId: colleagueId,
        role: "member",
        createdAt: new Date(),
      },
    ]);

    console.log("▶ Contenu des modules…");
    await seedContent(
      modules,
      { userId: demoId, orgId },
      { userId: colleagueId, orgId },
      colleagueId,
    );

    const seconds = ((Date.now() - started) / 1000).toFixed(1).replace(".", ",");
    console.log(`
✦ Données de démonstration prêtes en ${seconds} s.

  Organisation  ${DEMO_ORG_NAME} (slug « ${DEMO_ORG_SLUG} »)
  Connexion     ${DEMO_EMAIL} / ${DEMO_PASSWORD}
  Collègue      ${COLLEAGUE_EMAIL} / ${DEMO_PASSWORD}

  Drive 3 dossiers, 3 fichiers · Docs 2 · Sheets 1 · Slides 1
  Tâches 2 listes · Agenda 4 événements · Formulaires 1 (+3 réponses)
  Sites 1 (+2 pages) · Chat 2 canaux · Classroom 1 cours (18/20) · Mail 3 messages

  Connectez-vous avec ${DEMO_EMAIL} / ${DEMO_PASSWORD},
  puis basculez sur l'organisation « ${DEMO_ORG_NAME} » si besoin.`);
  } catch (error) {
    if (partial) {
      console.error("→ Nettoyage des données de démo partielles…");
      await cleanupDemo().catch((cleanupError) => {
        console.error(
          `  (nettoyage incomplet : ${cleanupError instanceof Error ? cleanupError.message : cleanupError})`,
        );
      });
    }
    throw error;
  }
}

async function main(): Promise<void> {
  if (wantsHelp) {
    printHelp();
    return;
  }
  if (unknownArgs.length > 0) {
    throw new Error(`Argument inconnu : ${unknownArgs.join(", ")}. Essayez --help.`);
  }

  loadDotEnv(process.cwd());
  const env = getServerEnv();
  const target = assertSafeDatabase(env.DATABASE_URL);
  const modules = await loadModules();

  if (dryRun) {
    printPlan(target);
    return;
  }
  await seed(modules, target);
}

try {
  await main();
} catch (error) {
  console.error(
    `\n✖ Échec du seed de démonstration : ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error("  Vérifiez DATABASE_URL, les migrations (pnpm db:migrate) puis relancez.");
  process.exitCode = 1;
} finally {
  await closeDb().catch(() => undefined);
}
