import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { createDocument } from "@workspace/docs";
import { createForm } from "@workspace/forms";
import { createSpreadsheet } from "@workspace/sheets";
import { createPresentation } from "@workspace/slides";
import { z } from "zod";

const createInput = z.object({
  parentFolderId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(255),
});

/**
 * Créations inter-applications depuis le Drive : le service du module crée le
 * fichier lié, puis l'application cible prend le relais via son URL publique.
 */
export const createDocumentFromDriveFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => createInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { actor } = await requireActor(request.headers);
    const { entry, document } = await createDocument(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, documentId: document.id };
  });

export const createSpreadsheetFromDriveFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => createInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { actor } = await requireActor(request.headers);
    const { entry, spreadsheet } = await createSpreadsheet(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, spreadsheetId: spreadsheet.id };
  });

export const createPresentationFromDriveFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => createInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { actor } = await requireActor(request.headers);
    const { entry, presentation } = await createPresentation(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, presentationId: presentation.id };
  });

export const createFormFromDriveFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => createInput.parse(input))
  .handler(async ({ data }) => {
    const request = getRequest();
    const { actor } = await requireActor(request.headers);
    const { entry, form } = await createForm(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, formId: form.id };
  });
