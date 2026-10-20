import type { AikingState } from "@/lib/mascot";

export interface SceneProps {
  playing: boolean;
  onCue?: (state: AikingState) => void;
  onEnded?: () => void;
  label: string;
}
