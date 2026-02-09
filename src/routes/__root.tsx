import type { newWebSocketRpcSession } from "capnweb";
/// <reference types="vite/client" />
import type { ReactNode } from "react";

import {
  Outlet,
  HeadContent,
  Scripts,
  Link,
  createRootRouteWithContext,
} from "@tanstack/react-router";

import type { PublicApi } from "./api";

// oxlint-disable-next-line import/no-relative-parent-imports
import appCss from "../index.css?url";

type RootRouteContext = {
  ws: ReturnType<typeof newWebSocketRpcSession<PublicApi>>;
};

export const Route = createRootRouteWithContext<RootRouteContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "TanStack Start Starter",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="p-2 flex gap-2">
          <Link to="/" className="[&.active]:font-bold">
            Home
          </Link>{" "}
        </div>
        <hr />
        {children}
        <Scripts />
      </body>
    </html>
  );
}
