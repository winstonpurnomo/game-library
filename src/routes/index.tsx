import { createFileRoute } from "@tanstack/react-router";
import { MenuSelector, type MenuSelectorItem } from "@/components/ui/menu-selector";

export const Route = createFileRoute("/")({
  component: Index,
});

const gameMenuItems: MenuSelectorItem[] = [
  {
    title: "Codenames",
    description: "Team-based word association with hidden roles and one-word clues.",
    link: "/games/codenames",
  },
  {
    title: "Letter Bridge",
    description: "Generate front/back letters each round and keep player scores.",
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
    link: "/games/wavelength",
  },
];

function Index() {
  return (
    <div className="p-6">
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <header className="grid gap-1">
          <h1 className="text-2xl font-semibold">Choose a game</h1>
          <p className="text-muted-foreground text-sm">
            Select a game mode to start a room.
          </p>
        </header>
        <MenuSelector items={gameMenuItems} />
      </div>
    </div>
  );
}
