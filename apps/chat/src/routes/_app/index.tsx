import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@workspace/chat/ui";

export const Route = createFileRoute("/_app/")({ component: ChatPage });

function ChatPage() {
  return <ChatView />;
}
