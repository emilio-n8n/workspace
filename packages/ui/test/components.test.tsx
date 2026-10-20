import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../src/components/button.tsx";
import { ContextMenu } from "../src/components/context-menu.tsx";
import { CountBadge } from "../src/components/count-badge.tsx";

describe("Button", () => {
  it("désactive et annonce l'état occupé pendant le chargement", () => {
    const html = renderToStaticMarkup(<Button loading>Enregistrer</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain("animate-spin");
  });

  it("applique la variante et fusionne les classes de l'appelant", () => {
    const html = renderToStaticMarkup(
      <Button variant="ghost" size="sm" className="px-1">
        Ok
      </Button>,
    );
    expect(html).toContain("hover:bg-muted");
    expect(html).toContain("px-1");
    expect(html).not.toContain("px-3");
  });
});

describe("CountBadge", () => {
  it("plafonne l'affichage et garde le vrai total pour les lecteurs d'écran", () => {
    const html = renderToStaticMarkup(<CountBadge count={120} label="message" />);
    expect(html).toContain("99+");
    expect(html).toContain("120 messages");
  });
});

describe("ContextMenu", () => {
  const items = [
    { type: "item" as const, id: "copy", label: "Copier", shortcut: "Ctrl+C", onSelect: () => {} },
    { type: "separator" as const, id: "sep" },
    {
      type: "item" as const,
      id: "del",
      label: "Supprimer",
      destructive: true,
      disabled: true,
      onSelect: () => {},
    },
  ];

  it("ne rend rien fermé", () => {
    const html = renderToStaticMarkup(
      <ContextMenu open={false} x={0} y={0} label="Menu" items={items} onClose={() => {}} />,
    );
    expect(html).toBe("");
  });

  it("expose un menu nommé, ses raccourcis et ses entrées désactivées", () => {
    const html = renderToStaticMarkup(
      <ContextMenu open x={10} y={20} label="Menu du document" items={items} onClose={() => {}} />,
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Menu du document"');
    expect(html).toContain("Ctrl+C");
    expect(html).toContain("<hr");
    expect(html).toMatch(/role="menuitem" disabled=""/);
  });
});
