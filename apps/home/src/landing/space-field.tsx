import { cn } from "@workspace/ui";
import { useEffect, useRef } from "react";

/*
 * Champ spatial — l'arrière-plan animé des scènes « Captures ».
 *
 * Un canvas unique trace deux couches :
 * - un ruban discret de lignes teal qui ondule (courant d'énergie) ;
 * - une pluie d'étoiles en profondeur : chaque étoile file vers le caméraman,
 *   grandit et s'efface — la scène donne la sensation d'avancer dans l'espace.
 *
 * Le masque (posé par l'appelant) rend le centre transparent : les étoiles et
 * le ruban ne vivent qu'autour de la fenêtre produit.
 *
 * Coût maîtrisé : une seule boucle `requestAnimationFrame`, mise en pause dès
 * que la scène quitte l'écran (IntersectionObserver), et une image figée quand
 * l'utilisateur demande moins d'animations.
 */

/** Densité du ruban et de la pluie d'étoiles. */
const LINE_COUNT = 56;
const X_STEP = 14;
const STAR_COUNT = 150;

type Star = { x: number; y: number; z: number; teal: boolean; phase: number };

export function SpaceField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    // Couleur héritée du jeton de la page (`text-primary`), composée en alpha.
    const rgb =
      getComputedStyle(canvas).color.match(/\d+/g)?.slice(0, 3).join(", ") ?? "45, 212, 168";

    // Étoiles réparties dans un cube -1..1 (x, y) × 0..1 (profondeur, 1 = loin).
    const stars: Star[] = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      z: Math.random() * 0.94 + 0.06,
      teal: Math.random() < 0.2,
      phase: Math.random() * Math.PI * 2,
    }));

    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const dt = last ? Math.min(0.05, (time - last) / 1000) : 0.016;
      last = time;
      const t = time / 1000;
      context.clearRect(0, 0, width, height);

      // 1) Le ruban : courant d'énergie, volontairement discret.
      const spread = height * 0.34;
      const spacing = spread / (LINE_COUNT - 1);
      context.lineWidth = 1;
      for (let line = 0; line < LINE_COUNT; line += 1) {
        const base = height * 0.52 + (line - (LINE_COUNT - 1) / 2) * spacing;
        const phase = line * 0.045;
        const alpha = 0.03 + 0.13 * (0.5 + 0.5 * Math.sin(line * 0.35 + t * 0.7));
        context.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
        context.beginPath();
        for (let x = 0; x <= width + X_STEP; x += X_STEP) {
          const p = x / Math.max(1, width);
          const y =
            base +
            Math.sin(p * Math.PI * 2.1 + t * 0.5 + phase) * height * 0.13 +
            Math.sin(p * Math.PI * 4.6 - t * 0.32 + phase * 2) * height * 0.035;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }

      // 2) Les étoiles : projection perspective, elles filent vers le caméraman.
      const cx = width / 2;
      const cy = height / 2;
      const focal = Math.min(width, height) * 0.9;
      for (const star of stars) {
        if (motion.matches) {
          star.z -= dt * 0.16;
          if (star.z <= 0.06) {
            // Repartie au fond, dans une nouvelle direction.
            star.x = Math.random() * 2 - 1;
            star.y = Math.random() * 2 - 1;
            star.z = 1;
            star.phase = Math.random() * Math.PI * 2;
          }
        }
        const px = cx + (star.x * focal) / star.z;
        const py = cy + (star.y * focal) / star.z;
        if (px < -8 || px > width + 8 || py < -8 || py > height + 8) continue;

        const size = 0.4 + (1 - star.z) * 2;
        const twinkle = 0.7 + 0.3 * Math.sin(t * 2.2 + star.phase);
        const alpha = Math.min(0.9, (0.08 + (1 - star.z) * 0.75) * twinkle);
        context.fillStyle = star.teal
          ? `rgba(${rgb}, ${alpha.toFixed(3)})`
          : `rgba(233, 245, 241, ${alpha.toFixed(3)})`;
        context.beginPath();
        context.arc(px, py, size, 0, Math.PI * 2);
        context.fill();
      }
    };

    const loop = (time: number) => {
      draw(time);
      frame = requestAnimationFrame(loop);
    };

    const start = () => {
      if (frame) return;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    resize();
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting) {
        // Mouvement autorisé : le champ avance ; sinon, une image figée.
        if (motion.matches) start();
        else draw(0);
      } else {
        stop();
      }
    });
    observer.observe(canvas);

    const onResize = () => {
      resize();
      if (!motion.matches) draw(0);
      else if (!frame) draw(performance.now());
    };
    window.addEventListener("resize", onResize);

    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none size-full text-primary", className)}
    />
  );
}
