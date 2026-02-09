import { cva, type VariantProps } from "class-variance-authority";
import { MinusIcon, PlusIcon } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const counterVariants = cva(
  "bg-game-counter-bg text-game-counter-fg border-border inline-flex items-center gap-2 border p-1.5 shadow-game-card transition-[border-color,box-shadow] duration-[var(--game-motion-fast)]",
  {
    variants: {
      variant: {
        default: "bg-game-counter-bg",
        outline: "bg-background",
        ghost: "border-transparent bg-transparent shadow-none",
      },
      size: {
        sm: "rounded-[var(--radius-game-chip)] text-sm",
        md: "rounded-[var(--radius-game-chip)] text-base",
        lg: "rounded-[var(--radius-game-chip)] text-lg",
      },
      disabled: {
        true: "pointer-events-none opacity-55",
        false:
          "has-focus-visible:ring-game-highlight/45 has-focus-visible:ring-[3px] has-focus-visible:outline-hidden",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      disabled: false,
    },
  }
);

type CounterContextValue = {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  readOnly: boolean;
  size: NonNullable<CounterProps["size"]>;
  canDecrement: boolean;
  canIncrement: boolean;
  decrement: () => void;
  increment: () => void;
  setToMin: () => void;
  setToMax: () => void;
  decrementLabel: string;
  incrementLabel: string;
  decrementContent?: React.ReactNode;
  incrementContent?: React.ReactNode;
  formatValue?: (value: number) => React.ReactNode;
};

const CounterContext = React.createContext<CounterContextValue | null>(null);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function useCounterContext() {
  const context = React.useContext(CounterContext);
  if (!context) {
    throw new Error("Counter compound components must be used within Counter");
  }
  return context;
}

type CounterProps = React.ComponentProps<"div"> &
  Omit<VariantProps<typeof counterVariants>, "disabled"> & {
    value?: number;
    defaultValue?: number;
    onValueChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    readOnly?: boolean;
    formatValue?: (value: number) => React.ReactNode;
    decrementLabel?: string;
    incrementLabel?: string;
    decrementContent?: React.ReactNode;
    incrementContent?: React.ReactNode;
  };

function Counter({
  className,
  children,
  variant = "default",
  size = "md",
  value,
  defaultValue = 0,
  onValueChange,
  min = 0,
  max = 99,
  step = 1,
  disabled = false,
  readOnly = false,
  formatValue,
  decrementLabel = "Decrease",
  incrementLabel = "Increase",
  decrementContent,
  incrementContent,
  onKeyDown,
  ...props
}: CounterProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(() =>
    clamp(defaultValue, min, max)
  );

  const currentValue = clamp(
    isControlled ? (value ?? defaultValue) : internalValue,
    min,
    max
  );

  const updateValue = React.useCallback(
    (nextValue: number) => {
      const clamped = clamp(nextValue, min, max);
      if (!isControlled) {
        setInternalValue(clamped);
      }
      if (clamped !== currentValue) {
        onValueChange?.(clamped);
      }
    },
    [currentValue, isControlled, max, min, onValueChange]
  );

  const canDecrement = !disabled && !readOnly && currentValue > min;
  const canIncrement = !disabled && !readOnly && currentValue < max;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled || readOnly) {
      return;
    }

    switch (event.key) {
      case "ArrowDown":
      case "ArrowLeft": {
        event.preventDefault();
        updateValue(currentValue - step);
        break;
      }
      case "ArrowUp":
      case "ArrowRight": {
        event.preventDefault();
        updateValue(currentValue + step);
        break;
      }
      case "Home": {
        event.preventDefault();
        updateValue(min);
        break;
      }
      case "End": {
        event.preventDefault();
        updateValue(max);
        break;
      }
      default: {
        break;
      }
    }
  };

  const contextValue = React.useMemo<CounterContextValue>(
    () => ({
      value: currentValue,
      min,
      max,
      disabled,
      readOnly,
      size: size ?? "md",
      canDecrement,
      canIncrement,
      decrement: () => updateValue(currentValue - step),
      increment: () => updateValue(currentValue + step),
      setToMin: () => updateValue(min),
      setToMax: () => updateValue(max),
      decrementLabel,
      incrementLabel,
      decrementContent,
      incrementContent,
      formatValue,
    }),
    [
      canDecrement,
      canIncrement,
      currentValue,
      decrementContent,
      decrementLabel,
      disabled,
      formatValue,
      incrementContent,
      incrementLabel,
      max,
      min,
      readOnly,
      size,
      step,
      updateValue,
    ]
  );

  return (
    <CounterContext.Provider value={contextValue}>
      <div
        data-slot="counter"
        data-size={size}
        data-variant={variant}
        data-disabled={disabled || undefined}
        role="group"
        tabIndex={disabled ? -1 : 0}
        className={cn(counterVariants({ variant, size, disabled, className }))}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children ?? (
          <>
            <CounterDecrement />
            <CounterValue />
            <CounterIncrement />
          </>
        )}
      </div>
    </CounterContext.Provider>
  );
}

function CounterDecrement({
  className,
  children,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const counter = useCounterContext();
  return (
    <Button
      data-slot="counter-decrement"
      type="button"
      variant="outline"
      size={
        counter.size === "sm"
          ? "icon-xs"
          : counter.size === "lg"
            ? "icon-lg"
            : "icon"
      }
      disabled={!counter.canDecrement}
      aria-label={counter.decrementLabel}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          counter.decrement();
        }
      }}
      className={cn("rounded-full", className)}
      {...props}
    >
      {children ?? counter.decrementContent ?? <MinusIcon />}
    </Button>
  );
}

function CounterIncrement({
  className,
  children,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const counter = useCounterContext();
  return (
    <Button
      data-slot="counter-increment"
      type="button"
      variant="outline"
      size={
        counter.size === "sm"
          ? "icon-xs"
          : counter.size === "lg"
            ? "icon-lg"
            : "icon"
      }
      disabled={!counter.canIncrement}
      aria-label={counter.incrementLabel}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          counter.increment();
        }
      }}
      className={cn("rounded-full", className)}
      {...props}
    >
      {children ?? counter.incrementContent ?? <PlusIcon />}
    </Button>
  );
}

function CounterValue({ className, ...props }: React.ComponentProps<"output">) {
  const counter = useCounterContext();
  return (
    <output
      data-slot="counter-value"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "min-w-12 px-1 text-center tabular-nums select-none",
        className
      )}
      {...props}
    >
      {counter.formatValue ? counter.formatValue(counter.value) : counter.value}
    </output>
  );
}

export { Counter, CounterDecrement, CounterIncrement, CounterValue };
