import { createFileRoute } from "@tanstack/react-router";

import {
  MenuSelector,
  type MenuSelectorItem,
} from "@/components/ui/menu-selector";

export const Route = createFileRoute("/")({
  component: Index,
});

const localGameMenuItems: MenuSelectorItem[] = [
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

const multiplayerMenuItems: MenuSelectorItem[] = [
  {
    title: "Euchre",
    description: "4-player trick-taking played in pairs.",
    link: "/games/euchre",
  },
];

function Index() {
  return (
    <div className="p-6 md:p-8">
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        <header className="grid gap-1 text-center">
          <h1 className="text-balance text-2xl font-semibold md:text-3xl">
            Select a game to continue
          </h1>
          <p className="text-muted-foreground text-sm">
            Pick a mode and jump in.
          </p>
        </header>

        <section className="grid gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Local
          </h2>
          <MenuSelector items={localGameMenuItems} />
        </section>

        <section className="grid gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Multi Device
          </h2>
          <MenuSelector items={multiplayerMenuItems} />
        </section>
      </div>
    </div>
  );
}
