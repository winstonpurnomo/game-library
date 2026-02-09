# Design System v1

## Foundations

- Tone: playful arcade with semantic game tokens.
- New token groups in `src/index.css`:
  - Surfaces: `--game-surface-1/2/3`
  - Intent: `--game-accent`, `--game-success`, `--game-warning`, `--game-danger`, `--game-info`
  - Interaction: `--game-highlight`
  - Primitive-specific: `--game-card-back`, `--game-counter-bg`, `--game-counter-fg`
  - Shape: `--game-radius-card`, `--game-radius-chip`
  - Rhythm: `--game-space-xs/sm/md/lg`
  - Motion: `--game-motion-fast/base/emphasis`
  - Elevation: `--game-shadow-card`, `--game-shadow-floating`

## Implemented Primitives

### `GameCard`

- File: `src/components/ui/game-card.tsx`
- API:
  - `orientation`: `vertical | horizontal` (default `vertical`)
  - `size`: `sm | md | lg`
  - `variant`: `default | active | selected | disabled | revealed | hidden`
  - `interactive`: boolean hover/focus affordance switch
- Slots:
  - `GameCardMedia`
  - `GameCardHeader`
  - `GameCardTitle`
  - `GameCardDescription`
  - `GameCardBadge`
  - `GameCardFooter`

### `Counter`

- File: `src/components/ui/counter.tsx`
- API:
  - Controlled: `value` + `onValueChange`
  - Uncontrolled: `defaultValue`
  - Bounds/steps: `min`, `max`, `step`
  - Display customization: `decrementContent`, `incrementContent`, `formatValue`
  - Labels: `decrementLabel`, `incrementLabel`
  - Visuals: `size`, `variant`
- Keyboard behavior:
  - `ArrowUp/ArrowRight`: increment
  - `ArrowDown/ArrowLeft`: decrement
  - `Home`: set min
  - `End`: set max

## Proposed Next Components (8)

1. `word-tile`
2. `role-badge`
3. `turn-timer`
4. `clue-banner`
5. `player-pill`
6. `stat-chip`
7. `action-bar`
8. `empty-state`
