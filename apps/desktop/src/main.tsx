import { serverLocalPath } from "./aiking/platform-transport";
import { initializeLocale } from "./aiking/initial-locale";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PanelBoundary } from "./components/PanelBoundary";
import {
  BROWSER_SIGN_IN_FAILED, previewBrowserSignIn, readSessionState, SERVICE_TRUST_REASON, takeBrowserSignInFromLocation, takePairingCodeFromLocation, takeInvitedEmailFromLocation,
} from "./lib/session";
import { bootstrapBrand } from "./lib/brand";
import { applySkin, readSkin } from "./lib/skins";
import { applyFont, readFont } from "./lib/fonts";
import { settleAdvancedModeDefault } from "./lib/interface-mode";
import { BrowserSignInPage } from "./pair/BrowserSignInPage";
import { PairPage } from "./pair/PairPage";
import { readAccountState } from "./aiking/account/account-api";
import "./styles.css";
import "./aiking/theme.css";
import { initializeMarketplace } from "./aiking/marketplace/server-records";

// Before first paint; settleAdvancedModeDefault must run before applySkin writes aiking-skin.
initializeLocale();
settleAdvancedModeDefault();
applySkin(readSkin());
applyFont(readFont());

async function chooseRoot(): Promise<React.ReactNode> {
  if (serverLocalPath(location.pathname) === "/pair") {
    const signIn = takeBrowserSignInFromLocation();
    if (signIn) {
      const preview = await previewBrowserSignIn(signIn);
      return preview ? <BrowserSignInPage credential={signIn} owner={preview.owner} /> : <PairPage initialCode={null} reason={BROWSER_SIGN_IN_FAILED} />;
    }
    return <PairPage initialCode={takePairingCodeFromLocation()} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  const session = await readSessionState();
  if (session.kind === "unreachable") return <PairPage initialCode={null} reason={session.error} />;
  if (session.kind === "unauthenticated") {
    const account = await readAccountState();
    if (account) {
      const { AccountShell } = await import("./aiking/account/AccountShell");
      return <AccountShell initial={account} />;
    }
    return <PairPage initialCode={null} reason={session.error} />;
  }
  if (session.kind === "loopback" && session.trust === "service") return <PairPage initialCode={null} reason={SERVICE_TRUST_REASON} />;
  if (serverLocalPath(location.pathname) === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  return <App />;
}

void Promise.all([bootstrapBrand(), chooseRoot(), initializeMarketplace()]).then(([, root]) => {
  createRoot(document.getElementById("root")!).render(<StrictMode><PanelBoundary name="app">{root}</PanelBoundary></StrictMode>);
});
