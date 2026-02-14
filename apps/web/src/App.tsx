import type { MoveFeatures } from "@shogi/app-core";
import { wasm_get_move_features } from "@shogi/engine-wasm";
import type { EngineOption } from "@shogi/ui";
import { EngineControlPanel, ShogiMatch, useDevMode } from "@shogi/ui";
import { useState } from "react";
import { HeaderNav } from "./components/HeaderNav";
import { PageHeader } from "./components/PageHeader";
import { useRemotePrivateNnueManager } from "./hooks/useRemotePrivateNnueManager";
import { createWebWasmEngineClient } from "./platform/wasm-engine-client";

const engineOptions: EngineOption[] = [
    {
        id: "wasm",
        label: "内蔵エンジン",
        createClient: createWebWasmEngineClient,
        kind: "internal",
    },
];

const panelEngine = createWebWasmEngineClient();

// NNUE プリセット manifest.json の URL（環境変数で設定、必須）
const nnueManifestUrl = import.meta.env.VITE_NNUE_MANIFEST_URL as string;

function readReviewKifuFromSessionStorage(): { sfen: string; moves: string[] } | undefined {
    try {
        const raw = sessionStorage.getItem("ramu_review_kifu");
        if (!raw) return undefined;
        sessionStorage.removeItem("ramu_review_kifu");
        return JSON.parse(raw) as { sfen: string; moves: string[] };
    } catch {
        return undefined;
    }
}

/** WASM版 MoveFeatures 取得（isCheck付き） */
const getWasmMoveFeatures = (
    sfen: string,
    moves: string[],
    targetMove: string,
    passRights?: { sente: number; gote: number },
): MoveFeatures | null => {
    try {
        return wasm_get_move_features(sfen, moves, targetMove, passRights) as MoveFeatures;
    } catch {
        return null;
    }
};

function App() {
    const isDevMode = useDevMode();
    const remoteNnueManager = useRemotePrivateNnueManager();
    const [panelPosition, setPanelPosition] = useState<{
        label?: string;
        sfen: string;
        moves?: string[];
    }>({ label: "現在局面", sfen: "startpos", moves: [] });
    const [initialReview] = useState<{ sfen: string; moves: string[] } | undefined>(
        readReviewKifuFromSessionStorage,
    );

    return (
        <>
            <PageHeader items={[{ label: "ラム将棋" }]} right={<HeaderNav />} />
            {/* 対局レイアウトは 3 カラム (サイドバー+盤+棋譜 ≈ 1260px) で幅が広い。
                中央寄せ・横スクロールの管理は PCLayout 側 (overflow-x-auto + mx-auto
                w-max) が担うため、ここでは max-width を課さず全幅で渡す。max-width で
                挟むと中央寄せが効かず常時横スクロールになる。 */}
            <main className="flex w-full flex-col gap-3 pt-3">
                <ShogiMatch
                    key={initialReview ? "review" : "normal"}
                    engineOptions={engineOptions}
                    isDevMode={isDevMode}
                    manifestUrl={nnueManifestUrl}
                    remoteNnueManager={remoteNnueManager}
                    allowAnalysisDuringMatch={true}
                    defaultNnuePresetKey={import.meta.env.VITE_DEFAULT_NNUE_PRESET}
                    aiIconUrl={`${import.meta.env.BASE_URL}ramu.jpeg`}
                    onPositionSnapshot={(snapshot) => setPanelPosition(snapshot)}
                    initialReview={initialReview}
                    {...(initialReview
                        ? { defaultSides: { sente: { role: "human" }, gote: { role: "human" } } }
                        : {})}
                    getWasmMoveFeatures={getWasmMoveFeatures}
                />
                {isDevMode && <EngineControlPanel engine={panelEngine} position={panelPosition} />}
            </main>
        </>
    );
}

export default App;
