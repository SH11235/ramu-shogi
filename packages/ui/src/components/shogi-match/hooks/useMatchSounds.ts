import type { PositionState } from "@shogi/app-core";
import { useRef } from "react";
import { moveSoundScene } from "../../../hooks/moveSoundScene";
import { normalizeSoundVoice, type SoundVoice, useShogiSound } from "../../../hooks/useShogiSound";
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "../types";

/** 対局・検討の画面で鳴らす駒音と終局の音。表示設定の「音を鳴らす」と、CPU 戦の声の選択に従う。 */
export function useMatchSounds({
    displaySettings,
    isCpuGame,
    dogSoundBaseUrl,
}: {
    displaySettings: DisplaySettings;
    isCpuGame: boolean;
    dogSoundBaseUrl: string | undefined;
}) {
    const { playSound, playEndSound } = useShogiSound({ dogSoundBaseUrl });
    // 人の手は合法手の確認を待ってから適用されるので、鳴らすかどうか・鳴らし方はその時点の設定で決める。
    const moveSoundRef = useRef<{ enabled: boolean; voice: SoundVoice }>({
        enabled: false,
        voice: "standard",
    });
    moveSoundRef.current = {
        enabled: displaySettings.enableSound,
        voice:
            isCpuGame && dogSoundBaseUrl
                ? normalizeSoundVoice(
                      displaySettings.cpuSoundVoice,
                      DEFAULT_DISPLAY_SETTINGS.cpuSoundVoice,
                  )
                : "standard",
    };
    const playMoveSound = (
        move: string,
        before: PositionState,
        after: PositionState,
        by: "self" | "opponent",
        cpuLosing = false,
    ) => {
        const { enabled, voice } = moveSoundRef.current;
        if (!enabled) return;
        if (move === "pass") {
            playSound("pass");
            return;
        }
        playSound(by === "opponent" ? "move_opponent" : "move_self", {
            voice,
            scene: moveSoundScene(before, move, after),
            cpuLosing,
        });
    };
    const playMatchEndSound = () => {
        if (moveSoundRef.current.enabled) playEndSound(moveSoundRef.current.voice);
    };
    return { playSound, playMoveSound, playMatchEndSound };
}
