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
  hasPassword: boolean;
  status: "waiting" | "playing";
  createdAt: number;
};

type PlayerSnapshot = {
  id: string;
  name: string;
  seatIndex: number;
  connected: boolean;
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
  calledByName: string | null;
  handNumber: number;
};

type RoomState = {
  roomName: string;
  maxPlayers: number;
  status: "waiting" | "playing";
  score: {
    team0: number;
    team1: number;
  };
  players: PlayerSnapshot[];
  you: {
    id: string;
    name: string;
    seatIndex: number;
    hand: Card[];
  } | null;
  game: GameSnapshot | null;
  legalPlays: string[];
  targetScore: number;
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

function getServerHttpOrigin() {
  const configured = import.meta.env.VITE_MULTIPLAYER_SERVER_ORIGIN?.trim();
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

function TableCard({
  card,
  size = "md",
}: {
  card: Card;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "w-14 md:w-16" : "w-18 md:w-20";

  return (
    <div
      className={`${sizeClass} rounded-xl border border-slate-300 bg-white p-1 text-center shadow-xl`}
    >
      <p className={`text-xs leading-none font-semibold ${suitColorClass(card.suit)}`}>
        {card.rank} {SUIT_SYMBOLS[card.suit]}
      </p>
      <p className={`py-1 text-2xl leading-none ${suitColorClass(card.suit)}`}>
        {SUIT_SYMBOLS[card.suit]}
      </p>
      <p className={`text-xs leading-none font-semibold ${suitColorClass(card.suit)}`}>
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

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      wsRef.current = null;
      ws.close(1000, "Client disconnected");
    }
    setConnectionText("Disconnected");
  }, []);

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

      if (search.mode === "create") {
        params.set("create", "1");
      }

      const ws = new WebSocket(`${serverWsOrigin}/websocket?${params.toString()}`);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setConnectionText("Connected");
        setStatusText("Connected to room.");
        refreshRooms();
      });

      ws.addEventListener("close", () => {
        wsRef.current = null;
        setConnectionText("Disconnected");
        setState(null);
        refreshRooms();
      });

      ws.addEventListener("error", () => {
        setConnectionText("Disconnected");
        setStatusText("Unable to connect to that room.");
      });

      ws.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data as string) as ServerMessage;

          if (payload.type === "state") {
            setState(payload.state);
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
    setState(null);
  }, [
    disconnect,
    refreshRooms,
    connectVersion,
    search.mode,
    search.step,
    serverWsOrigin,
    trimmedName,
    trimmedPassword,
    trimmedRoom,
  ]);

  useEffect(() => () => disconnect(), [disconnect]);

  const sendAction = useCallback(
    (
      action:
        | "pass"
        | "order-up"
        | "choose-trump"
        | "discard"
        | "play-card"
        | "start-next-hand"
        | "restart-match",
      payload?: {
        suit?: Suit;
        cardId?: string;
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
      state.players.find((player) => player.seatIndex === game.turnSeat)?.name ??
      null
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

          <div className="flex justify-end">
            <Button
              disabled={search.name.trim() === ""}
              onClick={() =>
                navigate({
                  search: (previous: EuchreSearch) => ({
                    ...previous,
                    step: "room",
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
            <p className="text-muted-foreground text-sm">
              Create mode will create a new room with this name.
            </p>
          ) : (
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">Open rooms</h2>
                <Button size="sm" variant="outline" onClick={() => refreshRooms()}>
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
                          <p className="truncate text-sm font-medium">{room.name}</p>
                          <p className="text-muted-foreground text-xs">
                            {room.status === "playing" ? "In game" : "Lobby"} •{" "}
                            {room.players}/{room.maxPlayers} players
                            {room.hasPassword ? " • Password" : ""}
                          </p>
                        </div>
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
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No rooms available.</p>
              )}
              {roomListError ? (
                <p className="text-game-danger text-sm">{roomListError}</p>
              ) : null}
            </section>
          )}

          <div className="flex justify-end">
            <Button
              disabled={search.room.trim() === ""}
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
                  <div className="relative mx-auto w-full max-w-5xl rounded-[2rem] border border-emerald-900/35 bg-[radial-gradient(circle_at_50%_40%,#34d399_0%,#059669_48%,#064e3b_100%)] px-2 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_20px_40px_-20px_rgba(0,0,0,0.45)] min-h-[420px] sm:min-h-[500px] md:h-[70vh] md:max-h-[620px]">
                    <div className="absolute top-2 left-2 rounded-xl border border-white/30 bg-black/30 px-2 py-1 text-[11px] text-white backdrop-blur-sm sm:text-xs">
                      <p className="font-semibold">Room {state.roomName}</p>
                      <p>
                        {game
                          ? `Hand ${game.handNumber}`
                          : `Lobby ${state.players.length}/${state.maxPlayers}`}
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
                        <PopoverTrigger render={<Button size="sm" variant="secondary" />}>
                          Menu
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-44 gap-2 p-2">
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => {
                              setStatusText("Reconnecting...");
                              setConnectVersion((value) => value + 1);
                            }}
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
                      const seatIndex = getAbsoluteSeat(anchorSeat, relativeSeat);
                      const player = state.players.find(
                        (item) => item.seatIndex === seatIndex
                      );
                      const isTurnSeat = seatIndex === game?.turnSeat;
                      const isDealerSeat = seatIndex === game?.dealerSeat;
                      const isSelf = player?.id === state.you?.id;

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
                                <p className="text-white/80">
                                  {isDealerSeat ? "Dealer" : "Player"}
                                </p>
                                <p className="text-white/80">
                                  Team {player.seatIndex % 2 === 0 ? "A" : "B"} •
                                  {" "}
                                  {player.handCount} cards •
                                  {" "}
                                  {player.connected ? "Online" : "Offline"}
                                </p>
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
                            const seatIndex = getAbsoluteSeat(anchorSeat, relativeSeat);
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
                        ) : (
                          <div className="absolute inset-0 grid place-items-center text-center text-xs text-white/85">
                            <div>
                              <p>Waiting for trick lead</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="absolute right-4 bottom-4 rounded-2xl border border-white/30 bg-black/30 p-2 text-white shadow-lg backdrop-blur-sm">
                      <p className="text-[11px] uppercase tracking-wide text-white/80">
                        Trump
                      </p>
                      <p className="text-sm font-semibold">
                        {game?.trump ? SUIT_LABELS[game.trump] : "Not selected"}
                      </p>
                      <p className="mt-1 text-xs text-white/85">
                        Tricks: Team A {handTricksByTeam.teamA} - Team B{" "}
                        {handTricksByTeam.teamB}
                      </p>
                      {game?.upcard ? (
                        <div className="mt-2 grid gap-1">
                          <p className="text-[11px] uppercase tracking-wide text-white/80">
                            Upcard
                          </p>
                          <TableCard card={game.upcard} size="sm" />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                    {statusText}
                  </div>

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
                              <div className="flex flex-wrap gap-2">
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
                                    onClick={() => sendAction("order-up")}
                                  >
                                    Order Up
                                  </Button>
                                ) : (
                                  availableTrumpChoices.map((suit) => (
                                    <Button
                                      key={suit}
                                      disabled={!isMyTurn}
                                      onClick={() =>
                                        sendAction("choose-trump", { suit })
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
                            <Button onClick={() => sendAction("start-next-hand")}>
                              Start Next Hand
                            </Button>
                          ) : null}
                          {game.phase === "game-over" ? (
                            <Button onClick={() => sendAction("restart-match")}>
                              Restart Match
                            </Button>
                          ) : null}
                          {game.handSummary ? (
                            <p className="text-muted-foreground text-xs">
                              Team {game.handSummary.awardedTo === 0 ? "A" : "B"} earned{" "}
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
                                  game.phase === "playing" && isMyTurn && canPlay;
                                const discardEnabled =
                                  game.phase === "dealer-discard" &&
                                  isMyTurn &&
                                  canPlay;
                                const cardEnabled = playEnabled || discardEnabled;
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
                                        sendAction("discard", { cardId: card.id });
                                      } else {
                                        sendAction("play-card", { cardId: card.id });
                                      }
                                    }}
                                    style={{ transform: `rotate(${rotation}deg)` }}
                                  >
                                    <GameCard
                                      size="sm"
                                      variant={cardEnabled ? "active" : "default"}
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
                    <p className="text-muted-foreground mt-3 text-sm">
                      Waiting for all 4 players to join before dealing.
                    </p>
                  )}
                </>
              );
            })()}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Connecting to game room and waiting for initial state.
          </p>
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
  }),
  component: EuchreRouteComponent,
});
