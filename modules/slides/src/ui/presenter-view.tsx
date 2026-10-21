import { Button, cn } from "@workspace/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorSlide } from "../editor-model.ts";
import type { SlideAspectId } from "../slide-aspect.ts";
import { slideNavigationTarget } from "../slide-navigation.ts";
import { formatElapsed, presenterNote } from "../slide-notes.ts";
import {
  AUDIENCE_WINDOW_FEATURES,
  AUDIENCE_WINDOW_NAME,
  clockLabel,
  elapsedMs,
  nextSlideIndex,
  nextSlideLabel,
  type PresenterTimer,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer,
} from "../slide-presenter.ts";
import type { SlideThemeId } from "../slide-theme.ts";
import { SlideCanvas } from "./slide-canvas.tsx";

/**
 * Ouvre (ou réutilise) la fenêtre public et y recopie les feuilles de style :
 * la diapositive y est rendue par un portail React, donc pilotée en direct
 * depuis la console. À appeler dans le geste utilisateur (bloqueur de
 * fenêtres). `null` si le navigateur refuse la fenêtre.
 */
export function openAudienceWindow(title: string): Window | null {
  const popup = window.open("", AUDIENCE_WINDOW_NAME, AUDIENCE_WINDOW_FEATURES);
  if (!popup) return null;
  const doc = popup.document;
  doc.title = `${title} — Diaporama`;
  doc.documentElement.className = document.documentElement.className;
  doc.head.innerHTML = "";
  const base = doc.createElement("base");
  base.href = window.location.origin;
  doc.head.appendChild(base);
  for (const node of Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))) {
    doc.head.appendChild(node.cloneNode(true));
  }
  doc.body.className = "m-0 flex h-screen items-center justify-center overflow-hidden bg-black";
  doc.body.innerHTML = "";
  return popup;
}

type Props = {
  slides: EditorSlide[];
  index: number;
  onIndexChange: (index: number) => void;
  fileId: string;
  aspect: SlideAspectId;
  theme: SlideThemeId;
  title: string;
  audience: Window | null;
  onAudienceChange: (popup: Window | null) => void;
  onExit: () => void;
};

/**
 * Mode présentateur : diapositive en cours, suivante, notes en grand,
 * minuteur (pause, remise à zéro), heure, navigation clavier (flèches,
 * Page préc./suiv., Début, Fin), Échap pour quitter. La fenêtre public
 * (2e écran) affiche la diapositive seule et suit la console.
 */
export function PresenterView({
  slides,
  index,
  onIndexChange,
  fileId,
  aspect,
  theme,
  title,
  audience,
  onAudienceChange,
  onExit,
}: Props) {
  const [timer, setTimer] = useState<PresenterTimer>(() => startTimer(Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [notesSize, setNotesSize] = useState(18);
  const indexRef = useRef(index);
  indexRef.current = index;
  const rootRef = useRef<HTMLDivElement>(null);

  // Le focus dans la console : les raccourcis de l'éditeur (déplacer un
  // élément aux flèches…) ignorent les touches tapées dans un dialogue.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  // Clavier : dans la console comme dans la fenêtre public.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onExit();
        return;
      }
      const next = slideNavigationTarget({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        count: slides.length,
        current: indexRef.current,
      });
      if (next === null) return;
      event.preventDefault();
      onIndexChange(next);
    };
    window.addEventListener("keydown", onKeyDown);
    audience?.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      audience?.removeEventListener("keydown", onKeyDown);
    };
  }, [audience, onExit, onIndexChange, slides.length]);

  // Fenêtre public fermée par l'utilisateur : la console le sait.
  useEffect(() => {
    if (!audience) return;
    const id = window.setInterval(() => {
      if (audience.closed) onAudienceChange(null);
    }, 800);
    return () => window.clearInterval(id);
  }, [audience, onAudienceChange]);

  const slide = slides[index];
  const nextIndex = nextSlideIndex(index, slides.length);
  const next = nextIndex === null ? null : slides[nextIndex];
  const note = presenterNote(slide?.notes);
  const paused = timer.runningSince === null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Mode présentateur"
      className="fixed inset-0 z-50 flex flex-col bg-rail text-rail-foreground outline-none"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-rail-active px-4 py-2 text-sm">
        <span className="font-medium">Mode présentateur</span>
        <span className="tabular-nums" aria-live="polite">
          Diapositive {index + 1} / {slides.length}
        </span>
        <span className="ml-4 inline-flex items-center gap-1">
          <span
            className="min-w-16 text-center font-display text-xl tabular-nums"
            role="timer"
            aria-label="Temps écoulé"
          >
            {formatElapsed(elapsedMs(timer, now) / 1000)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
            onClick={() =>
              setTimer((current) =>
                current.runningSince === null
                  ? resumeTimer(current, Date.now())
                  : pauseTimer(current, Date.now()),
              )
            }
          >
            {paused ? "Reprendre" : "Pause"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
            onClick={() => setTimer((current) => resetTimer(current, Date.now()))}
          >
            Remettre à zéro
          </Button>
        </span>
        <span className="tabular-nums text-rail-foreground/70">
          <span className="sr-only">Heure : </span>
          {clockLabel(new Date(now))}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-rail-active bg-transparent text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
            onClick={() => {
              if (audience && !audience.closed) {
                audience.focus();
                return;
              }
              onAudienceChange(openAudienceWindow(title));
            }}
          >
            {audience ? "Fenêtre public ouverte" : "Ouvrir la fenêtre public"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onExit}>
            Terminer le diaporama
          </Button>
        </span>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 p-4">
        <section aria-label="Diapositive en cours" className="flex min-h-0 flex-col justify-center">
          {slide ? (
            <SlideCanvas slide={slide} fileId={fileId} aspect={aspect} theme={theme} />
          ) : null}
        </section>
        <div className="flex min-h-0 flex-col gap-3">
          <section aria-label="Diapositive suivante" className="flex flex-col gap-1">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-rail-foreground/70">
              {nextSlideLabel(index, slides.length)}
            </h2>
            {next ? (
              <div className="w-full max-w-md opacity-90">
                <SlideCanvas slide={next} fileId={fileId} aspect={aspect} theme={theme} />
              </div>
            ) : (
              <p className="rounded-lg border border-rail-active p-6 text-center text-sm text-rail-foreground/70">
                Dernière diapositive.
              </p>
            )}
          </section>
          <section
            aria-label="Notes du présentateur"
            className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-rail-active bg-rail-active/60 p-3"
          >
            <div className="flex items-center gap-1">
              <h2 className="mr-auto text-xs font-semibold uppercase tracking-widest text-rail-foreground/70">
                Notes
              </h2>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Réduire le texte des notes"
                className="text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
                onClick={() => setNotesSize((size) => Math.max(12, size - 2))}
              >
                A-
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Agrandir le texte des notes"
                className="text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
                onClick={() => setNotesSize((size) => Math.min(40, size + 2))}
              >
                A+
              </Button>
            </div>
            <p
              className={cn(
                "min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap leading-relaxed",
                note.empty && "italic text-rail-foreground/70",
              )}
              style={{ fontSize: notesSize }}
            >
              {note.text}
            </p>
          </section>
        </div>
      </div>
      <footer className="flex justify-center gap-2 pb-4">
        <Button
          variant="outline"
          className="border-rail-active bg-transparent text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
          aria-label="Diapositive précédente"
          disabled={index === 0}
          onClick={() => onIndexChange(Math.max(0, index - 1))}
        >
          Précédente
        </Button>
        <Button
          variant="outline"
          className="border-rail-active bg-transparent text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
          aria-label="Diapositive suivante"
          disabled={nextIndex === null}
          onClick={() => onIndexChange(Math.min(slides.length - 1, index + 1))}
        >
          Suivante
        </Button>
      </footer>
      {audience && !audience.closed && slide
        ? createPortal(
            <div className="w-full" style={{ maxWidth: "177.78vh" }} data-audience-slide="">
              <SlideCanvas slide={slide} fileId={fileId} aspect={aspect} theme={theme} />
            </div>,
            audience.document.body,
          )
        : null}
    </div>
  );
}
