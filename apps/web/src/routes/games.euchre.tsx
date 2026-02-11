import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { GameCard, GameCardMedia } from "@/components/ui/game-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Suit = "clubs" | "diamonds" | "hearts" | "spades";
type Rank = "9" | "10" | "J" | "Q" | "K" | "A";

type SetupStep = "name" | "room" | "game";
type RoomMode = "create" | "join";

type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
};

type ListedRoom = {
  name: string;
  players: number;
  maxPlayers: number;
  botCount: number;
  botDifficulty: BotDifficulty;
  hasPassword: boolean;
  status: "waiting" | "playing";
  createdAt: number;
};

type BotDifficulty = "easy" | "medium" | "hard";

type PlayerSnapshot = {
  id: string;
  name: string;
  seatIndex: number;
  connected: boolean;
  isBot: boolean;
  handCount: number;
};

type HandSummary = {
  makerTeam: 0 | 1;
  makerTricks: number;
  defenderTricks: number;
  pointsAwarded: number;
  awardedTo: 0 | 1;
};

type GameSnapshot = {
  phase:
    | "bidding-round-1"
    | "bidding-round-2"
    | "dealer-discard"
    | "playing"
    | "hand-over"
    | "game-over";
  dealerSeat: number;
  turnSeat: number;
  upcard: Card | null;
  blockedSuit: Suit | null;
  trump: Suit | null;
  trickIndex: number;
  currentTrick: {
    playerId: string;
    playerName: string;
    seatIndex: number;
    card: Card;
  }[];
  completedTricks: {
    index: number;
    winnerSeat: number;
    cards: {
      playerId: string;
      card: Card;
    }[];
  }[];
  handSummary: HandSummary | null;
  makerTeam: 0 | 1 | null;
  calledByPlayerId: string | null;
  goingAlonePlayerId: string | null;
  sittingOutSeat: number | null;
  calledByName: string | null;
  handNumber: number;
};

type RoomState = {
  roomName: string;
  maxPlayers: number;
  status: "waiting" | "playing";
  botDifficulty: BotDifficulty;
  botCount: number;
  score: {
    team0: number;
    team1: number;
  };
  players: PlayerSnapshot[];
  you: {
    id: string;
    name: string;
    seatIndex: number;
    isCreator: boolean;
    creatorToken: string | null;
    hand: Card[];
  } | null;
  game: GameSnapshot | null;
  legalPlays: string[];
  targetScore: number;
};

type CapturedTrick = {
  handNumber: number;
  trickIndex: number;
  winnerSeat: number;
  winnerName: string;
  cards: {
    seatIndex: number;
    card: Card;
  }[];
};

type ServerMessage =
  | {
      type: "state";
      state: RoomState;
    }
  | {
      type: "info";
      message: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "pong";
    };

type EuchreSearch = {
  step: SetupStep;
  mode: RoomMode;
  name: string;
  room: string;
  password: string;
  autoJoin: boolean;
};

const SUIT_LABELS: Record<Suit, string> = {
  clubs: "Clubs",
  diamonds: "Diamonds",
  hearts: "Hearts",
  spades: "Spades",
};
const SUIT_SYMBOLS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

function readString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function parseStep(value: string): SetupStep {
  if (value === "room") {
    return "room";
  }
  if (value === "game") {
    return "game";
  }
  return "name";
}

function parseMode(value: string): RoomMode {
  if (value === "create") {
    return "create";
  }
  return "join";
}

function parseBoolean(value: string) {
  return value === "1" || value.toLowerCase() === "true";
}

function parseBotDifficulty(value: string): BotDifficulty {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }
  return "medium";
}

const CREATOR_ROOMS_STORAGE_KEY = "euchre-creator-room-tokens";

function getServerHttpOrigin() {
  const configured = import.meta.env.VITE_SERVER_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window === "undefined") {
    return "http://localhost:8787";
  }

  const { protocol, hostname, host } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:8787`;
  }

  return `${protocol}//${host}`;
}

function toWebSocketOrigin(httpOrigin: string) {
  if (httpOrigin.startsWith("https://")) {
    return `wss://${httpOrigin.slice("https://".length)}`;
  }
  if (httpOrigin.startsWith("http://")) {
    return `ws://${httpOrigin.slice("http://".length)}`;
  }
  return httpOrigin;
}

function suitColorClass(suit: Suit) {
  if (suit === "diamonds" || suit === "hearts") {
    return "text-rose-600";
  }
  return "text-slate-900";
}

function suitColorClassOnDark(suit: Suit) {
  if (suit === "diamonds" || suit === "hearts") {
    return "text-rose-300";
  }
  return "text-slate-100";
}

function sameColorSuit(suit: Suit): Suit {
  if (suit === "clubs") {
    return "spades";
  }
  if (suit === "spades") {
    return "clubs";
  }
  if (suit === "hearts") {
    return "diamonds";
  }
  return "hearts";
}

function isRightBower(card: Card, trump: Suit) {
  return card.rank === "J" && card.suit === trump;
}

function isLeftBower(card: Card, trump: Suit) {
  return card.rank === "J" && card.suit === sameColorSuit(trump);
}

function effectiveSuit(card: Card, trump: Suit): Suit {
  if (isLeftBower(card, trump)) {
    return trump;
  }
  return card.suit;
}

function getTrumpStrength(card: Card, trump: Suit) {
  if (isRightBower(card, trump)) {
    return 100;
  }
  if (isLeftBower(card, trump)) {
    return 99;
  }
  if (card.rank === "A") {
    return 98;
  }
  if (card.rank === "K") {
    return 97;
  }
  if (card.rank === "Q") {
    return 96;
  }
  if (card.rank === "10") {
    return 95;
  }
  return 94;
}

const NON_TRUMP_SUIT_ORDER: Record<Suit, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
};

const NON_TRUMP_RANK_ORDER: Record<Rank, number> = {
  A: 6,
  K: 5,
  Q: 4,
  J: 3,
  "10": 2,
  "9": 1,
};

function sortHand(cards: Card[], trump: Suit | null) {
  const hand = [...cards];

  if (!trump) {
    return hand.sort((left, right) => {
      const suitDiff =
        NON_TRUMP_SUIT_ORDER[left.suit] - NON_TRUMP_SUIT_ORDER[right.suit];
      if (suitDiff !== 0) {
        return suitDiff;
      }
      return NON_TRUMP_RANK_ORDER[right.rank] - NON_TRUMP_RANK_ORDER[left.rank];
    });
  }

  return hand.sort((left, right) => {
    const leftIsTrump = effectiveSuit(left, trump) === trump;
    const rightIsTrump = effectiveSuit(right, trump) === trump;

    if (leftIsTrump && rightIsTrump) {
      return getTrumpStrength(right, trump) - getTrumpStrength(left, trump);
    }
    if (leftIsTrump) {
      return -1;
    }
    if (rightIsTrump) {
      return 1;
    }

    const suitDiff =
      NON_TRUMP_SUIT_ORDER[left.suit] - NON_TRUMP_SUIT_ORDER[right.suit];
    if (suitDiff !== 0) {
      return suitDiff;
    }
    return NON_TRUMP_RANK_ORDER[right.rank] - NON_TRUMP_RANK_ORDER[left.rank];
  });
}

function TableCard({ card, size = "md" }: { card: Card; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-14 md:w-16" : "w-18 md:w-20";

  return (
    <div
      className={`${sizeClass} rounded-xl border border-slate-300 bg-white p-1 text-center shadow-xl`}
    >
      <p
        className={`text-xs leading-none font-semibold ${suitColorClass(card.suit)}`}
      >
        {card.rank} {SUIT_SYMBOLS[card.suit]}
      </p>
      <p className={`py-1 text-2xl leading-none ${suitColorClass(card.suit)}`}>
        {SUIT_SYMBOLS[card.suit]}
      </p>
      <p
        className={`text-xs leading-none font-semibold ${suitColorClass(card.suit)}`}
      >
        {card.rank} {SUIT_SYMBOLS[card.suit]}
      </p>
    </div>
  );
}

function getAbsoluteSeat(anchorSeat: number, relativeSeat: number) {
  return (anchorSeat + relativeSeat) % 4;
}

function seatPositionClass(relativeSeat: number) {
  if (relativeSeat === 0) {
    return "bottom-3 left-1/2 -translate-x-1/2";
  }
  if (relativeSeat === 1) {
    return "left-3 top-1/2 -translate-y-1/2";
  }
  if (relativeSeat === 2) {
    return "left-1/2 top-3 -translate-x-1/2";
  }
  return "right-3 top-1/2 -translate-y-1/2";
}

function trickCardPositionClass(relativeSeat: number) {
  if (relativeSeat === 0) {
    return "bottom-1 left-1/2 -translate-x-1/2";
  }
  if (relativeSeat === 1) {
    return "left-1 top-1/2 -translate-y-1/2";
  }
  if (relativeSeat === 2) {
    return "left-1/2 top-1 -translate-x-1/2";
  }
  return "right-1 top-1/2 -translate-y-1/2";
}

function trickCaptureTargetClass(relativeSeat: number) {
  if (relativeSeat === 0) {
    return "translate-y-16";
  }
  if (relativeSeat === 1) {
    return "-translate-x-18";
  }
  if (relativeSeat === 2) {
    return "-translate-y-16";
  }
  return "translate-x-18";
}

function EuchreRouteComponent() {
  const navigate = useNavigate({ from: "/games/euchre" });
  const search = Route.useSearch();
  const wsRef = useRef<WebSocket | null>(null);

  const [rooms, setRooms] = useState<ListedRoom[]>([]);
  const [roomListError, setRoomListError] = useState("");
  const [statusText, setStatusText] = useState(
    "Complete setup to connect to multiplayer Euchre."
  );
  const [connectionText, setConnectionText] = useState("Disconnected");
  const [state, setState] = useState<RoomState | null>(null);
  const [connectVersion, setConnectVersion] = useState(0);
  const [creatorRoomTokens, setCreatorRoomTokens] = useState<
    Record<string, string>
  >({});
  const [capturedTrick, setCapturedTrick] = useState<CapturedTrick | null>(
    null
  );
  const [capturedTrickMoving, setCapturedTrickMoving] = useState(false);
  const [capturedTrickShowWinner, setCapturedTrickShowWinner] = useState(false);
  const [upcardPickup, setUpcardPickup] = useState<{
    handNumber: number;
    dealerSeat: number;
    card: Card;
  } | null>(null);
  const [upcardPickupMoving, setUpcardPickupMoving] = useState(false);
  const [goAloneChoice, setGoAloneChoice] = useState(false);
  const capturedTrickKeyRef = useRef("");
  const upcardPickupKeyRef = useRef("");
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectStartedAtRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CREATOR_ROOMS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, string>;
      setCreatorRoomTokens(parsed);
    } catch {
      setCreatorRoomTokens({});
    }
  }, []);

  const persistCreatorTokens = useCallback((next: Record<string, string>) => {
    setCreatorRoomTokens(next);
    try {
      window.localStorage.setItem(CREATOR_ROOMS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const serverHttpOrigin = useMemo(() => getServerHttpOrigin(), []);
  const serverWsOrigin = useMemo(
    () => toWebSocketOrigin(serverHttpOrigin),
    [serverHttpOrigin]
  );

  const fetchRooms = useCallback(async () => {
    try {
      const response = await fetch(`${serverHttpOrigin}/rooms`);
      if (response.ok) {
        const data = (await response.json()) as { rooms: ListedRoom[] };
        setRooms(data.rooms);
        setRoomListError("");
      } else {
        setRoomListError(`Failed to load rooms (${response.status}).`);
      }
    } catch {
      setRoomListError("Unable to load room list.");
    }
  }, [serverHttpOrigin]);

  const refreshRooms = useCallback(async () => {
    try {
      await fetchRooms();
    } catch {
      // fetchRooms handles status updates.
    }
  }, [fetchRooms]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const resetReconnectState = useCallback(() => {
    clearReconnectTimer();
    reconnectStartedAtRef.current = null;
    reconnectAttemptRef.current = 0;
  }, [clearReconnectTimer]);

  const scheduleAutoReconnect = useCallback(() => {
    if (search.step !== "game") {
      return;
    }

    const now = Date.now();
    if (reconnectStartedAtRef.current === null) {
      reconnectStartedAtRef.current = now;
      reconnectAttemptRef.current = 0;
    }

    const elapsed = now - reconnectStartedAtRef.current;
    const maxWindowMs = 5 * 60 * 1000;
    if (elapsed >= maxWindowMs) {
      setStatusText(
        "Disconnected. Auto reconnect stopped after 5 minutes. Press Reconnect."
      );
      clearReconnectTimer();
      return;
    }

    reconnectAttemptRef.current += 1;
    const delaySeconds = reconnectAttemptRef.current * 5;
    if (elapsed + delaySeconds * 1000 > maxWindowMs) {
      setStatusText(
        "Disconnected. Auto reconnect stopped after 5 minutes. Press Reconnect."
      );
      clearReconnectTimer();
      return;
    }

    setStatusText(
      `Disconnected. Reconnecting in ${delaySeconds}s (attempt ${reconnectAttemptRef.current}).`
    );

    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(() => {
      setConnectionText("Connecting...");
      setConnectVersion((value) => value + 1);
    }, delaySeconds * 1000);
  }, [clearReconnectTimer, search.step]);

  const deleteRoom = useCallback(
    async (roomName: string) => {
      const creatorToken = creatorRoomTokens[roomName];
      if (!creatorToken) {
        setRoomListError("Missing creator token for this room.");
        return;
      }

      try {
        const response = await fetch(
          `${serverHttpOrigin}/rooms/${encodeURIComponent(roomName)}?creatorToken=${encodeURIComponent(creatorToken)}`,
          {
            method: "DELETE",
          }
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          setRoomListError(
            payload?.error ?? `Failed to delete room (${response.status}).`
          );
          return;
        }

        const next = { ...creatorRoomTokens };
        delete next[roomName];
        persistCreatorTokens(next);
        setRoomListError("");
        refreshRooms();
      } catch {
        setRoomListError("Unable to delete room.");
      }
    },
    [creatorRoomTokens, persistCreatorTokens, refreshRooms, serverHttpOrigin]
  );

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      ws.close(1000, "Client disconnected");
    }
    setConnectionText("Disconnected");
  }, [clearReconnectTimer]);

  const manualReconnect = useCallback(() => {
    resetReconnectState();
    setStatusText("Reconnecting...");
    setConnectionText("Connecting...");
    setConnectVersion((value) => value + 1);
  }, [resetReconnectState]);

  useEffect(() => {
    refreshRooms();
    const interval = window.setInterval(() => {
      refreshRooms();
    }, 4000);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshRooms]);

  const trimmedName = search.name.trim();
  const trimmedRoom = search.room.trim();
  const trimmedPassword = search.password.trim();
  const creatorTokenForCurrentRoom = creatorRoomTokens[trimmedRoom] ?? "";
  const createRoomNameTaken = useMemo(() => {
    if (search.mode !== "create" || trimmedRoom === "") {
      return false;
    }
    return rooms.some(
      (room) => room.name.toLowerCase() === trimmedRoom.toLowerCase()
    );
  }, [rooms, search.mode, trimmedRoom]);

  const shareRoomLink = useCallback(async () => {
    if (typeof window === "undefined" || trimmedRoom === "") {
      return;
    }

    const shareUrl = new URL(`${window.location.origin}/games/euchre`);
    shareUrl.searchParams.set("step", "name");
    shareUrl.searchParams.set("mode", "join");
    shareUrl.searchParams.set("room", trimmedRoom);
    shareUrl.searchParams.set("autoJoin", "1");
    if (trimmedPassword !== "") {
      shareUrl.searchParams.set("password", trimmedPassword);
    }

    const text = `Join my Euchre room: ${trimmedRoom}`;
    const urlString = shareUrl.toString();
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Euchre Room Invite",
          text,
          url: urlString,
        });
      } else {
        await navigator.clipboard.writeText(urlString);
      }
      setStatusText("Share link ready.");
    } catch {
      setStatusText("Unable to share room link.");
    }
  }, [trimmedPassword, trimmedRoom]);

  useEffect(() => {
    if (search.step === "game") {
      if (trimmedName === "" || trimmedRoom === "") {
        setStatusText("Name and room are required before entering game.");
        setConnectionText("Disconnected");
        return;
      }

      disconnect();
      setConnectionText("Connecting...");
      setState(null);

      const params = new URLSearchParams({
        room: trimmedRoom,
        name: trimmedName,
      });

      if (trimmedPassword !== "") {
        params.set("password", trimmedPassword);
      }

      if (creatorTokenForCurrentRoom) {
        params.set("creatorToken", creatorTokenForCurrentRoom);
      }

      if (search.mode === "create") {
        params.set("create", "1");
      }

      const ws = new WebSocket(
        `${serverWsOrigin}/websocket?${params.toString()}`
      );
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (wsRef.current !== ws) {
          return;
        }
        resetReconnectState();
        setConnectionText("Connected");
        setStatusText("Connected to room.");
        refreshRooms();
      });

      ws.addEventListener("close", () => {
        if (wsRef.current !== ws) {
          return;
        }
        wsRef.current = null;
        setConnectionText("Disconnected");
        scheduleAutoReconnect();
        refreshRooms();
      });

      ws.addEventListener("error", () => {
        if (wsRef.current !== ws) {
          return;
        }
        setConnectionText("Disconnected");
        setStatusText("Connection error.");
      });

      ws.addEventListener("message", (event) => {
        if (wsRef.current !== ws) {
          return;
        }
        try {
          const payload = JSON.parse(event.data as string) as ServerMessage;

          if (payload.type === "state") {
            setState(payload.state);
            if (
              payload.state.you?.isCreator &&
              payload.state.you.creatorToken &&
              payload.state.roomName
            ) {
              const token = payload.state.you.creatorToken;
              setCreatorRoomTokens((previous) => {
                if (previous[payload.state.roomName] === token) {
                  return previous;
                }
                const next = {
                  ...previous,
                  [payload.state.roomName]: token,
                };
                try {
                  window.localStorage.setItem(
                    CREATOR_ROOMS_STORAGE_KEY,
                    JSON.stringify(next)
                  );
                } catch {
                  // Ignore storage failures.
                }
                return next;
              });
            }
            return;
          }

          if (payload.type === "info") {
            setStatusText(payload.message);
            return;
          }

          if (payload.type === "error") {
            setStatusText(payload.message);
          }
        } catch {
          setStatusText("Received an unexpected server message.");
        }
      });

      return () => {
        ws.close(1000, "Leaving game screen");
      };
    }

    disconnect();
    resetReconnectState();
    setState(null);
  }, [
    clearReconnectTimer,
    disconnect,
    refreshRooms,
    connectVersion,
    resetReconnectState,
    scheduleAutoReconnect,
    search.mode,
    search.step,
    creatorTokenForCurrentRoom,
    serverWsOrigin,
    trimmedName,
    trimmedPassword,
    trimmedRoom,
  ]);

  useEffect(() => () => {
    disconnect();
    resetReconnectState();
  }, [disconnect, resetReconnectState]);

  useEffect(() => {
    if (!state?.game || !state.you) {
      setCapturedTrick(null);
      setCapturedTrickMoving(false);
      setCapturedTrickShowWinner(false);
      return;
    }

    if (
      state.game.phase !== "playing" &&
      state.game.phase !== "hand-over" &&
      state.game.phase !== "game-over"
    ) {
      setCapturedTrick(null);
      setCapturedTrickMoving(false);
      setCapturedTrickShowWinner(false);
      return;
    }

    const latest =
      state.game.completedTricks[state.game.completedTricks.length - 1];
    if (!latest) {
      setCapturedTrick(null);
      setCapturedTrickMoving(false);
      setCapturedTrickShowWinner(false);
      return;
    }

    const key = `${state.game.handNumber}-${latest.index}-${latest.winnerSeat}-${latest.cards
      .map((play) => play.card.id)
      .join("|")}`;
    if (capturedTrickKeyRef.current === key) {
      return;
    }
    capturedTrickKeyRef.current = key;

    const winnerName =
      state.players.find((player) => player.seatIndex === latest.winnerSeat)
        ?.name ?? "Unknown";

    const cards = latest.cards
      .map((play) => {
        const seatIndex =
          state.players.find((player) => player.id === play.playerId)?.seatIndex ??
          -1;
        return {
          seatIndex,
          card: play.card,
        };
      })
      .filter((play) => play.seatIndex >= 0);

    setCapturedTrick({
      handNumber: state.game.handNumber,
      trickIndex: latest.index,
      winnerSeat: latest.winnerSeat,
      winnerName,
      cards,
    });
    setCapturedTrickMoving(false);
    setCapturedTrickShowWinner(false);

    const startTimer = window.setTimeout(() => {
      setCapturedTrickMoving(true);
    }, 700);
    const showWinnerTimer = window.setTimeout(() => {
      setCapturedTrickShowWinner(true);
    }, 1050);
    const clearTimer = window.setTimeout(() => {
      setCapturedTrick(null);
      setCapturedTrickMoving(false);
      setCapturedTrickShowWinner(false);
    }, 2200);

    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(showWinnerTimer);
      window.clearTimeout(clearTimer);
    };
  }, [state]);

  useEffect(() => {
    const phase = state?.game?.phase;
    const mySeatIndex = state?.you?.seatIndex;
    const turnSeat = state?.game?.turnSeat;
    const inBidding =
      phase === "bidding-round-1" || phase === "bidding-round-2";
    const isMyBidTurn =
      mySeatIndex !== undefined && turnSeat !== undefined && mySeatIndex === turnSeat;
    if (!inBidding || !isMyBidTurn) {
      setGoAloneChoice(false);
    }
  }, [state]);

  useEffect(() => {
    if (!state?.game || !state.you) {
      setUpcardPickup(null);
      setUpcardPickupMoving(false);
      return;
    }

    const { game: currentGame } = state;
    if (
      currentGame.phase !== "dealer-discard" ||
      !currentGame.upcard ||
      !currentGame.calledByPlayerId
    ) {
      return;
    }

    const key = `${currentGame.handNumber}-${currentGame.calledByPlayerId}-${currentGame.upcard.id}`;
    if (upcardPickupKeyRef.current === key) {
      return;
    }
    upcardPickupKeyRef.current = key;

    setUpcardPickup({
      handNumber: currentGame.handNumber,
      dealerSeat: currentGame.dealerSeat,
      card: currentGame.upcard,
    });
    setUpcardPickupMoving(false);

    const startTimer = window.setTimeout(() => {
      setUpcardPickupMoving(true);
    }, 30);
    const clearTimer = window.setTimeout(() => {
      setUpcardPickup(null);
      setUpcardPickupMoving(false);
    }, 1100);

    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(clearTimer);
    };
  }, [state]);

  const sendAction = useCallback(
    (
      action:
        | "pass"
        | "order-up"
        | "choose-trump"
        | "discard"
        | "play-card"
        | "start-next-hand"
        | "restart-match"
        | "add-bot"
        | "remove-bot"
        | "set-seat"
        | "set-bot-difficulty"
        | "start-room",
      payload?: {
        suit?: Suit;
        cardId?: string;
        alone?: boolean;
        seatIndex?: number;
        targetPlayerId?: string;
        botDifficulty?: BotDifficulty;
      }
    ) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatusText("Not connected.");
        return;
      }

      ws.send(
        JSON.stringify({
          type: "action",
          action,
          ...payload,
        })
      );
    },
    []
  );

  const mySeat = state?.you?.seatIndex ?? -1;
  const game = state?.game;
  const isMyTurn = game?.turnSeat === mySeat;
  const legalPlaySet = useMemo(
    () => new Set(state ? state.legalPlays : []),
    [state]
  );
  const sortedMyHand = useMemo(
    () => sortHand(state?.you?.hand ?? [], game?.trump ?? null),
    [game?.trump, state?.you?.hand]
  );
  const currentTurnPlayerName = useMemo(() => {
    if (!state || !game) {
      return null;
    }
    return (
      state.players.find((player) => player.seatIndex === game.turnSeat)
        ?.name ?? null
    );
  }, [game, state]);
  const handTricksByTeam = useMemo(() => {
    if (!game) {
      return {
        teamA: 0,
        teamB: 0,
      };
    }

    return game.completedTricks.reduce(
      (accumulator, trick) => {
        if (trick.winnerSeat % 2 === 0) {
          accumulator.teamA += 1;
        } else {
          accumulator.teamB += 1;
        }
        return accumulator;
      },
      {
        teamA: 0,
        teamB: 0,
      }
    );
  }, [game]);
  const connectionDotClass =
    connectionText === "Connected"
      ? "bg-emerald-500"
      : connectionText === "Connecting..."
        ? "bg-amber-400 animate-pulse"
        : "bg-rose-500";

  const availableTrumpChoices = useMemo(() => {
    if (!game || game.phase !== "bidding-round-2") {
      return [] as Suit[];
    }

    return (Object.keys(SUIT_LABELS) as Suit[]).filter(
      (suit) => suit !== game.blockedSuit
    );
  }, [game]);
  const lobbyPlayers = useMemo(() => {
    if (!state) {
      return [] as PlayerSnapshot[];
    }
    const myId = state.you?.id ?? "";
    return [...state.players].sort((left, right) => {
      if (left.id === myId && right.id !== myId) {
        return -1;
      }
      if (right.id === myId && left.id !== myId) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });
  }, [state]);
  const isCreator = Boolean(state?.you?.isCreator);
  const isLobby = Boolean(state && !game);
  const canStartRoom = Boolean(
    state &&
      isLobby &&
      isCreator &&
      state.players.length === state.maxPlayers &&
      state.status === "waiting"
  );
  const teamLabels = useMemo(() => {
    if (!state) {
      return {
        0: "Team A",
        1: "Team B",
      } as const;
    }

    const buildLabel = (teamIndex: 0 | 1, fallback: string) => {
      const names = state.players
        .filter((player) => player.seatIndex % 2 === teamIndex)
        .sort((left, right) => left.seatIndex - right.seatIndex)
        .map((player) => player.name);

      if (names.length === 0) {
        return fallback;
      }
      return names.join(" & ");
    };

    return {
      0: buildLabel(0, "Team A"),
      1: buildLabel(1, "Team B"),
    } as const;
  }, [state]);

  if (search.step === "name") {
    return (
      <main className="mx-auto grid max-w-2xl gap-4 p-4">
        <section className="bg-game-surface-1 border-border rounded-4xl border p-5 shadow-game-card grid gap-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">Multiplayer Euchre Setup</h1>
            <Link to="/">
              <Button size="sm" variant="outline">
                Back
              </Button>
            </Link>
          </div>

          <label className="grid gap-1">
            <span className="text-sm font-medium">Your name</span>
            <input
              value={search.name}
              onChange={(event) =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    name: event.target.value,
                  }),
                  replace: true,
                })
              }
              placeholder="Player name"
              className="border-input bg-background h-10 rounded-xl border px-3"
            />
          </label>

          {search.autoJoin && search.mode === "join" && search.room.trim() !== "" ? (
            <p className="text-muted-foreground text-sm">
              Shared room detected: <span className="font-medium">{search.room}</span>
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              disabled={search.name.trim() === ""}
              onClick={() =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    step:
                      previous.autoJoin &&
                      previous.mode === "join" &&
                      previous.room.trim() !== ""
                        ? "game"
                        : "room",
                  }),
                })
              }
            >
              Continue
            </Button>
          </div>
        </section>
      </main>
    );
  }

  if (search.step === "room") {
    const roomTabIsCreate = search.mode === "create";

    return (
      <main className="mx-auto grid max-w-3xl gap-4 p-4">
        <section className="bg-game-surface-1 border-border rounded-4xl border p-5 shadow-game-card grid gap-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">Choose Room</h1>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    step: "name",
                  }),
                })
              }
            >
              Back
            </Button>
          </div>

          <div className="bg-background/70 border-border rounded-2xl border p-1 inline-flex gap-1 w-fit">
            <Button
              size="sm"
              variant={roomTabIsCreate ? "default" : "outline"}
              onClick={() =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    mode: "create",
                  }),
                  replace: true,
                })
              }
            >
              Create
            </Button>
            <Button
              size="sm"
              variant={roomTabIsCreate ? "outline" : "default"}
              onClick={() =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    mode: "join",
                  }),
                  replace: true,
                })
              }
            >
              Join
            </Button>
          </div>

          <label className="grid gap-1">
            <span className="text-sm font-medium">Room name</span>
            <input
              value={search.room}
              onChange={(event) =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    room: event.target.value,
                  }),
                  replace: true,
                })
              }
              placeholder="room-1"
              className="border-input bg-background h-10 rounded-xl border px-3"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm font-medium">Password (optional)</span>
            <input
              value={search.password}
              onChange={(event) =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    password: event.target.value,
                  }),
                  replace: true,
                })
              }
              placeholder="Password"
              className="border-input bg-background h-10 rounded-xl border px-3"
            />
          </label>

          {roomTabIsCreate ? (
            <div className="grid gap-1">
              <p className="text-muted-foreground text-sm">
                Create mode will open a lobby. Configure bots and teams there.
              </p>
              {createRoomNameTaken ? (
                <p className="text-game-danger text-sm">
                  Room name already exists. Choose a different name.
                </p>
              ) : null}
            </div>
          ) : (
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Open rooms</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refreshRooms()}
                >
                  Refresh
                </Button>
              </div>

              {rooms.length > 0 ? (
                <ul className="grid gap-2">
                  {rooms.map((room) => (
                    <li
                      key={room.name}
                      className="border-border bg-background rounded-xl border p-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {room.name}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {room.status === "playing" ? "In game" : "Lobby"} •{" "}
                            {room.players}/{room.maxPlayers} players
                            {room.botCount > 0
                              ? ` • ${room.botCount} bot(s) (${room.botDifficulty})`
                              : ""}
                            {room.hasPassword ? " • Password" : ""}
                          </p>
                        </div>
                        <div className="ml-auto flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              navigate({
                                search: (previous: EuchreSearch) => ({
                                  ...previous,
                                  mode: "join",
                                  room: room.name,
                                }),
                                replace: true,
                              })
                            }
                          >
                            Join
                          </Button>
                          {creatorRoomTokens[room.name] ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => deleteRoom(room.name)}
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No rooms available.
                </p>
              )}
              {roomListError ? (
                <p className="text-game-danger text-sm">{roomListError}</p>
              ) : null}
            </section>
          )}

          <div className="flex justify-end">
            <Button
              disabled={
                search.room.trim() === "" ||
                (roomTabIsCreate && createRoomNameTaken)
              }
              onClick={() =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    step: "game",
                  }),
                })
              }
            >
              Enter Game
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-3 p-2 sm:p-3 md:p-4">
      <section className="bg-game-surface-1 border-border rounded-4xl border p-2 shadow-game-card sm:p-3 md:p-4">
        {state ? (
          <>
            {(() => {
              const anchorSeat = state.you ? state.you.seatIndex : 0;
              const trickBySeat = new Map(
                (game?.currentTrick ?? []).map((play) => [play.seatIndex, play])
              );

              return (
                <>
                  <div className="relative mx-auto w-full max-w-5xl rounded-3xl border border-emerald-900/35 bg-[radial-gradient(circle_at_50%_40%,#34d399_0%,#059669_48%,#064e3b_100%)] px-2 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_20px_40px_-20px_rgba(0,0,0,0.45)] min-h-[420px] sm:min-h-[500px] md:h-[70vh] md:max-h-[620px]">
                    <div className="absolute top-2 left-2 rounded-xl border border-white/30 bg-black/30 px-2 py-1 text-[11px] text-white backdrop-blur-sm sm:text-xs">
                      <p className="font-semibold">Room {state.roomName}</p>
                      <p>
                        {game
                          ? `Hand ${game.handNumber}`
                          : `Lobby ${state.players.length}/${state.maxPlayers}`}
                      </p>
                      <p>
                        Bots: {state.botCount} ({state.botDifficulty})
                      </p>
                      <p>
                        Match: A {state.score.team0} - B {state.score.team1}
                      </p>
                    </div>

                    <div className="absolute top-2 right-2 flex items-center gap-2">
                      <div className="rounded-xl border border-white/30 bg-black/30 px-2 py-1 text-[11px] text-white backdrop-blur-sm sm:text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`inline-block size-2 rounded-full ${connectionDotClass}`}
                          />
                          {connectionText}
                        </span>
                      </div>
                      <Popover>
                        <PopoverTrigger
                          render={<Button size="sm" variant="secondary" />}
                        >
                          Menu
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-44 gap-2 p-2">
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => manualReconnect()}
                          >
                            Reconnect
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() =>
                              navigate({
                                search: (previous: EuchreSearch) => ({
                                  ...previous,
                                  step: "room",
                                }),
                              })
                            }
                          >
                            Setup
                          </Button>
                        </PopoverContent>
                      </Popover>
                    </div>

                    {[2, 1, 3, 0].map((relativeSeat) => {
                      const seatIndex = getAbsoluteSeat(
                        anchorSeat,
                        relativeSeat
                      );
                      const player = state.players.find(
                        (item) => item.seatIndex === seatIndex
                      );
                      const isTurnSeat = seatIndex === game?.turnSeat;
                      const isSelf = player?.id === state.you?.id;
                      const isMaker = player?.id === game?.calledByPlayerId;
                      const isSittingOut = seatIndex === game?.sittingOutSeat;

                      return (
                        <div
                          key={`seat-${seatIndex}`}
                          className={`absolute w-24 sm:w-30 md:w-40 ${seatPositionClass(relativeSeat)}`}
                        >
                          <div
                            className={[
                              "rounded-2xl border border-white/25 bg-black/35 p-2 text-center text-xs text-white shadow-lg backdrop-blur-sm",
                              isTurnSeat ? "ring-2 ring-amber-300" : "",
                              isSelf ? "ring-2 ring-cyan-300" : "",
                            ].join(" ")}
                          >
                            {player ? (
                              <>
                                <p className="inline-flex items-center justify-center gap-1 truncate font-semibold">
                                  <span
                                    className={`inline-block size-2 rounded-full ${player.connected ? "bg-emerald-400" : "bg-rose-400"}`}
                                    aria-hidden
                                  />
                                  {player.name}
                                </p>
                                {isSelf && game?.trump ? (
                                  <p className="text-white/85">
                                    Trump:{" "}
                                    <span
                                      className={`font-semibold ${suitColorClassOnDark(game.trump)}`}
                                    >
                                      {SUIT_SYMBOLS[game.trump]}{" "}
                                      {SUIT_LABELS[game.trump]}
                                    </span>
                                  </p>
                                ) : null}
                                <p className="text-white/80">
                                  {isSittingOut ? "Sitting out" : `${player.handCount} cards`}
                                </p>
                                {isMaker && game?.trump ? (
                                  <p className="mt-1 inline-flex items-center justify-center gap-1 rounded-full border border-amber-200/60 bg-amber-300/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                                    Maker
                                    {game.goingAlonePlayerId === player.id
                                      ? " (Alone)"
                                      : ""}{" "}
                                    •{" "}
                                    <span
                                      className={suitColorClassOnDark(game.trump)}
                                    >
                                      {SUIT_SYMBOLS[game.trump]}{" "}
                                      {SUIT_LABELS[game.trump]}
                                    </span>
                                  </p>
                                ) : null}
                              </>
                            ) : (
                              <p className="text-white/70">Open Seat</p>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    <div className="mx-auto mt-20 h-54 w-54 rounded-full border border-white/30 bg-black/20 p-3 shadow-inner sm:mt-24 sm:h-62 sm:w-62 md:mt-32 md:h-64 md:w-64">
                      <div className="relative size-full rounded-full border border-white/25 bg-emerald-900/25">
                        {game?.currentTrick.length ? (
                          [0, 1, 2, 3].map((relativeSeat) => {
                            const seatIndex = getAbsoluteSeat(
                              anchorSeat,
                              relativeSeat
                            );
                            const play = trickBySeat.get(seatIndex);
                            if (!play) {
                              return null;
                            }

                            return (
                              <div
                                key={`${play.playerId}-${play.card.id}`}
                                className={`absolute ${trickCardPositionClass(relativeSeat)}`}
                              >
                                <TableCard card={play.card} size="sm" />
                              </div>
                            );
                          })
                        ) : game &&
                          !capturedTrick &&
                          !upcardPickup &&
                          (game.phase === "bidding-round-1" ||
                            game.phase === "bidding-round-2" ||
                            game.phase === "dealer-discard") &&
                          game.upcard ? (
                          <div className="absolute inset-0 grid place-items-center">
                            <div className="grid gap-1 text-center">
                              <p className="text-[11px] font-semibold text-white/90 sm:text-xs">
                                Upcard
                              </p>
                              <TableCard card={game.upcard} size="sm" />
                            </div>
                          </div>
                        ) : (
                          <div className="absolute inset-0 grid place-items-center text-center text-xs text-white/85">
                            <div>
                              <p>{game ? "Waiting for trick lead" : "Lobby"}</p>
                            </div>
                          </div>
                        )}

                        {capturedTrick &&
                        mySeat >= 0 &&
                        (game?.phase === "playing" ||
                          game?.phase === "hand-over" ||
                          game?.phase === "game-over") &&
                        (game?.currentTrick.length ?? 0) === 0 &&
                        !upcardPickup ? (
                          (() => {
                            const winnerRelativeSeat =
                              (capturedTrick.winnerSeat - mySeat + 4) % 4;
                            return (
                              <div
                                className={[
                                  "absolute inset-0 z-20 pointer-events-none transition-transform duration-700 ease-out",
                                  capturedTrickMoving
                                    ? trickCaptureTargetClass(winnerRelativeSeat)
                                    : "",
                                ].join(" ")}
                              >
                                {capturedTrick.cards.map((play) => {
                                  const relativeSeat =
                                    (play.seatIndex - mySeat + 4) % 4;
                                  return (
                                    <div
                                      key={`${capturedTrick.handNumber}-${capturedTrick.trickIndex}-${play.seatIndex}-${play.card.id}`}
                                      className={`absolute ${trickCardPositionClass(relativeSeat)}`}
                                    >
                                      <TableCard card={play.card} size="sm" />
                                    </div>
                                  );
                                })}
                                {capturedTrickShowWinner ? (
                                  <p className="absolute inset-x-0 top-1 mx-auto w-max rounded-full border border-white/25 bg-black/75 px-2 py-1 text-center text-[11px] font-semibold text-white shadow-lg sm:text-xs">
                                    Trick {capturedTrick.trickIndex + 1}:{" "}
                                    {capturedTrick.winnerName}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()
                        ) : null}

                        {upcardPickup &&
                        mySeat >= 0 &&
                        !capturedTrick &&
                        (game?.phase === "dealer-discard" ||
                          game?.phase === "bidding-round-1" ||
                          game?.phase === "bidding-round-2") ? (
                          (() => {
                            const dealerRelativeSeat =
                              (upcardPickup.dealerSeat - mySeat + 4) % 4;
                            return (
                              <div
                                className={[
                                  "absolute inset-0 z-20 pointer-events-none transition-transform duration-700 ease-out",
                                  upcardPickupMoving
                                    ? trickCaptureTargetClass(dealerRelativeSeat)
                                    : "",
                                ].join(" ")}
                              >
                                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                                  <TableCard card={upcardPickup.card} size="sm" />
                                </div>
                              </div>
                            );
                          })()
                        ) : null}
                      </div>
                    </div>

                    <div className="absolute right-4 bottom-4 rounded-2xl border border-white/30 bg-black/30 p-2 text-white shadow-lg backdrop-blur-sm">
                      <p className="mt-1 text-xs text-white/85">
                        Tricks: A {handTricksByTeam.teamA} - B {handTricksByTeam.teamB}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                    {statusText}
                  </div>

                  {game?.handSummary && !capturedTrick ? (
                    <section className="mt-2 rounded-2xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      <p className="font-semibold">
                        Hand Winner: {teamLabels[game.handSummary.awardedTo]} (+
                        {game.handSummary.pointsAwarded})
                      </p>
                      <p className="text-xs">
                        Makers: {teamLabels[game.handSummary.makerTeam]} • Tricks{" "}
                        {game.handSummary.makerTricks}-
                        {game.handSummary.defenderTricks}
                      </p>
                    </section>
                  ) : null}

                  {game?.phase === "game-over" && !capturedTrick ? (
                    <section className="mt-2 rounded-2xl border border-emerald-300/70 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                      <p className="font-semibold">
                        Match Winner: Team{" "}
                        {state.score.team0 >= state.targetScore ? "A" : "B"}
                      </p>
                      <p className="text-xs">
                        Final score: A {state.score.team0} - B {state.score.team1}
                      </p>
                    </section>
                  ) : null}

                  {game ? (
                    <>
                      {(game.phase === "bidding-round-1" ||
                        game.phase === "bidding-round-2" ||
                        game.phase === "dealer-discard" ||
                        game.phase === "hand-over" ||
                        game.phase === "game-over") && (
                        <section className="bg-background/75 border-border mt-3 rounded-2xl border p-3 grid gap-2 text-sm">
                          <h3 className="text-base font-semibold">Actions</h3>
                          {(game.phase === "bidding-round-1" ||
                            game.phase === "bidding-round-2") && (
                            <>
                              <p>
                                {isMyTurn
                                  ? "Your turn to bid."
                                  : `Waiting for ${currentTurnPlayerName ?? "player"} to bid.`}
                              </p>
                              {isMyTurn ? (
                                <label className="inline-flex items-center justify-end gap-2 text-xs">
                                  <span>Go alone</span>
                                  <input
                                    type="checkbox"
                                    checked={goAloneChoice}
                                    onChange={(event) =>
                                      setGoAloneChoice(event.target.checked)
                                    }
                                  />
                                </label>
                              ) : null}
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  variant="secondary"
                                  disabled={!isMyTurn}
                                  onClick={() => sendAction("pass")}
                                >
                                  Pass
                                </Button>
                                {game.phase === "bidding-round-1" ? (
                                  <Button
                                    disabled={!isMyTurn}
                                    onClick={() =>
                                      sendAction("order-up", {
                                        alone: goAloneChoice,
                                      })
                                    }
                                  >
                                    Order Up
                                  </Button>
                                ) : (
                                  availableTrumpChoices.map((suit) => (
                                    <Button
                                      key={suit}
                                      disabled={!isMyTurn}
                                      onClick={() =>
                                        sendAction("choose-trump", {
                                          suit,
                                          alone: goAloneChoice,
                                        })
                                      }
                                    >
                                      Call {SUIT_LABELS[suit]}
                                    </Button>
                                  ))
                                )}
                              </div>
                            </>
                          )}
                          {game.phase === "dealer-discard" ? (
                            <p>
                              {isMyTurn
                                ? "Dealer: choose one card to discard."
                                : "Waiting for dealer to discard."}
                            </p>
                          ) : null}
                          {game.phase === "hand-over" ? (
                            <div className="flex justify-end">
                              <Button
                                onClick={() => sendAction("start-next-hand")}
                              >
                                Start Next Hand
                              </Button>
                            </div>
                          ) : null}
                          {game.phase === "game-over" ? (
                            <div className="flex justify-end">
                              <Button onClick={() => sendAction("restart-match")}>
                                Restart Match
                              </Button>
                            </div>
                          ) : null}
                          {game.handSummary ? (
                            <p className="text-muted-foreground text-xs">
                              {teamLabels[game.handSummary.awardedTo]} earned{" "}
                              {game.handSummary.pointsAwarded} point(s).
                            </p>
                          ) : null}
                        </section>
                      )}

                      <section className="mt-3 grid gap-2">
                        <h3 className="text-base font-semibold">Your Hand</h3>
                        {state.you ? (
                          <div className="overflow-x-auto pb-2">
                            <div className="mx-auto flex min-h-44 min-w-max items-end justify-center px-2 pt-2">
                              {sortedMyHand.map((card, index) => {
                                const canPlay = legalPlaySet.has(card.id);
                                const playEnabled =
                                  game.phase === "playing" &&
                                  isMyTurn &&
                                  canPlay;
                                const discardEnabled =
                                  game.phase === "dealer-discard" &&
                                  isMyTurn &&
                                  canPlay;
                                const cardEnabled =
                                  playEnabled || discardEnabled;
                                const rotation =
                                  (index - (sortedMyHand.length - 1) / 2) * 5;

                                return (
                                  <button
                                    key={card.id}
                                    type="button"
                                    className="first:ml-0 -ml-6 cursor-pointer transition-transform hover:z-10 hover:-translate-y-2 disabled:cursor-default disabled:hover:translate-y-0"
                                    disabled={!cardEnabled}
                                    onClick={() => {
                                      if (game.phase === "dealer-discard") {
                                        sendAction("discard", {
                                          cardId: card.id,
                                        });
                                      } else {
                                        sendAction("play-card", {
                                          cardId: card.id,
                                        });
                                      }
                                    }}
                                    style={{
                                      transform: `rotate(${rotation}deg)`,
                                    }}
                                  >
                                    <GameCard
                                      size="sm"
                                      variant={
                                        cardEnabled ? "active" : "default"
                                      }
                                      className={[
                                        "w-20 bg-white p-2",
                                        cardEnabled
                                          ? "border-2 border-emerald-500 ring-2 ring-emerald-300"
                                          : "border border-slate-300",
                                      ].join(" ")}
                                    >
                                      <GameCardMedia className="border border-slate-300 bg-white p-1">
                                        <div
                                          className={`grid h-full grid-rows-[auto_1fr_auto] text-center ${suitColorClass(card.suit)}`}
                                        >
                                          <p className="text-left text-xs leading-none font-semibold">
                                            {card.rank}
                                            <br />
                                            {SUIT_SYMBOLS[card.suit]}
                                          </p>
                                          <p className="grid place-items-center text-3xl leading-none">
                                            {SUIT_SYMBOLS[card.suit]}
                                          </p>
                                          <p className="text-right text-xs leading-none font-semibold">
                                            {card.rank}
                                            <br />
                                            {SUIT_SYMBOLS[card.suit]}
                                          </p>
                                        </div>
                                      </GameCardMedia>
                                    </GameCard>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">
                            You are not seated in this room.
                          </p>
                        )}
                      </section>
                    </>
                  ) : (
                    <section className="bg-background/75 border-border mt-3 rounded-2xl border p-3 grid gap-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-semibold">Lobby</h3>
                        <div className="ml-auto flex items-center justify-end gap-2">
                          <p className="text-muted-foreground text-xs">
                            {state.players.length}/{state.maxPlayers} seats filled
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => shareRoomLink()}
                          >
                            Share
                          </Button>
                        </div>
                      </div>

                      {state.you?.isCreator ? (
                        <div className="grid gap-3">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button size="sm" onClick={() => sendAction("add-bot")}>
                              Add Bot
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => sendAction("remove-bot")}
                            >
                              Remove Bot
                            </Button>
                            <label className="inline-flex items-center gap-2 text-xs">
                              Difficulty
                              <select
                                value={state.botDifficulty}
                                onChange={(event) =>
                                  sendAction("set-bot-difficulty", {
                                    botDifficulty: parseBotDifficulty(
                                      event.target.value
                                    ),
                                  })
                                }
                                className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                              >
                                <option value="easy">Easy</option>
                                <option value="medium">Medium</option>
                                <option value="hard">Hard</option>
                              </select>
                            </label>
                          </div>

                          <div className="grid gap-2 text-right">
                            <p className="text-xs font-medium">
                              Team setup (seat 0/2 = Team A, seat 1/3 = Team B)
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              Selecting an occupied seat swaps those two players.
                            </p>
                            {lobbyPlayers.map((player) => (
                                <div
                                  key={player.id}
                                  className="border-border bg-background flex items-center justify-end gap-3 rounded-xl border px-2 py-1"
                                >
                                  <p className="text-xs text-right">
                                    {player.name}
                                    {player.isBot ? " (Bot)" : ""} • Team{" "}
                                    {player.seatIndex % 2 === 0 ? "A" : "B"} • Seat{" "}
                                    {player.seatIndex}
                                  </p>
                                  <select
                                    value={String(player.seatIndex)}
                                    onChange={(event) =>
                                      sendAction("set-seat", {
                                        targetPlayerId: player.id,
                                        seatIndex: Number(event.target.value),
                                      })
                                    }
                                    className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                                  >
                                    <option value="0">Seat 0 (A)</option>
                                    <option value="1">Seat 1 (B)</option>
                                    <option value="2">Seat 2 (A)</option>
                                    <option value="3">Seat 3 (B)</option>
                                  </select>
                                </div>
                              ))}
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <Button
                              disabled={!canStartRoom}
                              onClick={() => sendAction("start-room")}
                            >
                              Start Room
                            </Button>
                            {!canStartRoom ? (
                              <p className="text-muted-foreground text-xs">
                                Fill all 4 seats to start.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">
                          Waiting for the room creator to configure teams and start
                          the room.
                        </p>
                      )}
                    </section>
                  )}
                </>
              );
            })()}
          </>
        ) : (
          <div className="grid gap-2">
            <p className="text-muted-foreground text-sm">
              Connecting to game room and waiting for initial state.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button size="sm" onClick={() => manualReconnect()}>
                Reconnect
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigate({
                    search: (previous: EuchreSearch) => ({
                      ...previous,
                      step: "room",
                    }),
                  })
                }
              >
                Back To Rooms
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export const Route = createFileRoute("/games/euchre")({
  validateSearch: (search): EuchreSearch => ({
    step: parseStep(readString(search.step)),
    mode: parseMode(readString(search.mode)),
    name: readString(search.name),
    room: readString(search.room),
    password: readString(search.password),
    autoJoin: parseBoolean(readString(search.autoJoin)),
  }),
  component: EuchreRouteComponent,
});
