import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type MenuSelectorItem = {
  title: string;
  description: string;
  link: string;
};

function MenuSelector({
  items,
  className,
}: {
  items: MenuSelectorItem[];
  className?: string;
}) {
  return (
    <nav
      data-slot="menu-selector"
      aria-label="Game selection"
      className={cn("w-full max-w-2xl", className)}
    >
      <ul className="border-border bg-game-surface-1 shadow-game-card overflow-hidden rounded-3xl border">
        {items.map((item) => (
          <li
            key={item.title}
            className="border-border border-b last:border-b-0"
          >
            <a
              href={item.link}
              className={cn(
                "group/game-option hover:bg-game-surface-2 focus-visible:ring-game-highlight/45 focus-visible:ring-[3px] flex items-center justify-between gap-4 px-5 py-4 text-left transition-[background-color,color] duration-[var(--game-motion-base)] focus-visible:outline-hidden"
              )}
            >
              <span className="grid gap-1">
                <span className="text-foreground text-sm font-semibold">
                  {item.title}
                </span>
                <span className="text-muted-foreground text-sm">
                  {item.description}
                </span>
              </span>

              <span className="text-muted-foreground group-hover/game-option:text-game-accent transition-colors">
                <ChevronRightIcon className="size-4" aria-hidden />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { MenuSelector };
