import React from "react";
import { render } from "ink";
import { Store } from "@anchormem/server/store/db";
import { loadConfig } from "@anchormem/server/config";
import { App } from "./App.js";

export function runTui(opts: { scope?: string }) {
  const cfg = loadConfig();
  const store = new Store(cfg);
  const { waitUntilExit, unmount } = render(<App store={store} initialScope={opts.scope} />);
  waitUntilExit().then(() => {
    store.close();
    unmount();
  });
}
