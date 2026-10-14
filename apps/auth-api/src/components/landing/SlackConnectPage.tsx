import { AppLogo } from "@aikingbot/brand";
import { createSignal, onSettled, Show } from "solid-js";
import { Button } from "../ui/button";
import { handOffToWebClient } from "./web-messaging-handoff";

/**
 * The page that returns a Slack install to the desktop app, or to the browser client tab that started
 * it. The install callback redirects here with a sealed grant, or an error code, in the fragment. The
 * page only builds the `aikingbot://` link or passes the grant on: only the host can open the grant.
 */
export function SlackConnectPage() {
  const [openUrl, setOpenUrl] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [webClient, setWebClient] = createSignal(false);

  onSettled(() => {
    const page = new URL(window.location.href);
    const fragment = new URLSearchParams(page.hash.slice(1));
    const target = slackDeepLink(fragment);
    // The grant is no use to anyone who reads the address bar later.
    window.history.replaceState(null, "", page.pathname);
    if (!target) {
      setFailure(fragment.get("error") ?? "slack_failed");
      return;
    }
    // When the client tab that started the install is gone, the start-again message shows.
    const handoff = handOffToWebClient("slack", fragment);
    if (handoff) {
      void handoff.then((received) => (received ? setWebClient(true) : setFailure("slack_tab_closed")));
      return;
    }
    setOpenUrl(target);
    window.location.assign(target);
  });

  return <SlackConnectView openUrl={openUrl()} failure={failure()} webClient={webClient()} />;
}

/** The page's card: the link back to AIKINGBOT, or why Slack did not finish. */
export function SlackConnectView(props: { openUrl: string; failure: string | null; webClient?: boolean }) {
  return (
    <main class="join-page">
      <a class="landing-brand join-page-brand" href="/" aria-label="AIKINGBOT home">
        <AppLogo variant="production" class="landing-brand-logo" />
        <span>AIKINGBOT</span>
      </a>
      <section class="join-card" aria-labelledby="slack-connect-title">
        <AppLogo variant="production" animation="blink" class="join-card-logo" />
        <p class="join-card-eyebrow">Slack</p>
        <h1 id="slack-connect-title">Return to AIKINGBOT</h1>
        <Show
          when={!props.failure}
          fallback={
            <p class="join-card-error">
              {props.failure === "slack_workspace_taken"
                ? "Another AIKINGBOT server already answers this Slack workspace. Disconnect it on that server, then try again."
                : "Slack did not finish the connection. Go back to AIKINGBOT and start again."}
            </p>
          }
        >
          <p class="join-card-copy">
            {props.webClient
              ? "Your AIKINGBOT tab finishes the Slack connection. You can close this tab."
              : "AIKINGBOT finishes the Slack connection on your computer."}
          </p>
          <Show when={props.openUrl}>
            {(href) => (
              <div class="join-card-actions join-card-actions-single">
                <Button href={href()} variant="primary" size="lg" icon="open">
                  Open AIKINGBOT
                </Button>
              </div>
            )}
          </Show>
        </Show>
      </section>
    </main>
  );
}

function slackDeepLink(fragment: URLSearchParams): string | null {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  return nonce && grant ? `aikingbot://slack-workspace?${new URLSearchParams({ nonce, grant })}` : null;
}
