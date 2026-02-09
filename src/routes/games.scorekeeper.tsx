import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

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
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";

type Participant = {
  id: string;
  name: string;
  score: number;
};

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return parsed;
}

function ScorekeeperRoute() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(true);

  const [startScoreInput, setStartScoreInput] = useState("0");
  const [addStepInput, setAddStepInput] = useState("1");
  const [subtractStepInput, setSubtractStepInput] = useState("1");
  const [targetScoreInput, setTargetScoreInput] = useState("25");
  const [allowNegative, setAllowNegative] = useState(false);
  const [autoSort, setAutoSort] = useState(true);

  const startScore = parseNumber(startScoreInput, 0);
  const addStep = Math.max(1, parseNumber(addStepInput, 1));
  const subtractStep = Math.max(1, parseNumber(subtractStepInput, 1));
  const targetScore = Math.max(1, parseNumber(targetScoreInput, 25));

  const rankedParticipants = useMemo(() => {
    if (!autoSort) {
      return participants;
    }
    return [...participants].sort(
      (a, b) => b.score - a.score || a.name.localeCompare(b.name)
    );
  }, [participants, autoSort]);

  const winners = useMemo(
    () =>
      rankedParticipants.filter(
        (participant) => participant.score >= targetScore
      ),
    [rankedParticipants, targetScore]
  );

  function addParticipant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = nameInput.trim();

    if (!candidate) {
      setError("Enter a player or team name first.");
      return;
    }

    if (
      participants.some(
        (participant) =>
          participant.name.toLowerCase() === candidate.toLowerCase()
      )
    ) {
      setError("That name is already on the board.");
      return;
    }

    setParticipants((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: candidate,
        score: startScore,
      },
    ]);
    setNameInput("");
    setError("");
  }

  function changeScore(id: string, delta: number) {
    setParticipants((current) =>
      current.map((participant) => {
        if (participant.id !== id) {
          return participant;
        }

        const nextScore = participant.score + delta;
        return {
          ...participant,
          score: allowNegative ? nextScore : Math.max(0, nextScore),
        };
      })
    );
  }

  function removeParticipant(id: string) {
    setParticipants((current) =>
      current.filter((participant) => participant.id !== id)
    );
  }

  function resetScoresToStart() {
    setParticipants((current) =>
      current.map((participant) => ({
        ...participant,
        score: startScore,
      }))
    );
  }

  function clearBoard() {
    setParticipants([]);
    setNameInput("");
    setError("");
  }

  return (
    <>
      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scorekeeper quick guide</DialogTitle>
            <DialogDescription>
              This is only a quick UI guide.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              Set scoring rules for this game (start score, +/- values, target).
            </li>
            <li>Add players or teams to the board.</li>
            <li>Use + and - to track points each round.</li>
            <li>Use Reset Scores or Clear Board when starting a new match.</li>
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
              <h1 className="text-lg font-semibold">Flexible Scorekeeper</h1>
              <Link to="/">
                <Button size="sm" variant="outline">
                  Back
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={resetScoresToStart}>
                Reset Scores
              </Button>
              <Button variant="outline" onClick={clearBoard}>
                Clear Board
              </Button>
              <Button
                variant="outline"
                onClick={() => setInstructionsOpen(true)}
              >
                Show Instructions
              </Button>
            </div>
          </header>

          <section className="bg-background/70 border-border mb-3 grid gap-2 rounded-2xl border p-3 text-sm">
            <h2 className="text-base font-semibold">Settings</h2>

            <label className="grid gap-1">
              <span className="text-xs font-medium">Starting score</span>
              <input
                type="number"
                value={startScoreInput}
                onChange={(event) => setStartScoreInput(event.target.value)}
                className="border-input bg-background h-9 rounded-xl border px-3"
              />
            </label>

            <div className="grid gap-1">
              <div className="grid gap-2 text-xs font-medium sm:grid-cols-2">
                <span>Plus button value</span>
                <span>Minus button value</span>
              </div>
              <InputGroup className="h-10 w-full">
                <InputGroupInput
                  type="number"
                  min={1}
                  value={addStepInput}
                  onChange={(event) => setAddStepInput(event.target.value)}
                  className="px-2 text-center"
                  aria-label="Plus button value"
                />
                <InputGroupInput
                  type="number"
                  min={1}
                  value={subtractStepInput}
                  onChange={(event) => setSubtractStepInput(event.target.value)}
                  className="px-2 text-center"
                  aria-label="Minus button value"
                />
              </InputGroup>
            </div>

            <label className="grid gap-1">
              <span className="text-xs font-medium">Target score</span>
              <input
                type="number"
                min={1}
                value={targetScoreInput}
                onChange={(event) => setTargetScoreInput(event.target.value)}
                className="border-input bg-background h-9 rounded-xl border px-3"
              />
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowNegative}
                onChange={(event) => setAllowNegative(event.target.checked)}
              />
              Allow negative scores
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoSort}
                onChange={(event) => setAutoSort(event.target.checked)}
              />
              Auto-sort by score
            </label>
          </section>

          <form className="grid gap-2" onSubmit={addParticipant}>
            <label htmlFor="scorekeeper-name" className="text-sm font-medium">
              Add player/team
            </label>
            <input
              id="scorekeeper-name"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Name"
              autoComplete="off"
              className="border-input bg-background h-10 rounded-xl border px-3"
            />
            <Button type="submit">Add</Button>
          </form>
          {error ? (
            <p className="text-destructive mt-2 text-sm font-medium">{error}</p>
          ) : null}
        </aside>

        <section className="bg-game-surface-1 border-border rounded-4xl border p-4 shadow-game-card">
          <header className="mb-3">
            <h2 className="text-base font-semibold">Scoreboard</h2>
          </header>

          {rankedParticipants.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No participants yet.
            </p>
          ) : (
            <ul className="grid gap-2">
              {rankedParticipants.map((participant) => (
                <li
                  key={participant.id}
                  className="bg-background border-border flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{participant.name}</p>
                    <p className="text-muted-foreground text-xs">
                      Target: {targetScore}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      onClick={() => changeScore(participant.id, -subtractStep)}
                      aria-label={`Decrease ${participant.name} score`}
                    >
                      -{subtractStep}
                    </Button>
                    <strong className="min-w-10 text-center">
                      {participant.score}
                    </strong>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      onClick={() => changeScore(participant.id, addStep)}
                      aria-label={`Increase ${participant.name} score`}
                    >
                      +{addStep}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeParticipant(participant.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {winners.length > 0 ? (
            <div className="bg-game-success/15 border-game-success/40 mt-3 rounded-xl border px-3 py-2 text-sm">
              <p className="font-medium">Reached target</p>
              <p>{winners.map((winner) => winner.name).join(", ")}</p>
            </div>
          ) : null}

          {rankedParticipants.length > 0 ? (
            <div className="bg-background/70 border-border mt-3 rounded-xl border px-3 py-2 text-sm">
              <p>
                Leader:{" "}
                <strong>
                  {rankedParticipants[0]?.name} ({rankedParticipants[0]?.score})
                </strong>
              </p>
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}

export const Route = createFileRoute("/games/scorekeeper")({
  component: ScorekeeperRoute,
});
