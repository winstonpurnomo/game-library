# Game Library

Client-side board/party game library built with:

- `Vite`
- `React 19`
- `TypeScript`
- `TanStack Router` (file-based routes)
- `Tailwind CSS v4`
- `shadcn` + `@base-ui/react` primitives

## Getting Started

Install dependencies:

```bash
bun install
```

Run development server:

```bash
bun run dev
```

Build:

```bash
bun run build
```

Preview production build:

```bash
bun run preview
```

Lint/format checks:

```bash
bun run check
```

Auto-fix:

```bash
bun run fix
```

## Project Structure

- `src/routes` - Route components (one file per route)
- `src/components/ui` - Shared UI primitives and design-system components
- `src/lib` - Data and helpers (word pools, card sets, generated valid pairs)

## Design System Notes

Foundation tokens live in `src/index.css` and include game-specific semantic tokens (surfaces, accent/status colors, motion, spacing, shadows).

Custom primitives include:

- `game-card`
- `counter`
- `menu-selector`
- shadcn/base-ui wrappers (`dialog`, `popover`, `avatar`, `input-group`, etc.)

## Conventions

- Use `kebab-case` for new files.
- Do **not** manually edit generated route files like `src/routeTree.gen.ts`.
  - Let TanStack Router regenerate them via dev server/codegen.

## Notes for Adding a New Game

1. Create a new route file under `src/routes` (kebab-case).
2. Add a menu entry in `src/routes/index.tsx`.
3. Keep game-specific data in `src/lib`.
4. Prefer existing UI primitives in `src/components/ui`.
5. Include an instruction dialog on first open and a button to re-open it.
