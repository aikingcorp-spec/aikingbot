// window.aikingbot belongs in the application adapter.
export const documentation = "window.aikingbot";
export const viewport = () => window.innerWidth;
export const platformAction = (props: { aikingbot: () => void }) => props.aikingbot();
