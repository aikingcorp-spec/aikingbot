declare module "@aikingbot/renderer-preview" {
  import type { JSX } from "@solidjs/web";

  export interface AIKINGBOTPlaygroundProps {
    variant?: "default" | "landing";
  }

  export function AIKINGBOTPlayground(props: AIKINGBOTPlaygroundProps): JSX.Element;
}
