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
  currentTrick: TrickPlay[];
  completedTricks: CompletedTrick[];
  trickIndex: number;
  handSummary: HandSummary | null;
  handNumber: number;
};

type EuchreRoom = {
  name: string;
  password: string | null;
  createdAt: number;
  updatedAt: number;
  maxPlayers: number;
  status: "waiting" | "playing";
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
        | "restart-match";
      suit?: Suit;
      cardId?: string;
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

function buildCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.sessions = new Map();
    this.rooms = new Map();

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
      room.players.forEach((player) => {
        player.connected = false;
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

  listRooms() {
    return [...this.rooms.values()]
      .map((room) => ({
        name: room.name,
        players: room.players.length,
        maxPlayers: room.maxPlayers,
        hasPassword: Boolean(room.password),
        status: room.status,
        createdAt: room.createdAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  buildClientState(room: EuchreRoom, viewerPlayerId: string) {
    const me =
      room.players.find((player) => player.id === viewerPlayerId) ?? null;
    const legalPlays = me ? this.getLegalPlays(room, me.id) : [];

    return {
      roomName: room.name,
      maxPlayers: room.maxPlayers,
      status: room.status,
      score: room.score,
      players: [...room.players]
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((player) => ({
          id: player.id,
          name: player.name,
          seatIndex: player.seatIndex,
          connected: player.connected,
          handCount: player.hand.length,
        })),
      you: me
        ? {
            id: me.id,
            name: me.name,
            seatIndex: me.seatIndex,
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
    game.turnSeat = nextSeat(game.dealerSeat);
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
      pointsAwarded = makerTricks === 5 ? 2 : 1;
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

  handleOrderUp(room: EuchreRoom, playerId: string) {
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
    game.turnSeat = dealer.seatIndex;
    game.currentTrick = [];
    game.completedTricks = [];
    game.trickIndex = 0;
    room.updatedAt = Date.now();
  }

  handleChooseTrump(
    room: EuchreRoom,
    playerId: string,
    suit: Suit | undefined
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

    if (game.currentTrick.length < ROOM_SIZE) {
      game.turnSeat = nextSeat(game.turnSeat);
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

  autoAdvanceDisconnectedTurn(room: EuchreRoom) {
    const { game } = room;
    if (!game) {
      return;
    }

    // Avoid infinite loops if the state is malformed.
    for (let index = 0; index < 32; index += 1) {
      const currentPlayer = this.getSeatPlayer(room, game.turnSeat);
      if (!currentPlayer || currentPlayer.connected) {
        return;
      }

      if (game.phase === "bidding-round-1" || game.phase === "bidding-round-2") {
        this.handlePass(room, currentPlayer.id);
        continue;
      }

      if (game.phase === "dealer-discard") {
        const fallbackCardId = currentPlayer.hand[0]?.id;
        if (!fallbackCardId) {
          return;
        }
        this.handleDiscard(room, currentPlayer.id, fallbackCardId);
        continue;
      }

      if (game.phase === "playing") {
        const legalPlays = this.getLegalPlays(room, currentPlayer.id);
        const [fallbackCardId] = legalPlays;
        if (!fallbackCardId) {
          return;
        }
        this.handlePlayCard(room, currentPlayer.id, fallbackCardId);
        continue;
      }

      return;
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
      this.handleOrderUp(room, playerId);
      return;
    }

    if (message.action === "choose-trump") {
      this.handleChooseTrump(room, playerId, message.suit);
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

    throw new Error("Unsupported action.");
  }

  async connectToRoom(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomName = sanitizeRoomName(url.searchParams.get("room"));
    const playerName = sanitizePlayerName(url.searchParams.get("name"));
    const password = (url.searchParams.get("password") ?? "").trim();
    const createRoom = url.searchParams.get("create") === "1";

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

    if (createRoom && existingRoom) {
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxPlayers: ROOM_SIZE,
      status: "waiting",
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
        hand: [],
      });
    }

    room.updatedAt = Date.now();
    this.rooms.set(roomName, room);

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

    if (room.players.length === ROOM_SIZE && room.game === null) {
      this.startNewHand(room);
      this.sendInfo(roomName, "All four players joined. Hand 1 is starting.");
    }

    this.autoAdvanceDisconnectedTurn(room);

    await this.persistRooms();
    this.broadcastRoom(roomName);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;

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
      "Supported endpoints:\n/rooms\n/websocket?room=<room>&name=<name>&password=<optional>&create=1",
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
      this.autoAdvanceDisconnectedTurn(room);
      await this.persistRooms();
      this.broadcastRoom(session.roomName);
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
    this.autoAdvanceDisconnectedTurn(room);

    await this.persistRooms();
    this.sendInfo(room.name, "A player disconnected. Their seat is reserved.");
    this.broadcastRoom(room.name);
  }
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const stub =
      env.WEBSOCKET_HIBERNATION_SERVER.getByName("euchre-multiplayer");
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
