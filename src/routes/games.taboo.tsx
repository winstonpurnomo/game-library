import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

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
import { TABOO_CARDS } from "@/lib/taboo-cards";
import { cn } from "@/lib/utils";

type Team = "red" | "blue";

const TEAM_LABEL: Record<Team, string> = {
  red: "Red",
  blue: "Blue",
};

const DEFAULT_TURN_SECONDS = 60;
const DEFAULT_PASS_LIMIT = 2;

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

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function TabooRoute() {
  const [teamTurn, setTeamTurn] = useState<Team>("red");
  const [scores, setScores] = useState<Record<Team, number>>({
    red: 0,
    blue: 0,
  });
  const [roundActive, setRoundActive] = useState(false);
  const [turnSecondsInput, setTurnSecondsInput] = useState(
    String(DEFAULT_TURN_SECONDS)
  );
  const [timeLeft, setTimeLeft] = useState(DEFAULT_TURN_SECONDS);
  const [passesLeft, setPassesLeft] = useState(DEFAULT_PASS_LIMIT);
  const [statusMessage, setStatusMessage] = useState(
    "Set turn length and start the round."
  );
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  const [drawState, setDrawState] = useState(() => ({
    deck: shuffle(Array.from({ length: TABOO_CARDS.length }, (_, idx) => idx)),
    pointer: 0,
    currentCardIndex: null as number | null,
  }));

  const leadingTeam = useMemo(() => {
    if (scores.red === scores.blue) {
      return "Tie game";
    }
    return scores.red > scores.blue ? "Red leads" : "Blue leads";
  }, [scores.blue, scores.red]);

  const currentCard =
    drawState.currentCardIndex === null
      ? null
      : TABOO_CARDS[drawState.currentCardIndex];

  useEffect(() => {
    if (!roundActive || timeLeft <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [roundActive, timeLeft]);

  useEffect(() => {
    if (!roundActive || timeLeft > 0) {
      return;
    }
    endTurn("Time is up. Turn passes.");
  }, [roundActive, timeLeft]);

  function drawNextCard() {
    setDrawState((current) => {
      let activeDeck = current.deck;
      let { pointer } = current;

      if (pointer >= activeDeck.length) {
        activeDeck = shuffle(
          Array.from({ length: TABOO_CARDS.length }, (_, idx) => idx)
        );
        pointer = 0;
      }

      const nextCard = activeDeck[pointer] ?? null;
      return {
        deck: activeDeck,
        pointer: pointer + 1,
        currentCardIndex: nextCard,
      };
    });
  }

  function startTurn() {
    if (roundActive) {
      return;
    }

    const parsedSeconds = Number(turnSecondsInput);
    if (
      Number.isNaN(parsedSeconds) ||
      parsedSeconds < 15 ||
      parsedSeconds > 180
    ) {
      setStatusMessage("Turn length must be between 15 and 180 seconds.");
      return;
    }

    setTimeLeft(parsedSeconds);
    setPassesLeft(DEFAULT_PASS_LIMIT);
    setRoundActive(true);
    setStatusMessage(`${TEAM_LABEL[teamTurn]} team turn started.`);
    drawNextCard();
  }

  function endTurn(message: string) {
    setRoundActive(false);
    setTeamTurn((current) => otherTeam(current));
    setPassesLeft(DEFAULT_PASS_LIMIT);
    setStatusMessage(message);
  }

  function awardPoint() {
    if (!roundActive) {
      return;
    }
    setScores((current) => ({
      ...current,
      [teamTurn]: current[teamTurn] + 1,
    }));
    setStatusMessage(`${TEAM_LABEL[teamTurn]} team guessed correctly.`);
    drawNextCard();
  }

  function penaltyPoint() {
    if (!roundActive) {
      return;
    }
    setScores((current) => ({
      ...current,
      [teamTurn]: current[teamTurn] - 1,
    }));
    setStatusMessage(`${TEAM_LABEL[teamTurn]} team got a taboo buzz.`);
    drawNextCard();
  }

  function passCard() {
    if (!roundActive) {
      return;
    }
    if (passesLeft <= 0) {
      setStatusMessage("No passes left this turn.");
      return;
    }

    setPassesLeft((current) => current - 1);
    setStatusMessage(`${TEAM_LABEL[teamTurn]} team used a pass.`);
    drawNextCard();
  }

  function resetGame() {
    setTeamTurn("red");
    setScores({ red: 0, blue: 0 });
    setRoundActive(false);
    setTurnSecondsInput(String(DEFAULT_TURN_SECONDS));
    setTimeLeft(DEFAULT_TURN_SECONDS);
    setPassesLeft(DEFAULT_PASS_LIMIT);
    setStatusMessage("Set turn length and start the round.");
    setDrawState({
      deck: shuffle(
        Array.from({ length: TABOO_CARDS.length }, (_, idx) => idx)
      ),
      pointer: 0,
      currentCardIndex: null,
    });
  }

  return (
    <>
      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Taboo UI quick guide</DialogTitle>
            <DialogDescription>
              This is only a quick UI guide.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Set turn length, then click Start Turn.</li>
            <li>The active team gives clues for the current word.</li>
            <li>Use Correct, Taboo Buzz, or Pass during the timer.</li>
            <li>Click End Turn any time to switch teams.</li>
          </ol>
          <DialogFooter>
            <DialogClose render={<Button />}>OK</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="mx-auto grid max-w-325 gap-4 p-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <aside className="bg-game-surface-1 border-border rounded-4xl border p-4 shadow-game-card">
          <header className="mb-4 grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-semibold">Taboo Presenter</h1>
              <Link to="/">
                <Button size="sm" variant="outline">
                  Back
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={resetGame}>
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
              <span className="text-2xl font-extrabold">{scores.red}</span>
            </div>
            <div className="rounded-2xl bg-[#356fcb] p-3 text-white">
              <strong className="block text-sm">Blue Team</strong>
              <span className="text-2xl font-extrabold">{scores.blue}</span>
            </div>
          </section>

          <section className="bg-background/70 border-border mb-3 grid gap-2 rounded-2xl border p-3 text-sm">
            <p>
              <strong>Turn:</strong>{" "}
              <span
                className={cn(
                  "font-semibold",
                  teamTurn === "red" ? "text-[#8e1f1f]" : "text-[#1b4f98]"
                )}
              >
                {TEAM_LABEL[teamTurn]} Team
              </span>
            </p>
            <p>
              <strong>Timer:</strong> {formatTime(Math.max(0, timeLeft))}
            </p>
            <p>
              <strong>Passes left:</strong> {passesLeft}
            </p>
            <p>
              <strong>Lead:</strong> {leadingTeam}
            </p>
            <p aria-live="polite">
              <strong>Status:</strong> {statusMessage}
            </p>
          </section>

          <section className="bg-background/70 border-border mb-3 grid gap-2 rounded-2xl border p-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Turn length (seconds)</span>
              <input
                type="number"
                min={15}
                max={180}
                value={turnSecondsInput}
                onChange={(event) => setTurnSecondsInput(event.target.value)}
                className="border-input bg-background h-9 rounded-xl border px-3"
                disabled={roundActive}
              />
            </label>
            <Button onClick={startTurn} disabled={roundActive}>
              Start Turn
            </Button>
            <Button
              variant="outline"
              onClick={() => endTurn("Turn ended manually.")}
            >
              End Turn
            </Button>
          </section>

          <section className="grid gap-2">
            <Button
              onClick={awardPoint}
              disabled={!roundActive || !currentCard}
            >
              Correct (+1)
            </Button>
            <Button
              onClick={penaltyPoint}
              disabled={!roundActive || !currentCard}
              variant="destructive"
            >
              Taboo Buzz (-1)
            </Button>
            <Button
              onClick={passCard}
              disabled={!roundActive || !currentCard}
              variant="outline"
            >
              Pass
            </Button>
          </section>
        </aside>

        <section className="bg-game-surface-1 border-border rounded-4xl border p-4 shadow-game-card">
          {currentCard ? (
            <div className="grid h-full min-h-105 content-start gap-5">
              <div>
                <p className="text-muted-foreground mb-1 text-sm uppercase">
                  Guess Word
                </p>
                <h2 className="text-4xl leading-tight font-extrabold tracking-wide uppercase">
                  {currentCard.word}
                </h2>
              </div>
              <div>
                <p className="text-muted-foreground mb-2 text-sm uppercase">
                  Do Not Say
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {currentCard.taboo.map((tabooWord) => (
                    <li
                      key={tabooWord}
                      className="bg-background border-border rounded-xl border px-3 py-2 text-lg font-semibold uppercase"
                    >
                      {tabooWord}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground grid h-full min-h-105 place-items-center text-center">
              <p>Start a turn to reveal the first card.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

export const Route = createFileRoute("/games/taboo")({
  component: TabooRoute,
});
