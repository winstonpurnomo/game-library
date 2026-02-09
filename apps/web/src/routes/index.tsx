import { createFileRoute } from "@tanstack/react-router";

import {
  MenuSelector,
  type MenuSelectorItem,
} from "@/components/ui/menu-selector";

export const Route = createFileRoute("/")({
  component: Index,
});

const gameMenuItems: MenuSelectorItem[] = [
  {
    title: "Multiplayer Euchre",
    description:
      "4-player trick-taking with room creation, optional passwords, and live turns.",
    link: "/games/euchre",
  },
  {
    title: "Codenames",
    description:
      "Team-based word association with hidden roles and one-word clues.",
    link: "/games/codenames",
  },
  {
    title: "Letter Bridge",
    description:
      "Generate front/back letters each round and keep player scores.",
    link: "/games/letter-bridge",
  },
  {
    title: "Taboo",
    description: "Describe the word without saying any forbidden clue words.",
    link: "/games/taboo",
  },
  {
    title: "Scorekeeper",
    description: "Flexible score tracker for games that only need bookkeeping.",
    link: "/games/scorekeeper",
  },
];

function Index() {
  return (
    <div className="p-6 md:p-8">
      <div className="mx-auto grid w-full max-w-2xl gap-5">
        <header className="grid gap-1 text-center">
          <h1 className="text-balance text-2xl font-semibold md:text-3xl">
            Select a game to continue
          </h1>
          <p className="text-muted-foreground text-sm">
            Pick a mode and jump in.
          </p>
        </header>
        <MenuSelector items={gameMenuItems} />
      </div>
    </div>
  );
}
