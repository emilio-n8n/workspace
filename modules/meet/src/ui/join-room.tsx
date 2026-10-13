import { Alert } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOBBY_POLL_MS } from "../lobby.ts";
import {
  loadMediaPreferences,
  type MediaPreferences,
  type MediaPreferencesStorage,
  saveMediaPreferences,
} from "../media-preferences.ts";
import {
  getRoomFn,
  getRoomTokenFn,
  type LobbyStatusView,
  lobbyRequestFn,
  lobbyStatusFn,
  lobbyWithdrawFn,
  type RoomToken,
  type RoomView,
} from "../server.ts";
import { MeetingRoom } from "./meeting-room.tsx";
import { PreJoinScreen } from "./pre-join.tsx";

type Phase = "loading" | "ready" | "connecting" | "connected" | "error";

/** Rappel de la configuration média (ADR-0011) quand aucun serveur n'est fourni. */
const MEDIA_NOTE =
  "La salle et son lien fonctionnent, mais l'audio et la vidéo nécessitent un serveur LiveKit. Renseignez LIVEKIT_URL, LIVEKIT_API_KEY et LIVEKIT_API_SECRET pour activer la visioconférence (voir docs/modules/meet.md et ADR-0011).";

function browserStorage(): MediaPreferencesStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Salle de réunion : écran préparatoire (périphériques), salle d'attente avec
 * admission, puis connexion LiveKit si le serveur média est configuré
 * (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) — sinon la page explique
 * la configuration requise (ADR-0011).
 */
export function JoinRoom({ slug }: { slug: string }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [lobby, setLobby] = useState<LobbyStatusView | null>(null);
  const [token, setToken] = useState<RoomToken | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<MediaPreferences>(() =>
    loadMediaPreferences(browserStorage()),
  );

  const storage = useRef<MediaPreferencesStorage | null>(null);
  if (storage.current === null) storage.current = browserStorage();

  const refreshStatus = useCallback(async (): Promise<LobbyStatusView> => {
    const status = await lobbyStatusFn({ data: { slug } });
    setLobby(status);
    return status;
  }, [slug]);

  useEffect(() => {
    void (async () => {
      try {
        const [roomInfo, status] = await Promise.all([
          getRoomFn({ data: { slug } }),
          lobbyStatusFn({ data: { slug } }),
        ]);
        setRoom(roomInfo);
        setLobby(status);
        if (status.state === "admitted") {
          setToken(await getRoomTokenFn({ data: { slug } }));
        }
        setPhase("ready");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Salle introuvable.");
        setPhase("error");
      }
    })();
  }, [slug]);

  // Tant qu'une demande d'entrée est en attente, on interroge le statut : dès
  // que l'organisateur admet, la connexion devient possible.
  useEffect(() => {
    if (phase !== "ready" || lobby?.state !== "waiting") return;
    let active = true;
    const poll = async () => {
      try {
        const status = await lobbyStatusFn({ data: { slug } });
        if (!active) return;
        setLobby(status);
        if (status.state === "admitted") {
          setToken(await getRoomTokenFn({ data: { slug } }));
        }
      } catch {
        // Statut momentanément indisponible : on attend le prochain passage.
      }
    };
    const timer = setInterval(() => void poll(), LOBBY_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [phase, lobby?.state, slug]);

  const persist = useCallback((next: MediaPreferences) => {
    setPreferences(next);
    saveMediaPreferences(storage.current, next);
  }, []);

  const join = useCallback(async () => {
    setPhase("connecting");
    setError(null);
    setNotice(null);
    try {
      const next = token ?? (await getRoomTokenFn({ data: { slug } }));
      setToken(next);
      if (next.configured) {
        setPhase("connected");
      } else {
        setPhase("ready");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connexion impossible.");
      setPhase("error");
    }
  }, [slug, token]);

  const requestEntry = useCallback(async () => {
    setError(null);
    try {
      await refreshStatus();
      const status = await lobbyRequestFn({ data: { slug } });
      setLobby(status);
      setNotice("Votre demande a été envoyée à l'organisateur.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Demande d'entrée impossible.");
    }
  }, [refreshStatus, slug]);

  const withdrawRequest = useCallback(async () => {
    setError(null);
    try {
      await lobbyWithdrawFn({ data: { slug } });
      await refreshStatus();
      setNotice("Votre demande a été annulée.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Annulation impossible.");
    }
  }, [refreshStatus, slug]);

  const leave = useCallback(() => {
    setNotice("Vous avez quitté la salle. Vous pouvez la rejoindre à nouveau.");
    setPhase("ready");
  }, []);

  if (phase === "loading" || (phase !== "error" && (!room || !lobby))) {
    return <p className="text-sm text-muted-foreground">Chargement de la salle…</p>;
  }

  if (phase === "error" || !room || !lobby) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <Alert tone="danger">{error ?? "Salle introuvable."}</Alert>
        <a href="/" className="text-sm font-medium text-primary hover:underline">
          ← Retour aux salles
        </a>
      </div>
    );
  }

  if (phase === "connected" && token?.configured) {
    return (
      <MeetingRoom
        room={room}
        token={token}
        preferences={preferences}
        onPreferencesChange={persist}
        onLeave={leave}
      />
    );
  }

  return (
    <PreJoinScreen
      roomName={room.name}
      slug={slug}
      lobby={lobby}
      mediaUnconfiguredNote={token && !token.configured ? MEDIA_NOTE : undefined}
      notice={notice}
      busy={phase === "connecting"}
      onJoin={() => void join()}
      onRequest={() => void requestEntry()}
      onWithdraw={() => void withdrawRequest()}
    />
  );
}
