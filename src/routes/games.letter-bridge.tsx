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
import { LETTER_BRIDGE_VALID_PAIRS } from "@/lib/letter-bridge-valid-pairs";

const INITIAL_PAIR = LETTER_BRIDGE_VALID_PAIRS[0] ?? "AA";

type Player = {
  id: string;
  name: string;
  score: number;
};

function randomPair() {
  return LETTER_BRIDGE_VALID_PAIRS[
    Math.floor(Math.random() * LETTER_BRIDGE_VALID_PAIRS.length)
  ];
}

function LetterBridgeRoute() {
  const [frontLetter, setFrontLetter] = useState(INITIAL_PAIR[0] ?? "A");
  const [backLetter, setBackLetter] = useState(INITIAL_PAIR[1] ?? "A");
  const [playerName, setPlayerName] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pendingPair, setPendingPair] = useState<string | null>(null);

  const leader = useMemo(() => {
    if (players.length === 0) {
      return null;
    }

    return players.reduce((highest, current) => {
      if (current.score > highest.score) {
        return current;
      }
      return highest;
    });
  }, [players]);

  const sortedPlayers = useMemo(
    () =>
      [...players].sort(
        (a, b) => b.score - a.score || a.name.localeCompare(b.name)
      ),
    [players]
  );

  useEffect(() => {
    if (countdown === null) {
      return;
    }

    if (countdown === 0) {
      if (pendingPair) {
        setFrontLetter(pendingPair[0] ?? "A");
        setBackLetter(pendingPair[1] ?? "A");
      }
      setPendingPair(null);
      setCountdown(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) => (current === null ? null : current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [countdown, pendingPair]);

  function generateLetters() {
    if (countdown !== null) {
      return;
    }

    const pair = randomPair();
    setPendingPair(pair);
    setCountdown(3);
    setError("");
  }

  function addPlayer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = playerName.trim();

    if (!candidate) {
      setError("Enter a player name first.");
      return;
    }

    if (
      players.some(
        (player) => player.name.toLowerCase() === candidate.toLowerCase()
      )
    ) {
      setError("That player is already on the board.");
      return;
    }

    setPlayers((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        name: candidate,
        score: 0,
      },
    ]);
    setPlayerName("");
    setError("");
  }

  function updateScore(id: string, change: number) {
    setPlayers((previous) =>
      previous.map((player) =>
        player.id === id
          ? {
              ...player,
              score: player.score + change,
            }
          : player
      )
    );
  }

  function resetGame() {
    setFrontLetter(INITIAL_PAIR[0] ?? "A");
    setBackLetter(INITIAL_PAIR[1] ?? "A");
    setPlayerName("");
    setPlayers([]);
    setError("");
    setCountdown(null);
    setPendingPair(null);
  }

  function skipCountdown() {
    if (!pendingPair) {
      setCountdown(null);
      return;
    }
    setFrontLetter(pendingPair[0] ?? "A");
    setBackLetter(pendingPair[1] ?? "A");
    setPendingPair(null);
    setCountdown(null);
  }

  return (
    <>
      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Letter Bridge UI quick guide</DialogTitle>
            <DialogDescription>
              This is only a quick UI guide.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Click Generate Letters to start each round.</li>
            <li>Add players once at the start.</li>
            <li>Use + and - to update scores after each round.</li>
            <li>The leaderboard auto-sorts by score.</li>
          </ol>
          <DialogFooter>
            <DialogClose render={<Button />}>OK</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="mx-auto grid max-w-3xl gap-4 p-4">
        <section className="bg-game-surface-1 border-border rounded-4xl border p-4 shadow-game-card">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">Letter Bridge</h1>
            <div className="flex flex-wrap gap-2">
              <Link to="/">
                <Button variant="outline" size="sm">
                  Back
                </Button>
              </Link>
              <Button variant="secondary" onClick={resetGame}>
                Reset
              </Button>
              <Button
                variant="outline"
                onClick={() => setInstructionsOpen(true)}
              >
                Show Instructions
              </Button>
            </div>
          </header>

          <p className="text-muted-foreground mb-4 text-sm">
            Generate letters for each round, then track player scores with + and
            -.
          </p>

          <div className="mb-4 flex items-center justify-center gap-3">
            <div className="bg-background border-border grid size-20 place-items-center rounded-2xl border-2 text-3xl font-extrabold">
              {frontLetter}
            </div>
            <span className="text-2xl font-bold">→</span>
            <div className="bg-background border-border grid size-20 place-items-center rounded-2xl border-2 text-3xl font-extrabold">
              {backLetter}
            </div>
          </div>

          <Button
            className="mb-4 w-full"
            onClick={generateLetters}
            disabled={countdown !== null}
          >
            Generate Letters
          </Button>

          <form className="mb-3 grid gap-2" onSubmit={addPlayer}>
            <label htmlFor="player-input" className="text-sm font-medium">
              Add player
            </label>
            <input
              id="player-input"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="Player name"
              autoComplete="off"
              className="border-input bg-background h-10 rounded-xl border px-3"
            />
            <Button type="submit" variant="outline">
              Add Player
            </Button>
          </form>

          {error ? (
            <p className="text-destructive mb-2 text-sm font-medium">{error}</p>
          ) : null}

          <section>
            <h2 className="mb-2 text-base font-semibold">Scoreboard</h2>
            {players.length === 0 ? (
              <p className="text-muted-foreground text-sm">No players yet.</p>
            ) : null}
            {players.length > 0 ? (
              <ul className="grid gap-2">
                {sortedPlayers.map((player) => (
                  <li
                    key={player.id}
                    className="bg-background border-border flex items-center justify-between rounded-xl border px-3 py-2"
                  >
                    <span>{player.name}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => updateScore(player.id, -1)}
                        aria-label={`Decrease ${player.name} score`}
                      >
                        -
                      </Button>
                      <strong className="min-w-8 text-center">
                        {player.score}
                      </strong>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => updateScore(player.id, 1)}
                        aria-label={`Increase ${player.name} score`}
                      >
                        +
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {leader ? (
              <p className="bg-game-success/15 border-game-success/40 mt-3 rounded-xl border px-3 py-2 text-sm">
                Leading player: <strong>{leader.name}</strong> ({leader.score}{" "}
                points)
              </p>
            ) : null}
          </section>
        </section>
      </main>

      {countdown !== null && (
        <div className="bg-background/90 fixed inset-0 z-50 grid place-items-center backdrop-blur-sm">
          <div className="bg-game-surface-1 border-border rounded-4xl border px-12 py-10 text-center shadow-game-floating">
            <p className="text-muted-foreground mb-2 text-sm">
              Next round starts in
            </p>
            <p className="text-7xl leading-none font-extrabold tabular-nums">
              {countdown}
            </p>
            <Button variant="outline" className="mt-4" onClick={skipCountdown}>
              Skip
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export const Route = createFileRoute("/games/letter-bridge")({
  component: LetterBridgeRoute,
});
