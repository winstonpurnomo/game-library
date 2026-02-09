import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const gameCardVariants = cva(
  "group/game-card border-border bg-game-surface-1 text-foreground shadow-game-card relative grid gap-3 border p-4 transition-[background-color,box-shadow,transform,border-color] duration-[var(--game-motion-base)]",
  {
    variants: {
      orientation: {
        vertical: "grid-rows-[auto_1fr_auto] w-[min(100%,20rem)]",
        horizontal:
          "grid-cols-[auto_1fr] grid-rows-[1fr_auto] w-[min(100%,30rem)]",
      },
      size: {
        sm: "p-3 text-sm",
        md: "p-4 text-sm",
        lg: "p-5 text-base",
      },
      variant: {
        default: "bg-game-surface-1",
        active:
          "bg-game-surface-2 border-game-accent/40 shadow-game-floating -translate-y-0.5",
        selected:
          "bg-game-surface-2 border-game-accent shadow-game-floating ring-game-highlight/45 ring-[3px]",
        disabled: "pointer-events-none opacity-50 saturate-0",
        revealed: "bg-game-surface-3 border-game-success/45",
        hidden:
          "bg-game-card-back text-primary-foreground border-transparent shadow-game-floating",
      },
      interactive: {
        true: "hover:bg-game-surface-2 hover:border-game-accent/45 hover:-translate-y-0.5 focus-visible:ring-game-highlight/45 focus-visible:ring-[3px] focus-visible:outline-hidden cursor-pointer",
        false: "",
      },
    },
    defaultVariants: {
      orientation: "vertical",
      size: "md",
      variant: "default",
      interactive: false,
    },
  }
);

function GameCard({
  className,
  orientation = "vertical",
  size = "md",
  variant = "default",
  interactive = false,
  ...props
}: React.ComponentProps<"article"> &
  VariantProps<typeof gameCardVariants> & {
    interactive?: boolean;
  }) {
  return (
    <article
      data-slot="game-card"
      data-orientation={orientation}
      data-size={size}
      data-variant={variant}
      className={cn(
        gameCardVariants({
          orientation,
          size,
          variant,
          interactive,
          className,
        }),
        "rounded-[var(--radius-game-card)]"
      )}
      {...props}
    />
  );
}

function GameCardMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="game-card-media"
      className={cn(
        "bg-game-surface-3 relative overflow-hidden rounded-2xl",
        "aspect-[3/4] group-data-[orientation=horizontal]/game-card:row-span-2 group-data-[orientation=horizontal]/game-card:aspect-[4/5] group-data-[orientation=horizontal]/game-card:w-32",
        className
      )}
      {...props}
    />
  );
}

function GameCardHeader({
  className,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="game-card-header"
      className={cn(
        "grid content-start gap-1.5",
        "group-data-[orientation=horizontal]/game-card:col-start-2",
        className
      )}
      {...props}
    />
  );
}

function GameCardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="game-card-title"
      className={cn("text-base leading-tight font-semibold", className)}
      {...props}
    />
  );
}

function GameCardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="game-card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function GameCardBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="game-card-badge"
      className={cn(
        "bg-game-accent text-game-accent-foreground inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs leading-none font-semibold",
        className
      )}
      {...props}
    />
  );
}

function GameCardFooter({
  className,
  ...props
}: React.ComponentProps<"footer">) {
  return (
    <footer
      data-slot="game-card-footer"
      className={cn(
        "mt-1 flex items-center justify-between gap-2",
        "group-data-[orientation=horizontal]/game-card:col-start-2",
        className
      )}
      {...props}
    />
  );
}

export {
  GameCard,
  GameCardBadge,
  GameCardDescription,
  GameCardFooter,
  GameCardHeader,
  GameCardMedia,
  GameCardTitle,
};
