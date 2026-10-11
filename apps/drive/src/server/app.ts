import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { createDocument } from "@workspace/docs";
import { z } from "zod";

/** Création d'un document depuis le Drive : service Docs direct, puis
 * l'application Docs prend le relais via son URL publique. */
export const createDocumentFromDriveFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        parentFolderId: z.string().uuid().nullable(),
        title: z.string().trim().min(1).max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const request = getRequest();
    const { actor } = await requireActor(request.headers);
    const { entry, document } = await createDocument(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, documentId: document.id };
  });
