// oxlint-disable unicorn/no-array-for-each
// oxlint-disable require-await
// oxlint-disable class-methods-use-this
import { DurableObject } from "cloudflare:workers";

type Suit = "clubs" | "diamonds" | "hearts" | "spades";
type Rank = "9" | "10" | "J" | "Q" | "K" | "A";

type Card = {
  id: string;
  suit: Suit;
  rank: Rank;
};

type PlayerState = {
  id: string;
  name: string;
  seatIndex: number;
  connected: boolean;
  isBot: boolean;
  hand: Card[];
};

type TrickPlay = {
  playerId: string;
  card: Card;
};

type CompletedTrick = {
  index: number;
  winnerSeat: number;
  cards: TrickPlay[];
};

type HandSummary = {
  makerTeam: TeamId;
  makerTricks: number;
  defenderTricks: number;
  pointsAwarded: number;
  awardedTo: TeamId;
};

type TeamId = 0 | 1;

type EuchreGameState = {
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
  kitty: Card[];
  blockedSuit: Suit | null;
  trump: Suit | null;
  makerTeam: TeamId | null;
  calledByPlayerId: string | null;
  goingAlonePlayerId: string | null;
  sittingOutSeat: number | null;
  currentTrick: TrickPlay[];
  completedTricks: CompletedTrick[];
  trickIndex: number;
  handSummary: HandSummary | null;
  handNumber: number;
};

type EuchreRoom = {
  name: string;
  password: string | null;
  creatorToken: string;
  creatorPlayerId: string | null;
  createdAt: number;
  updatedAt: number;
  maxPlayers: number;
  status: "waiting" | "playing";
  botDifficulty: BotDifficulty;
  botCount: number;
  score: {
    team0: number;
    team1: number;
  };
  players: PlayerState[];
  game: EuchreGameState | null;
};

type SessionAttachment = {
  sessionId: string;
  roomName: string;
  playerId: string;
};

type BotDifficulty = "easy" | "medium" | "hard";

type BotAction =
  | {
      action: "pass" | "order-up" | "start-next-hand" | "restart-match";
      alone?: boolean;
    }
  | {
      action: "choose-trump";
      suit: Suit;
      alone?: boolean;
    }
  | {
      action: "discard" | "play-card";
      cardId: string;
    };

type SimulatedPlayState = {
  turnSeat: number;
  trump: Suit;
  trickIndex: number;
  currentTrick: {
    seatIndex: number;
    card: Card;
  }[];
  handsBySeat: Map<number, Card[]>;
  tricksByTeam: {
    team0: number;
    team1: number;
  };
};

type ClientEnvelope =
  | {
      type: "action";
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
        | "start-room";
      suit?: Suit;
      cardId?: string;
      alone?: boolean;
      seatIndex?: number;
      targetPlayerId?: string;
      botDifficulty?: BotDifficulty;
    }
  | { type: "ping" };

const STORAGE_KEY = "euchre-rooms";
const TEAM_TO_SCORE_KEY: Record<TeamId, "team0" | "team1"> = {
  0: "team0",
  1: "team1",
};
const RANKS: Rank[] = ["9", "10", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const ROOM_SIZE = 4;
const TARGET_SCORE = 10;
const ROOM_TTL_MS = 60 * 60 * 1000;
const BOT_NAMES = [
  "Atlas",
  "Rook",
  "Vega",
  "Nova",
  "Kite",
  "Echo",
  "Orion",
  "Mira",
];
const CREATOR_TOKEN_HEADER = "x-euchre-creator-token";

const DIFFICULTY_SETTINGS: Record<
  BotDifficulty,
  {
    sampleCount: number;
    searchDepth: number;
    randomMoveRate: number;
    bidThreshold: number;
  }
> = {
  easy: {
    sampleCount: 4,
    searchDepth: 2,
    randomMoveRate: 0.35,
    bidThreshold: 45,
  },
  medium: {
    sampleCount: 8,
    searchDepth: 4,
    randomMoveRate: 0.12,
    bidThreshold: 20,
  },
  hard: {
    sampleCount: 16,
    searchDepth: 8,
    randomMoveRate: 0,
    bidThreshold: -5,
  },
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function sanitizeRoomName(roomName: string | null) {
  return (roomName ?? "").trim().slice(0, 40);
}

function sanitizePlayerName(name: string | null) {
  return (name ?? "").trim().slice(0, 24);
}

function parseBotDifficulty(value: string | null): BotDifficulty {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }
  return "medium";
}

function parseSeatIndex(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const seat = Math.floor(value);
  if (seat < 0 || seat >= ROOM_SIZE) {
    return null;
  }
  return seat;
}

function getTeamForSeat(seatIndex: number): TeamId {
  return seatIndex % 2 === 0 ? 0 : 1;
}

function nextSeat(seatIndex: number) {
  return (seatIndex + 1) % ROOM_SIZE;
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

function rankStrength(card: Card, trump: Suit | null, leadSuit: Suit | null) {
  if (!trump || !leadSuit) {
    return 0;
  }

  const cardSuit = effectiveSuit(card, trump);

  if (isRightBower(card, trump)) {
    return 100;
  }
  if (isLeftBower(card, trump)) {
    return 99;
  }

  if (cardSuit === trump) {
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

  if (cardSuit === leadSuit) {
    if (card.rank === "A") {
      return 60;
    }
    if (card.rank === "K") {
      return 59;
    }
    if (card.rank === "Q") {
      return 58;
    }
    if (card.rank === "J") {
      return 57;
    }
    if (card.rank === "10") {
      return 56;
    }
    return 55;
  }

  return 0;
}

function shuffleDeck(cards: Card[]) {
  const deck = [...cards];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = deck[index];
    deck[index] = deck[swapIndex];
    deck[swapIndex] = temp;
  }
  return deck;
}

function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${suit}-${rank}-${crypto.randomUUID()}`,
      suit,
      rank,
    }))
  );
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  // oxlint-disable-next-line unicorn/prefer-response-static-json
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

export class WebSocketHibernationServer extends DurableObject {
  sessions: Map<WebSocket, SessionAttachment>;
  rooms: Map<string, EuchreRoom>;
  autoAdvanceInFlight: Set<string>;
  ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.sessions = new Map();
    this.rooms = new Map();
    this.autoAdvanceInFlight = new Set();

    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment();
      if (attachment) {
        this.sessions.set(ws, attachment as SessionAttachment);
      }
    });

    this.ready = this.restoreState();

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  async restoreState() {
    const persistedRooms =
      await this.ctx.storage.get<Record<string, EuchreRoom>>(STORAGE_KEY);

    this.rooms = new Map(Object.entries(persistedRooms ?? {}));

    this.rooms.forEach((room) => {
      room.botDifficulty = room.botDifficulty ?? "medium";
      room.botCount = room.botCount ?? 0;
      room.creatorToken = room.creatorToken ?? crypto.randomUUID();
      room.creatorPlayerId =
        room.creatorPlayerId ??
        room.players.find((player) => !player.isBot)?.id ??
        null;
      room.players.forEach((player) => {
        player.isBot = player.isBot ?? false;
        player.connected = player.isBot;
      });
    });

    this.sessions.forEach((session) => {
      const room = this.rooms.get(session.roomName);
      if (!room) {
        return;
      }

      const player = room.players.find((item) => item.id === session.playerId);
      if (player) {
        player.connected = true;
      }
    });
  }

  async persistRooms() {
    const entries = Object.fromEntries(this.rooms.entries());
    await this.ctx.storage.put(STORAGE_KEY, entries);
  }

  async pruneExpiredRooms() {
    const now = Date.now();
    const expiredRoomNames: string[] = [];

    this.rooms.forEach((room, roomName) => {
      if (now - room.createdAt >= ROOM_TTL_MS) {
        expiredRoomNames.push(roomName);
      }
    });

    if (expiredRoomNames.length === 0) {
      return;
    }

    expiredRoomNames.forEach((roomName) => {
      this.rooms.delete(roomName);
      this.sessions.forEach((session, ws) => {
        if (session.roomName === roomName) {
          ws.close(1001, "Room expired");
        }
      });
    });

    await this.persistRooms();
  }

  listRooms() {
    return [...this.rooms.values()]
      .map((room) => ({
        name: room.name,
        players: room.players.length,
        maxPlayers: room.maxPlayers,
        botCount: room.botCount,
        botDifficulty: room.botDifficulty,
        creatorPlayerId: room.creatorPlayerId,
        hasPassword: Boolean(room.password),
        status: room.status,
        createdAt: room.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  isCreator(room: EuchreRoom, viewerPlayerId: string) {
    return room.creatorPlayerId === viewerPlayerId;
  }

  buildClientState(room: EuchreRoom, viewerPlayerId: string) {
    const me =
      room.players.find((player) => player.id === viewerPlayerId) ?? null;
    const legalPlays = me ? this.getLegalPlays(room, me.id) : [];
    const viewerIsCreator = this.isCreator(room, viewerPlayerId);

    return {
      roomName: room.name,
      maxPlayers: room.maxPlayers,
      status: room.status,
      botDifficulty: room.botDifficulty,
      botCount: room.botCount,
      score: room.score,
      players: [...room.players]
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((player) => ({
          id: player.id,
          name: player.name,
          seatIndex: player.seatIndex,
          connected: player.connected,
          isBot: player.isBot,
          handCount: player.hand.length,
        })),
      you: me
        ? {
            id: me.id,
            name: me.name,
            seatIndex: me.seatIndex,
            isCreator: viewerIsCreator,
            creatorToken: viewerIsCreator ? room.creatorToken : null,
            hand: me.hand,
          }
        : null,
      game: room.game
        ? {
            phase: room.game.phase,
            dealerSeat: room.game.dealerSeat,
            turnSeat: room.game.turnSeat,
            upcard: room.game.upcard,
            blockedSuit: room.game.blockedSuit,
            trump: room.game.trump,
            trickIndex: room.game.trickIndex,
            currentTrick: room.game.currentTrick.map((play) => {
              const player = room.players.find(
                (item) => item.id === play.playerId
              );
              return {
                playerId: play.playerId,
                playerName: player?.name ?? "Unknown",
                seatIndex: player?.seatIndex ?? -1,
                card: play.card,
              };
            }),
            completedTricks: room.game.completedTricks,
            handSummary: room.game.handSummary,
            makerTeam: room.game.makerTeam,
            calledByPlayerId: room.game.calledByPlayerId,
            goingAlonePlayerId: room.game.goingAlonePlayerId,
            sittingOutSeat: room.game.sittingOutSeat,
            calledByName:
              room.players.find(
                (player) => player.id === room.game?.calledByPlayerId
              )?.name ?? null,
            handNumber: room.game.handNumber,
          }
        : null,
      legalPlays,
      targetScore: TARGET_SCORE,
    };
  }

  sendToSocket(ws: WebSocket, payload: Record<string, unknown>) {
    ws.send(JSON.stringify(payload));
  }

  broadcastRoom(roomName: string) {
    const room = this.rooms.get(roomName);
    if (!room) {
      return;
    }

    this.sessions.forEach((session, ws) => {
      if (session.roomName !== roomName) {
        return;
      }

      const state = this.buildClientState(room, session.playerId);
      this.sendToSocket(ws, {
        type: "state",
        state,
      });
    });
  }

  sendInfo(roomName: string, message: string) {
    this.sessions.forEach((session, ws) => {
      if (session.roomName === roomName) {
        this.sendToSocket(ws, {
          type: "info",
          message,
        });
      }
    });
  }

  seatOrderFromDealer(dealerSeat: number) {
    const order: number[] = [];
    let seat = nextSeat(dealerSeat);
    for (let index = 0; index < ROOM_SIZE; index += 1) {
      order.push(seat);
      seat = nextSeat(seat);
    }
    return order;
  }

  getLegalPlays(room: EuchreRoom, playerId: string) {
    if (!room.game) {
      return [];
    }

    const player = room.players.find((item) => item.id === playerId);
    if (!player || room.game.turnSeat !== player.seatIndex) {
      return [];
    }

    if (!this.isPlayerActiveForPlay(room, player)) {
      return [];
    }

    if (room.game.phase === "dealer-discard") {
      return player.hand.map((card) => card.id);
    }

    if (room.game.phase !== "playing") {
      return [];
    }

    const { currentTrick, trump } = room.game;

    if (!trump || currentTrick.length === 0) {
      return player.hand.map((card) => card.id);
    }

    const leadSuit = effectiveSuit(currentTrick[0].card, trump);
    const followSuitCards = player.hand.filter(
      (card) => effectiveSuit(card, trump) === leadSuit
    );

    if (followSuitCards.length === 0) {
      return player.hand.map((card) => card.id);
    }

    return followSuitCards.map((card) => card.id);
  }

  getSeatPlayer(room: EuchreRoom, seatIndex: number) {
    return (
      room.players.find((player) => player.seatIndex === seatIndex) ?? null
    );
  }

  getPlayerById(room: EuchreRoom, playerId: string) {
    return room.players.find((player) => player.id === playerId) ?? null;
  }

  isSeatSittingOut(room: EuchreRoom, seatIndex: number) {
    const sittingOutSeat = room.game?.sittingOutSeat;
    if (sittingOutSeat === null || sittingOutSeat === undefined) {
      return false;
    }
    return sittingOutSeat === seatIndex;
  }

  isPlayerActiveForPlay(room: EuchreRoom, player: PlayerState) {
    if (!room.game || room.game.phase !== "playing") {
      return true;
    }
    return !this.isSeatSittingOut(room, player.seatIndex);
  }

  nextActiveSeat(room: EuchreRoom, fromSeat: number) {
    for (let index = 0; index < ROOM_SIZE; index += 1) {
      const seat = (fromSeat + index + 1) % ROOM_SIZE;
      if (!this.isSeatSittingOut(room, seat)) {
        return seat;
      }
    }
    return nextSeat(fromSeat);
  }

  activeSeatCountForPlay(room: EuchreRoom) {
    const sittingOutSeat = room.game?.sittingOutSeat;
    return sittingOutSeat === null || sittingOutSeat === undefined
      ? ROOM_SIZE
      : ROOM_SIZE - 1;
  }

  assertCreator(room: EuchreRoom, playerId: string) {
    if (room.creatorPlayerId !== playerId) {
      throw new Error("Only the room creator can do that.");
    }
  }

  startNewHand(room: EuchreRoom, dealerSeat?: number, resetScore = false) {
    if (room.players.length !== ROOM_SIZE) {
      return;
    }

    if (resetScore) {
      room.score = {
        team0: 0,
        team1: 0,
      };
    }

    const activeDealerSeat =
      dealerSeat ??
      room.game?.dealerSeat ??
      Math.floor(Math.random() * ROOM_SIZE);

    room.players.forEach((player) => {
      player.hand = [];
    });

    const shuffled = shuffleDeck(createDeck());
    room.players.forEach((player) => {
      player.hand = shuffled.splice(0, 5);
    });

    const upcard = shuffled.shift() ?? null;
    const kitty = shuffled;

    room.status = "playing";
    room.game = {
      phase: "bidding-round-1",
      dealerSeat: activeDealerSeat,
      turnSeat: nextSeat(activeDealerSeat),
      upcard,
      kitty,
      blockedSuit: null,
      trump: null,
      makerTeam: null,
      calledByPlayerId: null,
      goingAlonePlayerId: null,
      sittingOutSeat: null,
      currentTrick: [],
      completedTricks: [],
      trickIndex: 0,
      handSummary: null,
      handNumber: (room.game?.handNumber ?? 0) + 1,
    };
    room.updatedAt = Date.now();
  }

  startPlayingPhase(room: EuchreRoom) {
    const { game } = room;
    if (
      !game ||
      !game.trump ||
      game.makerTeam === null ||
      !game.calledByPlayerId
    ) {
      return;
    }

    game.phase = "playing";
    game.turnSeat = this.nextActiveSeat(room, game.dealerSeat);
    game.currentTrick = [];
    game.completedTricks = [];
    game.trickIndex = 0;
    game.handSummary = null;
    room.status = "playing";
    room.updatedAt = Date.now();
  }

  finalizeHand(room: EuchreRoom) {
    const { game } = room;
    if (!game || game.makerTeam === null) {
      return;
    }

    const { makerTeam } = game;
    const defenderTeam: TeamId = makerTeam === 0 ? 1 : 0;

    const makerTricks = game.completedTricks.filter(
      (trick) => getTeamForSeat(trick.winnerSeat) === makerTeam
    ).length;
    const defenderTricks = ROOM_SIZE + 1 - makerTricks;

    let awardedTo: TeamId;
    let pointsAwarded: number;

    if (makerTricks >= 3) {
      awardedTo = makerTeam;
      if (makerTricks === 5 && game.goingAlonePlayerId) {
        pointsAwarded = 4;
      } else {
        pointsAwarded = makerTricks === 5 ? 2 : 1;
      }
    } else {
      awardedTo = defenderTeam;
      pointsAwarded = 2;
    }

    const scoreKey = TEAM_TO_SCORE_KEY[awardedTo];
    room.score[scoreKey] += pointsAwarded;

    game.handSummary = {
      makerTeam,
      makerTricks,
      defenderTricks,
      pointsAwarded,
      awardedTo,
    };

    const winningTeam =
      room.score.team0 >= TARGET_SCORE
        ? 0
        : room.score.team1 >= TARGET_SCORE
          ? 1
          : null;

    game.phase = winningTeam === null ? "hand-over" : "game-over";
    const awardedLabel = awardedTo === 0 ? "A" : "B";
    if (winningTeam === null) {
      this.sendInfo(
        room.name,
        `Hand over: Team ${awardedLabel} earned ${pointsAwarded} point(s).`
      );
    } else {
      const winnerLabel = winningTeam === 0 ? "A" : "B";
      this.sendInfo(
        room.name,
        `Team ${winnerLabel} wins the match ${room.score.team0}-${room.score.team1}.`
      );
    }
    room.updatedAt = Date.now();
  }

  resolveTrickWinner(cards: TrickPlay[], trump: Suit) {
    const leadSuit = effectiveSuit(cards[0].card, trump);

    // oxlint-disable-next-line prefer-destructuring
    let winner = cards[0];
    let bestScore = rankStrength(cards[0].card, trump, leadSuit);

    cards.slice(1).forEach((play) => {
      const score = rankStrength(play.card, trump, leadSuit);
      if (score > bestScore) {
        winner = play;
        bestScore = score;
      }
    });

    return winner.playerId;
  }

  resolveTrickWinnerSeat(
    cards: {
      seatIndex: number;
      card: Card;
    }[],
    trump: Suit
  ) {
    const leadSuit = effectiveSuit(cards[0].card, trump);

    let winner = cards[0];
    let bestScore = rankStrength(cards[0].card, trump, leadSuit);

    cards.slice(1).forEach((play) => {
      const score = rankStrength(play.card, trump, leadSuit);
      if (score > bestScore) {
        winner = play;
        bestScore = score;
      }
    });

    return winner.seatIndex;
  }

  getLegalPlaysForCards(
    hand: Card[],
    currentTrick: { seatIndex: number; card: Card }[],
    trump: Suit
  ) {
    if (currentTrick.length === 0) {
      return [...hand];
    }

    const leadSuit = effectiveSuit(currentTrick[0].card, trump);
    const followSuitCards = hand.filter(
      (card) => effectiveSuit(card, trump) === leadSuit
    );

    if (followSuitCards.length === 0) {
      return [...hand];
    }

    return followSuitCards;
  }

  cardFaceKey(card: Card) {
    return `${card.suit}-${card.rank}`;
  }

  makeCardFromFace(face: string) {
    const [suit, rank] = face.split("-") as [Suit, Rank];
    return {
      id: `${face}-sim`,
      suit,
      rank,
    } satisfies Card;
  }

  inferVoidSuitsBySeat(room: EuchreRoom) {
    const result = new Map<number, Set<Suit>>();
    const trump = room.game?.trump;
    if (!trump) {
      return result;
    }

    const inspectTrick = (trick: TrickPlay[]) => {
      if (trick.length < 2) {
        return;
      }

      const leader = this.getPlayerById(room, trick[0].playerId);
      if (!leader) {
        return;
      }

      const leadSuit = effectiveSuit(trick[0].card, trump);
      trick.slice(1).forEach((play) => {
        const player = this.getPlayerById(room, play.playerId);
        if (!player) {
          return;
        }

        const playedSuit = effectiveSuit(play.card, trump);
        if (playedSuit === leadSuit) {
          return;
        }

        const missing = result.get(player.seatIndex) ?? new Set<Suit>();
        missing.add(leadSuit);
        result.set(player.seatIndex, missing);
      });
    };

    room.game?.completedTricks.forEach((trick) => inspectTrick(trick.cards));
    inspectTrick(room.game?.currentTrick ?? []);

    return result;
  }

  listAllCardFaces() {
    return SUITS.flatMap((suit) => RANKS.map((rank) => `${suit}-${rank}`));
  }

  buildVisibleFaceSet(room: EuchreRoom, botId: string) {
    const visibleFaces = new Set<string>();

    const bot = this.getPlayerById(room, botId);
    bot?.hand.forEach((card) => visibleFaces.add(this.cardFaceKey(card)));

    room.game?.completedTricks.forEach((trick) => {
      trick.cards.forEach((play) => visibleFaces.add(this.cardFaceKey(play.card)));
    });
    room.game?.currentTrick.forEach((play) =>
      visibleFaces.add(this.cardFaceKey(play.card))
    );

    return visibleFaces;
  }

  shuffleFaces(faces: string[]) {
    const shuffled = [...faces];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const temp = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = temp;
    }
    return shuffled;
  }

  assignFacesWithVoidConstraints(
    faces: string[],
    seats: number[],
    handSizesBySeat: Map<number, number>,
    voidSuitsBySeat: Map<number, Set<Suit>>
  ) {
    const assignment = new Map<number, string[]>();
    seats.forEach((seat) => assignment.set(seat, []));

    const available = this.shuffleFaces(faces);
    const pendingSeats = seats.filter((seat) => (handSizesBySeat.get(seat) ?? 0) > 0);

    let safety = 0;
    while (pendingSeats.length > 0 && safety < 200) {
      safety += 1;

      pendingSeats.sort(
        (left, right) =>
          (handSizesBySeat.get(right) ?? 0) - (handSizesBySeat.get(left) ?? 0)
      );
      const seat = pendingSeats[0];
      const need = handSizesBySeat.get(seat) ?? 0;
      if (need <= 0) {
        pendingSeats.shift();
        continue;
      }

      const banned = voidSuitsBySeat.get(seat) ?? new Set<Suit>();
      const candidateIndex = available.findIndex((face) => {
        const [suit] = face.split("-") as [Suit, Rank];
        return !banned.has(suit);
      });

      const pickedIndex = candidateIndex >= 0 ? candidateIndex : 0;
      const [picked] = available.splice(pickedIndex, 1);
      if (!picked) {
        break;
      }

      const cards = assignment.get(seat);
      if (!cards) {
        break;
      }
      cards.push(picked);
      handSizesBySeat.set(seat, need - 1);
    }

    return assignment;
  }

  buildSampledPlayState(room: EuchreRoom, bot: PlayerState) {
    const game = room.game;
    if (!game || !game.trump) {
      return null;
    }

    const botTeam = getTeamForSeat(bot.seatIndex);
    const allFaces = this.listAllCardFaces();
    const visibleFaces = this.buildVisibleFaceSet(room, bot.id);
    const unseenFaces = allFaces.filter((face) => !visibleFaces.has(face));

    const voidSuitsBySeat = this.inferVoidSuitsBySeat(room);
    const handsBySeat = new Map<number, Card[]>();
    const handSizesBySeat = new Map<number, number>();
    const opponentSeats: number[] = [];

    room.players.forEach((player) => {
      if (player.id === bot.id) {
        handsBySeat.set(player.seatIndex, [...player.hand]);
        return;
      }
      handSizesBySeat.set(player.seatIndex, player.hand.length);
      opponentSeats.push(player.seatIndex);
    });

    const faceAssignment = this.assignFacesWithVoidConstraints(
      unseenFaces,
      opponentSeats,
      new Map(handSizesBySeat),
      voidSuitsBySeat
    );

    opponentSeats.forEach((seat) => {
      const assignedFaces = faceAssignment.get(seat) ?? [];
      const cards = assignedFaces.map((face) => this.makeCardFromFace(face));
      handsBySeat.set(seat, cards);
    });

    const tricksByTeam = game.completedTricks.reduce(
      (accumulator, trick) => {
        const winnerTeam = getTeamForSeat(trick.winnerSeat);
        if (winnerTeam === 0) {
          accumulator.team0 += 1;
        } else {
          accumulator.team1 += 1;
        }
        return accumulator;
      },
      {
        team0: 0,
        team1: 0,
      }
    );

    return {
      state: {
        turnSeat: game.turnSeat,
        trump: game.trump,
        trickIndex: game.trickIndex,
        currentTrick: game.currentTrick.map((play) => ({
          seatIndex: this.getPlayerById(room, play.playerId)?.seatIndex ?? -1,
          card: play.card,
        })),
        handsBySeat,
        tricksByTeam,
      } satisfies SimulatedPlayState,
      botTeam,
    };
  }

  estimateCardValue(card: Card, trump: Suit) {
    const asLead = rankStrength(card, trump, card.suit);
    return asLead;
  }

  evaluateSimulatedState(state: SimulatedPlayState, botTeam: TeamId) {
    const trickDelta =
      botTeam === 0
        ? state.tricksByTeam.team0 - state.tricksByTeam.team1
        : state.tricksByTeam.team1 - state.tricksByTeam.team0;

    let handDelta = 0;
    state.handsBySeat.forEach((hand, seat) => {
      const team = getTeamForSeat(seat);
      const multiplier = team === botTeam ? 1 : -1;
      hand.forEach((card) => {
        handDelta += multiplier * this.estimateCardValue(card, state.trump);
      });
    });

    return trickDelta * 100 + handDelta * 0.1;
  }

  cloneSimulatedState(state: SimulatedPlayState): SimulatedPlayState {
    return {
      turnSeat: state.turnSeat,
      trump: state.trump,
      trickIndex: state.trickIndex,
      currentTrick: state.currentTrick.map((play) => ({
        seatIndex: play.seatIndex,
        card: play.card,
      })),
      handsBySeat: new Map(
        [...state.handsBySeat.entries()].map(([seat, hand]) => [seat, [...hand]])
      ),
      tricksByTeam: {
        team0: state.tricksByTeam.team0,
        team1: state.tricksByTeam.team1,
      },
    };
  }

  applySimulatedPlay(state: SimulatedPlayState, seat: number, card: Card) {
    const hand = state.handsBySeat.get(seat) ?? [];
    const index = hand.findIndex(
      (item) => item.id === card.id && item.suit === card.suit && item.rank === card.rank
    );
    if (index >= 0) {
      hand.splice(index, 1);
    }
    state.handsBySeat.set(seat, hand);

    state.currentTrick.push({
      seatIndex: seat,
      card,
    });

    if (state.currentTrick.length < ROOM_SIZE) {
      state.turnSeat = nextSeat(seat);
      return;
    }

    const winnerSeat = this.resolveTrickWinnerSeat(state.currentTrick, state.trump);
    const winnerTeam = getTeamForSeat(winnerSeat);
    if (winnerTeam === 0) {
      state.tricksByTeam.team0 += 1;
    } else {
      state.tricksByTeam.team1 += 1;
    }

    state.currentTrick = [];
    state.turnSeat = winnerSeat;
    state.trickIndex += 1;
  }

  minimaxPlay(
    state: SimulatedPlayState,
    depth: number,
    botTeam: TeamId,
    alpha: number,
    beta: number
  ): number {
    const totalTricks = state.tricksByTeam.team0 + state.tricksByTeam.team1;
    const anyCardsLeft = [...state.handsBySeat.values()].some((hand) => hand.length > 0);
    if (depth <= 0 || totalTricks >= 5 || !anyCardsLeft) {
      return this.evaluateSimulatedState(state, botTeam);
    }

    const seat = state.turnSeat;
    const hand = state.handsBySeat.get(seat) ?? [];
    const legalMoves = this.getLegalPlaysForCards(hand, state.currentTrick, state.trump);
    if (legalMoves.length === 0) {
      return this.evaluateSimulatedState(state, botTeam);
    }

    const maximizing = getTeamForSeat(seat) === botTeam;
    if (maximizing) {
      let value = Number.NEGATIVE_INFINITY;
      for (const move of legalMoves) {
        const nextState = this.cloneSimulatedState(state);
        this.applySimulatedPlay(nextState, seat, move);
        value = Math.max(
          value,
          this.minimaxPlay(nextState, depth - 1, botTeam, alpha, beta)
        );
        alpha = Math.max(alpha, value);
        if (beta <= alpha) {
          break;
        }
      }
      return value;
    }

    let value = Number.POSITIVE_INFINITY;
    for (const move of legalMoves) {
      const nextState = this.cloneSimulatedState(state);
      this.applySimulatedPlay(nextState, seat, move);
      value = Math.min(
        value,
        this.minimaxPlay(nextState, depth - 1, botTeam, alpha, beta)
      );
      beta = Math.min(beta, value);
      if (beta <= alpha) {
        break;
      }
    }
    return value;
  }

  chooseCardViaMinimax(
    room: EuchreRoom,
    bot: PlayerState,
    candidateCards: Card[],
    difficulty: BotDifficulty
  ) {
    const settings = DIFFICULTY_SETTINGS[difficulty];
    if (candidateCards.length === 0) {
      return null;
    }

    if (Math.random() < settings.randomMoveRate) {
      const randomIndex = Math.floor(Math.random() * candidateCards.length);
      return candidateCards[randomIndex] ?? null;
    }

    const scoreByCardId = new Map<string, number>();
    candidateCards.forEach((card) => scoreByCardId.set(card.id, 0));

    for (let sample = 0; sample < settings.sampleCount; sample += 1) {
      const sampled = this.buildSampledPlayState(room, bot);
      if (!sampled) {
        continue;
      }

      const baseState = sampled.state;
      const botTeam = sampled.botTeam;

      candidateCards.forEach((candidate) => {
        const nextState = this.cloneSimulatedState(baseState);
        this.applySimulatedPlay(nextState, bot.seatIndex, candidate);
        const score = this.minimaxPlay(
          nextState,
          settings.searchDepth - 1,
          botTeam,
          Number.NEGATIVE_INFINITY,
          Number.POSITIVE_INFINITY
        );
        scoreByCardId.set(
          candidate.id,
          (scoreByCardId.get(candidate.id) ?? 0) + score
        );
      });
    }

    let bestCard = candidateCards[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    candidateCards.forEach((card) => {
      const score = scoreByCardId.get(card.id) ?? Number.NEGATIVE_INFINITY;
      if (score > bestScore) {
        bestCard = card;
        bestScore = score;
      }
    });

    return bestCard;
  }

  estimateBidScoreViaMinimax(room: EuchreRoom, bot: PlayerState, trump: Suit) {
    const game = room.game;
    if (!game) {
      return Number.NEGATIVE_INFINITY;
    }

    const settings = DIFFICULTY_SETTINGS[room.botDifficulty];
    const original = {
      trump: game.trump,
      turnSeat: game.turnSeat,
      currentTrick: game.currentTrick,
      completedTricks: game.completedTricks,
      trickIndex: game.trickIndex,
    };

    game.trump = trump;
    game.turnSeat = nextSeat(game.dealerSeat);
    game.currentTrick = [];
    game.completedTricks = [];
    game.trickIndex = 0;

    let totalScore = 0;
    let samples = 0;
    const sampleCount = Math.max(2, Math.floor(settings.sampleCount / 2));

    for (let sample = 0; sample < sampleCount; sample += 1) {
      const sampled = this.buildSampledPlayState(room, bot);
      if (!sampled) {
        continue;
      }
      const score = this.minimaxPlay(
        sampled.state,
        settings.searchDepth,
        sampled.botTeam,
        Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY
      );
      totalScore += score;
      samples += 1;
    }

    game.trump = original.trump;
    game.turnSeat = original.turnSeat;
    game.currentTrick = original.currentTrick;
    game.completedTricks = original.completedTricks;
    game.trickIndex = original.trickIndex;

    if (samples === 0) {
      return 0;
    }

    return totalScore / samples;
  }

  chooseBidAction(room: EuchreRoom, bot: PlayerState): BotAction {
    const game = room.game;
    if (!game) {
      return { action: "pass" };
    }

    if (game.phase === "bidding-round-1") {
      const trump = game.upcard?.suit;
      if (!trump) {
        return { action: "pass" };
      }
      const strength = this.estimateBidScoreViaMinimax(room, bot, trump);
      const threshold = DIFFICULTY_SETTINGS[room.botDifficulty].bidThreshold;
      if (strength >= threshold) {
        return {
          action: "order-up",
          alone: strength >= threshold + 80,
        };
      }
      return { action: "pass" };
    }

    if (game.phase === "bidding-round-2") {
      const candidateSuits = SUITS.filter((suit) => suit !== game.blockedSuit);
      let bestSuit: Suit | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      candidateSuits.forEach((suit) => {
        const score = this.estimateBidScoreViaMinimax(room, bot, suit);
        if (score > bestScore) {
          bestScore = score;
          bestSuit = suit;
        }
      });

      if (!bestSuit) {
        return { action: "pass" };
      }

      const threshold = DIFFICULTY_SETTINGS[room.botDifficulty].bidThreshold;
      if (bestScore >= threshold) {
        return {
          action: "choose-trump",
          suit: bestSuit,
          alone: bestScore >= threshold + 80,
        };
      }

      return { action: "pass" };
    }

    return { action: "pass" };
  }

  chooseDiscardAction(room: EuchreRoom, bot: PlayerState): BotAction | null {
    if (!room.game?.trump) {
      return null;
    }
    const chosen = this.chooseCardViaMinimax(
      room,
      bot,
      [...bot.hand],
      room.botDifficulty
    );
    if (!chosen) {
      return null;
    }
    return {
      action: "discard",
      cardId: chosen.id,
    };
  }

  choosePlayAction(room: EuchreRoom, bot: PlayerState): BotAction | null {
    const legalPlayIds = this.getLegalPlays(room, bot.id);
    const legalCards = bot.hand.filter((card) => legalPlayIds.includes(card.id));
    if (legalCards.length === 0) {
      return null;
    }

    if (room.game?.goingAlonePlayerId) {
      return {
        action: "play-card",
        cardId: legalCards[0].id,
      };
    }

    const chosen = this.chooseCardViaMinimax(
      room,
      bot,
      legalCards,
      room.botDifficulty
    );

    return {
      action: "play-card",
      cardId: (chosen ?? legalCards[0]).id,
    };
  }

  chooseBotAction(room: EuchreRoom, bot: PlayerState): BotAction | null {
    const game = room.game;
    if (!game) {
      return null;
    }

    if (game.phase === "bidding-round-1" || game.phase === "bidding-round-2") {
      return this.chooseBidAction(room, bot);
    }

    if (game.phase === "dealer-discard") {
      return this.chooseDiscardAction(room, bot);
    }

    if (game.phase === "playing") {
      return this.choosePlayAction(room, bot);
    }

    if (game.phase === "hand-over") {
      return { action: "start-next-hand" };
    }

    if (game.phase === "game-over") {
      return null;
    }

    return null;
  }

  executeBotAction(room: EuchreRoom, bot: PlayerState, action: BotAction) {
    if (action.action === "pass") {
      this.handlePass(room, bot.id);
      return;
    }
    if (action.action === "order-up") {
      this.handleOrderUp(room, bot.id, Boolean(action.alone));
      return;
    }
    if (action.action === "choose-trump") {
      this.handleChooseTrump(room, bot.id, action.suit, Boolean(action.alone));
      return;
    }
    if (action.action === "discard") {
      this.handleDiscard(room, bot.id, action.cardId);
      return;
    }
    if (action.action === "play-card") {
      this.handlePlayCard(room, bot.id, action.cardId);
      return;
    }
    if (action.action === "start-next-hand") {
      this.handleStartNextHand(room);
      return;
    }
    if (action.action === "restart-match") {
      this.handleRestartMatch(room);
    }
  }

  handlePass(room: EuchreRoom, playerId: string) {
    const { game } = room;
    if (!game) {
      return;
    }

    const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error("Not your turn.");
    }

    if (game.phase === "bidding-round-1") {
      const turnAfterPass = nextSeat(game.turnSeat);
      if (turnAfterPass === nextSeat(game.dealerSeat)) {
        game.phase = "bidding-round-2";
        game.turnSeat = nextSeat(game.dealerSeat);
        game.blockedSuit = game.upcard?.suit ?? null;
        room.updatedAt = Date.now();
        return;
      }

      game.turnSeat = turnAfterPass;
      room.updatedAt = Date.now();
      return;
    }

    if (game.phase === "bidding-round-2") {
      const turnAfterPass = nextSeat(game.turnSeat);
      if (turnAfterPass === nextSeat(game.dealerSeat)) {
        this.sendInfo(
          room.name,
          "All players passed in round two. Redealing with next dealer."
        );
        this.startNewHand(room, nextSeat(game.dealerSeat));
        return;
      }

      game.turnSeat = turnAfterPass;
      room.updatedAt = Date.now();
      return;
    }

    throw new Error("Pass is not available right now.");
  }

  handleOrderUp(room: EuchreRoom, playerId: string, alone = false) {
    const { game } = room;
    if (!game || game.phase !== "bidding-round-1") {
      throw new Error("Order up is only available in bidding round one.");
    }

    const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error("Not your turn.");
    }

    if (!game.upcard) {
      throw new Error("Missing upcard.");
    }

    const dealer = this.getSeatPlayer(room, game.dealerSeat);
    if (!dealer) {
      throw new Error("Missing dealer.");
    }

    dealer.hand.push(game.upcard);
    game.phase = "dealer-discard";
    game.trump = game.upcard.suit;
    game.makerTeam = getTeamForSeat(currentPlayer.seatIndex);
    game.calledByPlayerId = playerId;
    game.goingAlonePlayerId = alone ? playerId : null;
    game.sittingOutSeat = alone
      ? room.players.find(
          (player) =>
            getTeamForSeat(player.seatIndex) === game.makerTeam &&
            player.id !== playerId
        )?.seatIndex ?? null
      : null;
    game.turnSeat = dealer.seatIndex;
    game.currentTrick = [];
    game.completedTricks = [];
    game.trickIndex = 0;
    this.sendInfo(
      room.name,
      `${currentPlayer.name} ordered up ${game.trump ? game.trump : "trump"}${alone ? " and is going alone." : "."}`
    );
    room.updatedAt = Date.now();
  }

  handleChooseTrump(
    room: EuchreRoom,
    playerId: string,
    suit: Suit | undefined,
    alone = false
  ) {
    const { game } = room;
    if (!game || game.phase !== "bidding-round-2") {
      throw new Error("Choose trump is only available in bidding round two.");
    }

    const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error("Not your turn.");
    }

    if (!suit) {
      throw new Error("Trump suit is required.");
    }

    if (game.blockedSuit === suit) {
      throw new Error("You cannot choose the turned-down suit.");
    }

    game.trump = suit;
    game.makerTeam = getTeamForSeat(currentPlayer.seatIndex);
    game.calledByPlayerId = playerId;
    game.goingAlonePlayerId = alone ? playerId : null;
    game.sittingOutSeat = alone
      ? room.players.find(
          (player) =>
            getTeamForSeat(player.seatIndex) === game.makerTeam &&
            player.id !== playerId
        )?.seatIndex ?? null
      : null;
    this.sendInfo(
      room.name,
      `${currentPlayer.name} called ${suit} as trump${alone ? " and is going alone." : "."}`
    );
    this.startPlayingPhase(room);
  }

  handleDiscard(room: EuchreRoom, playerId: string, cardId: string | undefined) {
    const { game } = room;
    if (!game || game.phase !== "dealer-discard") {
      throw new Error("Discard is only available after an order up.");
    }

    const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error("Only the dealer can discard now.");
    }

    if (!cardId) {
      throw new Error("Card id is required.");
    }

    const handIndex = currentPlayer.hand.findIndex((card) => card.id === cardId);
    if (handIndex === -1) {
      throw new Error("Card not found in your hand.");
    }

    currentPlayer.hand.splice(handIndex, 1);
    this.startPlayingPhase(room);
  }

  handlePlayCard(
    room: EuchreRoom,
    playerId: string,
    cardId: string | undefined
  ) {
    const { game } = room;
    if (!game || game.phase !== "playing") {
      throw new Error("Cards can only be played during the play phase.");
    }

    const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
    if (!currentPlayer || currentPlayer.id !== playerId) {
      throw new Error("Not your turn.");
    }
    if (!this.isPlayerActiveForPlay(room, currentPlayer)) {
      throw new Error("This player is sitting out this hand.");
    }

    if (!cardId) {
      throw new Error("Card id is required.");
    }

    const legalPlays = this.getLegalPlays(room, playerId);
    if (!legalPlays.includes(cardId)) {
      throw new Error("You must follow suit when possible.");
    }

    const handIndex = currentPlayer.hand.findIndex(
      (card) => card.id === cardId
    );
    if (handIndex === -1) {
      throw new Error("Card not found in your hand.");
    }

    const [card] = currentPlayer.hand.splice(handIndex, 1);
    game.currentTrick.push({ playerId, card });

    const requiredPlayers = this.activeSeatCountForPlay(room);
    if (game.currentTrick.length < requiredPlayers) {
      game.turnSeat = this.nextActiveSeat(room, game.turnSeat);
      room.updatedAt = Date.now();
      return;
    }

    if (!game.trump) {
      throw new Error("Missing trump suit.");
    }

    const winnerPlayerId = this.resolveTrickWinner(
      game.currentTrick,
      game.trump
    );
    const winner = room.players.find((player) => player.id === winnerPlayerId);
    if (!winner) {
      throw new Error("Unable to resolve trick winner.");
    }
    this.sendInfo(
      room.name,
      `${winner.name} won trick ${game.trickIndex + 1}.`
    );

    game.completedTricks.push({
      index: game.trickIndex,
      winnerSeat: winner.seatIndex,
      cards: [...game.currentTrick],
    });

    game.currentTrick = [];

    if (game.trickIndex >= 4) {
      this.finalizeHand(room);
      return;
    }

    game.trickIndex += 1;
    game.turnSeat = winner.seatIndex;
    room.updatedAt = Date.now();
  }

  handleStartNextHand(room: EuchreRoom) {
    if (!room.game || room.players.length !== ROOM_SIZE) {
      throw new Error("Need four players to start the next hand.");
    }

    if (room.game.phase !== "hand-over") {
      throw new Error("Next hand is only available after a hand ends.");
    }

    this.startNewHand(room, nextSeat(room.game.dealerSeat));
  }

  handleRestartMatch(room: EuchreRoom) {
    if (!room.game || room.players.length !== ROOM_SIZE) {
      throw new Error("Need four players to restart the match.");
    }

    if (room.game.phase !== "game-over") {
      throw new Error("Restart is only available when the match is over.");
    }

    this.startNewHand(room, nextSeat(room.game.dealerSeat), true);
  }

  nextBotName(room: EuchreRoom) {
    const existing = new Set(room.players.map((player) => player.name));
    for (let index = 0; index < 100; index += 1) {
      const base = BOT_NAMES[index % BOT_NAMES.length];
      const suffix = index >= BOT_NAMES.length ? ` ${Math.floor(index / BOT_NAMES.length) + 2}` : "";
      const name = `${base} Bot${suffix}`;
      if (!existing.has(name)) {
        return name;
      }
    }
    return `Bot ${crypto.randomUUID().slice(0, 6)}`;
  }

  handleAddBot(room: EuchreRoom, playerId: string) {
    this.assertCreator(room, playerId);
    if (room.status !== "waiting" || room.game !== null) {
      throw new Error("Bots can only be changed in lobby.");
    }
    if (room.players.length >= ROOM_SIZE) {
      throw new Error("Room is already full.");
    }

    const occupiedSeats = new Set(room.players.map((player) => player.seatIndex));
    const seatIndex = [...Array(ROOM_SIZE).keys()].find(
      (seat) => !occupiedSeats.has(seat)
    );
    if (seatIndex === undefined) {
      throw new Error("No seat available.");
    }

    room.players.push({
      id: crypto.randomUUID(),
      name: this.nextBotName(room),
      seatIndex,
      connected: true,
      isBot: true,
      hand: [],
    });
    room.botCount = room.players.filter((player) => player.isBot).length;
    room.updatedAt = Date.now();
  }

  handleRemoveBot(room: EuchreRoom, playerId: string) {
    this.assertCreator(room, playerId);
    if (room.status !== "waiting" || room.game !== null) {
      throw new Error("Bots can only be changed in lobby.");
    }
    const botCandidates = room.players
      .filter((player) => player.isBot)
      .sort((left, right) => right.seatIndex - left.seatIndex);
    const bot = botCandidates[0];
    if (!bot) {
      throw new Error("No bots to remove.");
    }
    room.players = room.players.filter((player) => player.id !== bot.id);
    room.botCount = room.players.filter((player) => player.isBot).length;
    room.updatedAt = Date.now();
  }

  handleSetSeat(
    room: EuchreRoom,
    playerId: string,
    targetPlayerId: string | undefined,
    requestedSeatIndex: number | undefined
  ) {
    this.assertCreator(room, playerId);
    if (room.status !== "waiting" || room.game !== null) {
      throw new Error("Teams can only be configured in lobby.");
    }
    if (!targetPlayerId) {
      throw new Error("Target player is required.");
    }
    const seatIndex = parseSeatIndex(requestedSeatIndex);
    if (seatIndex === null) {
      throw new Error("Invalid seat index.");
    }

    const target = this.getPlayerById(room, targetPlayerId);
    if (!target) {
      throw new Error("Target player not found.");
    }

    const occupant = this.getSeatPlayer(room, seatIndex);
    const currentSeat = target.seatIndex;
    target.seatIndex = seatIndex;
    if (occupant && occupant.id !== target.id) {
      occupant.seatIndex = currentSeat;
    }
    room.updatedAt = Date.now();
  }

  handleSetBotDifficulty(
    room: EuchreRoom,
    playerId: string,
    botDifficulty: BotDifficulty | undefined
  ) {
    this.assertCreator(room, playerId);
    if (room.status !== "waiting" || room.game !== null) {
      throw new Error("Difficulty can only be changed in lobby.");
    }
    if (!botDifficulty) {
      throw new Error("Bot difficulty is required.");
    }
    room.botDifficulty = botDifficulty;
    room.updatedAt = Date.now();
  }

  handleStartRoom(room: EuchreRoom, playerId: string) {
    this.assertCreator(room, playerId);
    if (room.status !== "waiting" || room.game !== null) {
      throw new Error("Room already started.");
    }
    if (room.players.length !== ROOM_SIZE) {
      throw new Error("Need exactly four players/bots before starting.");
    }
    this.startNewHand(room);
    this.sendInfo(room.name, "Room started. Hand 1 is starting.");
  }

  getBotThinkDelay(room: EuchreRoom) {
    if (room.botDifficulty === "easy") {
      return 1600;
    }
    if (room.botDifficulty === "medium") {
      return 1300;
    }
    return 1050;
  }

  getDisconnectedPlayerThinkDelay() {
    return 900;
  }

  getPostTrickPauseDelay(room: EuchreRoom) {
    return Math.max(this.getBotThinkDelay(room), 2300);
  }

  autoAdvanceOneTurn(room: EuchreRoom) {
    const { game } = room;
    if (!game) {
      return false;
    }

    if (game.phase === "game-over") {
      return false;
    }

    if (game.phase === "hand-over") {
      if (!room.players.some((player) => player.isBot)) {
        return false;
      }
      this.handleStartNextHand(room);
      return true;
    }

    const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
    if (!currentPlayer) {
      return false;
    }

    if (currentPlayer.isBot) {
      const botAction = this.chooseBotAction(room, currentPlayer);
      if (!botAction) {
        return false;
      }
      this.executeBotAction(room, currentPlayer, botAction);
      return true;
    }

    if (currentPlayer.connected) {
      return false;
    }

    if (game.phase === "bidding-round-1" || game.phase === "bidding-round-2") {
      this.handlePass(room, currentPlayer.id);
      return true;
    }

    if (game.phase === "dealer-discard") {
      const fallbackCardId = currentPlayer.hand[0]?.id;
      if (!fallbackCardId) {
        return false;
      }
      this.handleDiscard(room, currentPlayer.id, fallbackCardId);
      return true;
    }

    if (game.phase === "playing") {
      const legalPlays = this.getLegalPlays(room, currentPlayer.id);
      const [fallbackCardId] = legalPlays;
      if (!fallbackCardId) {
        return false;
      }
      this.handlePlayCard(room, currentPlayer.id, fallbackCardId);
      return true;
    }

    return false;
  }

  queueAutoAdvance(roomName: string) {
    if (this.autoAdvanceInFlight.has(roomName)) {
      return;
    }

    this.autoAdvanceInFlight.add(roomName);
    this.ctx.waitUntil(
      this.runAutoAdvance(roomName).finally(() => {
        this.autoAdvanceInFlight.delete(roomName);
      })
    );
  }

  getAutoActionDelayMs(room: EuchreRoom) {
    const game = room.game;
    if (!game || game.phase === "game-over") {
      return 0;
    }

    if (game.phase === "hand-over") {
      return room.players.some((player) => player.isBot) ? 3600 : 0;
    }

    const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
    if (!currentPlayer) {
      return 0;
    }

    const isAutomatedActor = currentPlayer.isBot || !currentPlayer.connected;
    if (!isAutomatedActor) {
      return 0;
    }

    // Keep the completed-trick reveal visible before the next automated action.
    if (
      game.phase === "playing" &&
      game.currentTrick.length === 0 &&
      game.completedTricks.length > 0
    ) {
      return this.getPostTrickPauseDelay(room);
    }

    if (currentPlayer.isBot) {
      return this.getBotThinkDelay(room);
    }

    return this.getDisconnectedPlayerThinkDelay();
  }

  async runAutoAdvance(roomName: string) {
    for (let index = 0; index < 64; index += 1) {
      const room = this.rooms.get(roomName);
      if (!room) {
        return;
      }

      const delayMs = this.getAutoActionDelayMs(room);
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      const acted = this.autoAdvanceOneTurn(room);
      if (!acted) {
        return;
      }

      await this.persistRooms();
      this.broadcastRoom(roomName);

      const phase = room.game?.phase;
      if (!phase || phase === "game-over") {
        return;
      }
    }
  }

  handleAction(room: EuchreRoom, playerId: string, message: ClientEnvelope) {
    if (message.type !== "action") {
      return;
    }

    if (message.action === "pass") {
      this.handlePass(room, playerId);
      return;
    }

    if (message.action === "order-up") {
      this.handleOrderUp(room, playerId, Boolean(message.alone));
      return;
    }

    if (message.action === "choose-trump") {
      this.handleChooseTrump(
        room,
        playerId,
        message.suit,
        Boolean(message.alone)
      );
      return;
    }

    if (message.action === "play-card") {
      this.handlePlayCard(room, playerId, message.cardId);
      return;
    }

    if (message.action === "discard") {
      this.handleDiscard(room, playerId, message.cardId);
      return;
    }

    if (message.action === "start-next-hand") {
      this.handleStartNextHand(room);
      return;
    }

    if (message.action === "restart-match") {
      this.handleRestartMatch(room);
      return;
    }

    if (message.action === "add-bot") {
      this.handleAddBot(room, playerId);
      return;
    }

    if (message.action === "remove-bot") {
      this.handleRemoveBot(room, playerId);
      return;
    }

    if (message.action === "set-seat") {
      this.handleSetSeat(room, playerId, message.targetPlayerId, message.seatIndex);
      return;
    }

    if (message.action === "set-bot-difficulty") {
      this.handleSetBotDifficulty(room, playerId, message.botDifficulty);
      return;
    }

    if (message.action === "start-room") {
      this.handleStartRoom(room, playerId);
      return;
    }

    throw new Error("Unsupported action.");
  }

  async connectToRoom(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomName = sanitizeRoomName(url.searchParams.get("room"));
    const playerName = sanitizePlayerName(url.searchParams.get("name"));
    const password = (url.searchParams.get("password") ?? "").trim();
    const createRoom = url.searchParams.get("create") === "1";
    const requestedBotDifficulty = parseBotDifficulty(
      url.searchParams.get("botDifficulty")
    );
    const providedCreatorToken =
      (url.searchParams.get("creatorToken") ?? "").trim() ||
      (request.headers.get(CREATOR_TOKEN_HEADER) ?? "").trim();

    if (!roomName) {
      return jsonResponse(
        {
          error: "Room name is required.",
        },
        { status: 400 }
      );
    }

    if (!playerName) {
      return jsonResponse(
        {
          error: "Player name is required.",
        },
        { status: 400 }
      );
    }

    const existingRoom = this.rooms.get(roomName);

    if (
      createRoom &&
      existingRoom &&
      (!providedCreatorToken || providedCreatorToken !== existingRoom.creatorToken)
    ) {
      return jsonResponse(
        {
          error: "Room already exists. Join it instead.",
        },
        { status: 409 }
      );
    }

    if (!existingRoom && !createRoom) {
      return jsonResponse(
        {
          error: "Room not found. Create it first.",
        },
        { status: 404 }
      );
    }

    const room: EuchreRoom = existingRoom ?? {
      name: roomName,
      password: password || null,
      creatorToken: providedCreatorToken || crypto.randomUUID(),
      creatorPlayerId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxPlayers: ROOM_SIZE,
      status: "waiting",
      botDifficulty: requestedBotDifficulty ?? "medium",
      botCount: 0,
      score: {
        team0: 0,
        team1: 0,
      },
      players: [],
      game: null,
    };

    if (room.password && room.password !== password) {
      return jsonResponse(
        {
          error: "Incorrect room password.",
        },
        { status: 403 }
      );
    }

    const existingPlayer = room.players.find(
      (player) => player.name.toLowerCase() === playerName.toLowerCase()
    );

    let playerId: string;
    if (existingPlayer) {
      if (existingPlayer.isBot) {
        return jsonResponse(
          {
            error: "That player name is reserved.",
          },
          { status: 409 }
        );
      }
      if (existingPlayer.connected) {
        return jsonResponse(
          {
            error: "Player name is already taken in this room.",
          },
          { status: 409 }
        );
      }

      existingPlayer.connected = true;
      playerId = existingPlayer.id;
    } else {
      if (room.players.length >= room.maxPlayers) {
        return jsonResponse(
          {
            error: "Room is full.",
          },
          { status: 409 }
        );
      }

      const occupiedSeats = new Set(
        room.players.map((player) => player.seatIndex)
      );
      const seatIndex = [...Array(ROOM_SIZE).keys()].find(
        (seat) => !occupiedSeats.has(seat)
      );

      if (seatIndex === undefined) {
        return jsonResponse(
          {
            error: "No seat available.",
          },
          { status: 409 }
        );
      }

      playerId = crypto.randomUUID();
      room.players.push({
        id: playerId,
        name: playerName,
        seatIndex,
        connected: true,
        isBot: false,
        hand: [],
      });
    }

    room.updatedAt = Date.now();
    this.rooms.set(roomName, room);

    if (!existingRoom) {
      room.creatorPlayerId = playerId;
      if (!providedCreatorToken) {
        room.creatorToken = crypto.randomUUID();
      }
    } else if (providedCreatorToken && providedCreatorToken === room.creatorToken) {
      room.creatorPlayerId = playerId;
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.ctx.acceptWebSocket(server);

    const sessionId = crypto.randomUUID();
    const attachment: SessionAttachment = {
      sessionId,
      roomName,
      playerId,
    };

    server.serializeAttachment(attachment);
    this.sessions.set(server, attachment);

    await this.persistRooms();
    this.broadcastRoom(roomName);
    this.queueAutoAdvance(roomName);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async deleteRoom(roomName: string, creatorToken: string) {
    const room = this.rooms.get(roomName);
    if (!room) {
      return jsonResponse(
        {
          error: "Room not found.",
        },
        { status: 404 }
      );
    }

    if (!creatorToken || creatorToken !== room.creatorToken) {
      return jsonResponse(
        {
          error: "Only the room creator can delete this room.",
        },
        { status: 403 }
      );
    }

    this.rooms.delete(roomName);
    this.sessions.forEach((session, ws) => {
      if (session.roomName === roomName) {
        ws.close(1001, "Room deleted by creator");
      }
    });
    await this.persistRooms();

    return jsonResponse({
      ok: true,
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    await this.pruneExpiredRooms();

    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const corsHeaders = buildCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (url.pathname === "/rooms") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: corsHeaders,
        });
      }

      return jsonResponse(
        { rooms: this.listRooms() },
        { headers: corsHeaders }
      );
    }

    if (url.pathname.startsWith("/rooms/")) {
      if (request.method !== "DELETE") {
        return new Response("Method not allowed", {
          status: 405,
          headers: corsHeaders,
        });
      }
      const roomName = sanitizeRoomName(
        decodeURIComponent(url.pathname.slice("/rooms/".length))
      );
      if (!roomName) {
        return jsonResponse(
          {
            error: "Room name is required.",
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      const creatorToken =
        (url.searchParams.get("creatorToken") ?? "").trim() ||
        (request.headers.get(CREATOR_TOKEN_HEADER) ?? "").trim();
      const response = await this.deleteRoom(roomName, creatorToken);
      const existingHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        existingHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        headers: existingHeaders,
      });
    }

    if (url.pathname === "/websocket") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Worker expected Upgrade: websocket", {
          status: 426,
          headers: corsHeaders,
        });
      }

      if (request.method !== "GET") {
        return new Response("Worker expected GET method", {
          status: 400,
          headers: corsHeaders,
        });
      }

      return this.connectToRoom(request);
    }

    return new Response(
      "Supported endpoints:\n/rooms\nDELETE /rooms/<room>?creatorToken=<token>\n/websocket?room=<room>&name=<name>&password=<optional>&create=1&creatorToken=<optional>&botDifficulty=<easy|medium|hard>",
      {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
          ...corsHeaders,
        },
      }
    );
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    await this.pruneExpiredRooms();

    const session = this.sessions.get(ws);
    if (!session) {
      ws.close(1008, "Missing session");
      return;
    }

    const room = this.rooms.get(session.roomName);
    if (!room) {
      ws.close(1008, "Room missing");
      return;
    }

    let payload: ClientEnvelope;
    try {
      payload = JSON.parse(String(message)) as ClientEnvelope;
    } catch {
      this.sendToSocket(ws, {
        type: "error",
        message: "Invalid message format.",
      });
      return;
    }

    if (payload.type === "ping") {
      this.sendToSocket(ws, {
        type: "pong",
      });
      return;
    }

    try {
      this.handleAction(room, session.playerId, payload);
      await this.persistRooms();
      this.broadcastRoom(session.roomName);
      this.queueAutoAdvance(session.roomName);
    } catch (error) {
      this.sendToSocket(ws, {
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to process requested action.",
      });
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);

    if (!session) {
      return;
    }

    const room = this.rooms.get(session.roomName);
    if (!room) {
      return;
    }

    const player = this.getPlayerById(room, session.playerId);
    if (player) {
      player.connected = false;
    }

    room.updatedAt = Date.now();

    await this.persistRooms();
    this.broadcastRoom(room.name);
    this.queueAutoAdvance(room.name);
  }
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const stub =
      env.WEBSOCKET_HIBERNATION_SERVER.getByName("euchre-multiplayer");
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
