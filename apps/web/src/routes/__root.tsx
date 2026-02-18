import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { HouseIcon } from "lucide-react";

import { ToastProvider } from "@/components/ui/toast";

export function RootLayout() {
  return (
    <div className="min-h-dvh bg-background">
      <ToastProvider>
        <main className="pb-24">
          <Outlet />
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex w-full max-w-md items-center justify-center px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Link
              to="/"
              className="text-muted-foreground [&.active]:text-foreground inline-flex min-w-28 items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-medium transition-colors"
            >
              <HouseIcon className="size-4" />
              <span>Home</span>
            </Link>
          </div>
        </nav>
      </ToastProvider>
      <TanStackRouterDevtools />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
