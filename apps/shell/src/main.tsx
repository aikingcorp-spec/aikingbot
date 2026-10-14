// Copyright (c) 2026 AIKING. All rights reserved.

import { render } from "solid-js/web";
import { App } from "./App.tsx";
import "./vendor/openbot-v0.1.11/openbot.css";
import "./app.css";

render(() => <App />, document.getElementById("root") as HTMLElement);
