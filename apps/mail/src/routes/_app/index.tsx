import { createFileRoute } from "@tanstack/react-router";
import { MailView } from "@workspace/mail/ui";

export const Route = createFileRoute("/_app/")({ component: MailPage });

function MailPage() {
  return <MailView />;
}
