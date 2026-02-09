import { Link, createFileRoute } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CODENAMES_WORD_POOL } from "@/lib/codenames-word-pool";
import { cn } from "@/lib/utils";

type Team = "red" | "blue";
type Role = Team | "neutral" | "assassin";
type Phase = "setup" | "set-number" | "guess" | "done";

type CodenamesCard = {
  id: number;
  word: string;
  role: Role;
  revealed: boolean;
};

type GameState = {
  board: CodenamesCard[];
  startingTeam: Team;
  currentTeam: Team;
  phase: Phase;
  guessesRemaining: number | null;
  winner: Team | null;
  lastResult: string;
  turnStartedAt: number | null;
  teamTimerStartedAt: number | null;
  teamTimerLastTickAt: number | null;
  teamSecondsRemaining: Record<Team, number>;
};

const TEAM_LABEL: Record<Role, string> = {
  red: "Red",
  blue: "Blue",
  neutral: "Neutral",
  assassin: "Assassin",
};

const DEFAULT_TEAM_SECONDS = 10 * 60;

function shuffle<T>(items: readonly T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function otherTeam(team: Team): Team {
  return team === "red" ? "blue" : "red";
}

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function countUnrevealed(board: CodenamesCard[], role: Team) {
  return board.reduce(
    (count, card) => count + (!card.revealed && card.role === role ? 1 : 0),
    0
  );
}

function createBoard(startingTeam: Team): CodenamesCard[] {
  const words = shuffle(CODENAMES_WORD_POOL).slice(0, 25);
  const roles = [
    ...Array(startingTeam === "red" ? 9 : 8).fill("red"),
    ...Array(startingTeam === "blue" ? 9 : 8).fill("blue"),
    ...Array(7).fill("neutral"),
    "assassin",
  ] as Role[];

  const shuffledRoles = shuffle(roles);

  return words.map((word, index) => ({
    id: index,
    word,
    role: shuffledRoles[index],
    revealed: false,
  }));
}

function createInitialGame(): GameState {
  const startingTeam = Math.random() < 0.5 ? "red" : "blue";
  return {
    board: createBoard(startingTeam),
    startingTeam,
    currentTeam: startingTeam,
    phase: "setup",
    guessesRemaining: null,
    winner: null,
    lastResult:
      "Spymasters: switch on eye-close mode, take a key photo, then start presenter mode.",
    turnStartedAt: null,
    teamTimerStartedAt: null,
    teamTimerLastTickAt: null,
    teamSecondsRemaining: {
      red: DEFAULT_TEAM_SECONDS,
      blue: DEFAULT_TEAM_SECONDS,
    },
  };
}

function cardClasses(card: CodenamesCard, showKey: boolean) {
  if (card.revealed || (showKey && !card.revealed)) {
    const { role } = card;
    return cn(
      "text-primary-foreground border-transparent",
      role === "red" && "bg-[#d84f4f]",
      role === "blue" && "bg-[#4b80d8]",
      role === "neutral" && "bg-[#c8bc9f] text-[#2b2a26]",
      role === "assassin" && "bg-[#202020]"
    );
  }

  return "bg-gradient-to-b from-[#f7e7c6] to-[#e4cc99] text-[#2d2418] border-[#6f5c43]";
}

const BoardCard = memo(function BoardCard({
  card,
  showKey,
  disabled,
  onSelect,
}: {
  card: CodenamesCard;
  showKey: boolean;
  disabled: boolean;
  onSelect: (cardId: number) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled || card.revealed}
      onClick={() => onSelect(card.id)}
      className={cn(
        "h-full w-full rounded-xl border-2 p-2 text-center text-xs leading-tight font-bold tracking-wide uppercase sm:text-sm",
        cardClasses(card, showKey)
      )}
    >
      {card.word}
    </Button>
  );
});

function CodenamesRoute() {
  const [game, setGame] = useState<GameState>(() => createInitialGame());
  const [teamMinutesInput, setTeamMinutesInput] = useState("10");
  const [eyesClosedConfirmed, setEyesClosedConfirmed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  const unrevealedRed = useMemo(
    () => countUnrevealed(game.board, "red"),
    [game.board]
  );
  const unrevealedBlue = useMemo(
    () => countUnrevealed(game.board, "blue"),
    [game.board]
  );

  const showKey = game.phase === "setup" && eyesClosedConfirmed;
  const timersStarted = Boolean(game.teamTimerStartedAt);
  const canGuess = game.phase === "guess" && !game.winner && timersStarted;
  const turnIsActive = game.phase === "set-number" || game.phase === "guess";
  const teamTimerIsActive = timersStarted && turnIsActive && !game.winner;
  const elapsedSeconds =
    game.turnStartedAt && turnIsActive
      ? Math.floor((nowMs - game.turnStartedAt) / 1000)
      : 0;

  const phaseLabel =
    game.phase === "setup"
      ? "Spymaster Photo Mode"
      : game.phase === "set-number"
        ? "Set Guess Number"
        : game.phase === "guess"
          ? "Guessing"
          : "Game Over";

  useEffect(() => {
    if ((!turnIsActive || !game.turnStartedAt) && !teamTimerIsActive) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [turnIsActive, game.turnStartedAt, teamTimerIsActive]);

  useEffect(() => {
    if (!teamTimerIsActive) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setGame((current) => {
        if (
          !current.teamTimerStartedAt ||
          current.winner ||
          current.phase === "setup" ||
          current.phase === "done"
        ) {
          return current;
        }

        const now = Date.now();
        const elapsed = Math.floor(
          (now - (current.teamTimerLastTickAt ?? now)) / 1000
        );
        if (elapsed <= 0) {
          return current;
        }

        const activeTeam = current.currentTeam;
        const remaining = current.teamSecondsRemaining[activeTeam];
        const nextRemaining = Math.max(0, remaining - elapsed);

        const nextState: GameState = {
          ...current,
          teamSecondsRemaining: {
            ...current.teamSecondsRemaining,
            [activeTeam]: nextRemaining,
          },
          teamTimerLastTickAt:
            (current.teamTimerLastTickAt ?? now) + elapsed * 1000,
        };

        if (nextRemaining > 0) {
          return nextState;
        }

        const winningTeam = otherTeam(activeTeam);
        return {
          ...nextState,
          phase: "done",
          guessesRemaining: null,
          winner: winningTeam,
          lastResult: `${TEAM_LABEL[activeTeam]} team ran out of time. ${TEAM_LABEL[winningTeam]} wins.`,
        };
      });
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [teamTimerIsActive]);

  function startNewGame() {
    setGame(createInitialGame());
    setTeamMinutesInput("10");
    setEyesClosedConfirmed(false);
  }

  function startTeamTimers() {
    const requestedMinutes = Number(teamMinutesInput);
    if (Number.isNaN(requestedMinutes) || requestedMinutes <= 0) {
      return;
    }

    setGame((current) => {
      if (
        current.teamTimerStartedAt ||
        current.phase === "setup" ||
        current.winner
      ) {
        return current;
      }

      const seconds = Math.floor(requestedMinutes * 60);
      return {
        ...current,
        teamTimerStartedAt: Date.now(),
        teamTimerLastTickAt: Date.now(),
        teamSecondsRemaining: {
          red: seconds,
          blue: seconds,
        },
        lastResult: `Team timers started at ${Math.floor(requestedMinutes)} minute${Math.floor(requestedMinutes) === 1 ? "" : "s"} per team.`,
      };
    });
  }

  function beginPresenterMode() {
    setGame((current) => {
      if (current.phase !== "setup") {
        return current;
      }
      return {
        ...current,
        phase: "set-number",
        lastResult: `Presenter mode started. ${TEAM_LABEL[current.currentTeam]} sets a guess number.`,
        turnStartedAt: Date.now(),
      };
    });
    setEyesClosedConfirmed(false);
  }

  function startGuessRound(number: number) {
    if (game.phase !== "set-number" || game.winner) {
      return;
    }

    if (!game.teamTimerStartedAt) {
      setGame((current) => ({
        ...current,
        lastResult: "Start team timers before starting guesses.",
      }));
      return;
    }

    const count = Number(number);
    if (Number.isNaN(count) || count < 1) {
      return;
    }

    setGame((current) => ({
      ...current,
      guessesRemaining: count + 1,
      phase: "guess",
      lastResult: `${TEAM_LABEL[current.currentTeam]} has ${count + 1} total guesses (${count} + 1 extra).`,
    }));
  }

  function advanceTurn(state: GameState, message: string): GameState {
    return {
      ...state,
      currentTeam: otherTeam(state.currentTeam),
      phase: "set-number",
      guessesRemaining: null,
      lastResult: message,
      turnStartedAt: Date.now(),
      teamTimerLastTickAt: state.teamTimerStartedAt
        ? Date.now()
        : state.teamTimerLastTickAt,
    };
  }

  function pickCard(cardId: number) {
    setGame((current) => {
      if (current.winner || current.phase !== "guess") {
        return current;
      }

      const card = current.board[cardId];
      if (!card || card.revealed) {
        return current;
      }

      const confirmed = window.confirm(`Confirm guess: ${card.word}?`);
      if (!confirmed) {
        return current;
      }

      const nextBoard = current.board.map((item) =>
        item.id === cardId ? { ...item, revealed: true } : item
      );
      const redRemaining = countUnrevealed(nextBoard, "red");
      const blueRemaining = countUnrevealed(nextBoard, "blue");

      if (card.role === "assassin") {
        return {
          ...current,
          board: nextBoard,
          winner: otherTeam(current.currentTeam),
          phase: "done",
          guessesRemaining: null,
          lastResult: `${TEAM_LABEL[current.currentTeam]} picked the Assassin. ${TEAM_LABEL[otherTeam(current.currentTeam)]} wins.`,
        };
      }

      if (redRemaining === 0) {
        return {
          ...current,
          board: nextBoard,
          winner: "red",
          phase: "done",
          guessesRemaining: null,
          lastResult: "Red team found all their words and wins.",
        };
      }

      if (blueRemaining === 0) {
        return {
          ...current,
          board: nextBoard,
          winner: "blue",
          phase: "done",
          guessesRemaining: null,
          lastResult: "Blue team found all their words and wins.",
        };
      }

      if (card.role !== current.currentTeam) {
        return advanceTurn(
          { ...current, board: nextBoard },
          `Wrong guess: ${card.word} is ${TEAM_LABEL[card.role].toLowerCase()}. Turn passes.`
        );
      }

      const remainingGuesses = (current.guessesRemaining ?? 1) - 1;
      if (remainingGuesses <= 0) {
        return advanceTurn(
          { ...current, board: nextBoard },
          `Correct: ${card.word}. No guesses left, turn passes.`
        );
      }

      return {
        ...current,
        board: nextBoard,
        guessesRemaining: remainingGuesses,
        lastResult: `Correct: ${card.word}. ${remainingGuesses} guess${remainingGuesses === 1 ? "" : "es"} left.`,
      };
    });
  }

  function endGuessing() {
    setGame((current) => {
      if (current.phase !== "guess" || current.winner) {
        return current;
      }
      return advanceTurn(
        current,
        `${TEAM_LABEL[current.currentTeam]} team ended guessing. Turn passes.`
      );
    });
  }

  return (
    <>
      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Codenames UI quick guide</DialogTitle>
            <DialogDescription>
              This is only a quick UI guide.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              In setup, turn on eye-close mode and let spymasters take a photo
              of the key.
            </li>
            <li>Click Start Presenter Mode to hide the key.</li>
            <li>Set the guess number, then click Start Guessing.</li>
            <li>Click cards to reveal. Use End Guessing to pass the turn.</li>
          </ol>
          <DialogFooter>
            <DialogClose render={<Button />}>OK</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="mx-auto grid h-[95vh] w-full max-w-350 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <aside className="bg-game-surface-1 border-border rounded-4xl border p-4 shadow-game-card min-h-0 overflow-y-auto">
          <header className="mb-4 grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-semibold">Codenames Presenter</h1>
              <Link to="/">
                <Button variant="outline" size="sm">
                  Back
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={beginPresenterMode}
                disabled={game.phase !== "setup"}
              >
                Start Presenter Mode
              </Button>
              <Button variant="secondary" onClick={startNewGame}>
                New Game
              </Button>
              <Button
                variant="outline"
                onClick={() => setInstructionsOpen(true)}
              >
                Show Instructions
              </Button>
            </div>
          </header>

          <section className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-[#c93a3a] p-3 text-white">
              <strong className="block text-sm">Red Team</strong>
              <span className="text-2xl font-extrabold">{unrevealedRed}</span>
              <small className="block">
                Time left: {formatElapsed(game.teamSecondsRemaining.red)}
              </small>
            </div>
            <div className="rounded-2xl bg-[#356fcb] p-3 text-white">
              <strong className="block text-sm">Blue Team</strong>
              <span className="text-2xl font-extrabold">{unrevealedBlue}</span>
              <small className="block">
                Time left: {formatElapsed(game.teamSecondsRemaining.blue)}
              </small>
            </div>
          </section>

          <section className="bg-background/70 border-border mb-3 grid gap-2 rounded-2xl border p-3 text-sm">
            <p>
              <strong>Turn:</strong>{" "}
              <span
                className={cn(
                  "font-semibold",
                  game.currentTeam === "red"
                    ? "text-[#8e1f1f]"
                    : "text-[#1b4f98]"
                )}
              >
                {TEAM_LABEL[game.currentTeam]}
              </span>{" "}
              ({phaseLabel})
            </p>
            {!game.teamTimerStartedAt &&
            game.phase !== "setup" &&
            !game.winner ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="grid gap-1">
                  <span className="text-xs font-medium">Minutes Per Team</span>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={teamMinutesInput}
                    onChange={(event) =>
                      setTeamMinutesInput(event.target.value)
                    }
                    className="border-input bg-background h-9 rounded-xl border px-3"
                  />
                </label>
                <Button onClick={startTeamTimers}>Start Timers</Button>
              </div>
            ) : null}
            <p>
              <strong>Turn Time:</strong> {formatElapsed(elapsedSeconds)}
            </p>
            <p>
              <strong>Guesses left:</strong>{" "}
              {game.phase === "guess" && game.guessesRemaining !== null
                ? game.guessesRemaining
                : "-"}
            </p>
            <p aria-live="polite">
              <strong>Result:</strong> {game.lastResult}
            </p>
            {game.winner ? (
              <p
                className={cn(
                  "font-semibold",
                  game.winner === "red" ? "text-[#8e1f1f]" : "text-[#1b4f98]"
                )}
              >
                Winner: {TEAM_LABEL[game.winner]} Team
              </p>
            ) : null}
          </section>

          {game.phase === "set-number" && !game.winner ? (
            <section className="bg-background/70 border-border mb-3 grid gap-2 rounded-2xl border p-3">
              <strong className="text-sm">Guess Number</strong>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
                  <Button
                    key={number}
                    variant="outline"
                    onClick={() => startGuessRound(number)}
                    disabled={!timersStarted}
                  >
                    {number}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}

          {game.phase === "setup" ? (
            <section className="bg-background/70 border-border mb-3 grid gap-2 rounded-2xl border p-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={eyesClosedConfirmed}
                  onChange={(event) =>
                    setEyesClosedConfirmed(event.target.checked)
                  }
                />
                Everyone closed eyes (show spymaster colors)
              </label>
              <p className="text-muted-foreground">
                Toggle off to hide colors before entering presenter mode.
              </p>
            </section>
          ) : null}

          {game.phase === "guess" && !game.winner ? (
            <section className="flex items-center gap-2">
              <Button variant="outline" onClick={endGuessing}>
                End Guessing
              </Button>
              <p className="text-muted-foreground text-sm">
                Each guess asks for confirmation.
              </p>
            </section>
          ) : null}
        </aside>

        <section className="bg-game-surface-1 border-border rounded-4xl border p-3 shadow-game-card min-h-0">
          <div className="grid h-full grid-cols-5 grid-rows-5 gap-2">
            {game.board.map((card) => (
              <BoardCard
                key={card.id}
                card={card}
                showKey={showKey}
                disabled={!canGuess}
                onSelect={pickCard}
              />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

export const Route = createFileRoute("/games/codenames")({
  component: CodenamesRoute,
});
