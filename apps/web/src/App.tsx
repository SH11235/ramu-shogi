import type { EngineOption } from "@shogi/ui";
import { EngineControlPanel, ShogiMatch, useDevMode } from "@shogi/ui";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HeaderNav } from "./components/HeaderNav";
import { PageHeader } from "./components/PageHeader";
import { useRemotePrivateNnueManager } from "./hooks/useRemotePrivateNnueManager";
import { clearPlayHandoff, readPlayHandoff } from "./lib/playHandoff";
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

function App() {
    const isDevMode = useDevMode();
    const navigate = useNavigate();
    const remoteNnueManager = useRemotePrivateNnueManager();
    const [panelPosition, setPanelPosition] = useState<{
        label?: string;
        sfen: string;
        moves?: string[];
    }>({ label: "現在局面", sfen: "startpos", moves: [] });
    // 棋譜ビューアの「この局面から対局」などから引き継がれた局面。あれば、その局面を読み込んだ
    // 検討の状態で開く（対局は始めない。先後・相手・持ち時間を選んでから「対局開始」を押す）。
    // 読むのは最初の描画の 1 回だけで、消すのは描画が確定してから（描画のやり直しや
    // StrictMode の二重実行で、読む前に消えてしまわないようにする）。
    const [initialReview] = useState(readPlayHandoff);
    useEffect(() => {
        clearPlayHandoff();
    }, []);

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
                    // 読み込んだ棋譜（分岐・コメントごと）を研究ノートにして、その画面へ移る。
                    // 研究ノートの保存層は使うときだけ読み込む（対局だけの人には要らない）。
                    onOpenAsStudy={(tree, info) => {
                        void import("./lib/studyEntry")
                            .then(({ createStudyFromKifuTree }) =>
                                createStudyFromKifuTree(tree, info),
                            )
                            .then(({ studyId }) =>
                                navigate({ to: "/studies/$studyId", params: { studyId } }),
                            )
                            .catch((error: unknown) => {
                                console.error("[study] 研究ノートを作れませんでした", error);
                                window.alert(
                                    `研究ノートを作れませんでした: ${
                                        error instanceof Error ? error.message : String(error)
                                    }`,
                                );
                            });
                    }}
                    {...(initialReview
                        ? { defaultSides: { sente: { role: "human" }, gote: { role: "human" } } }
                        : {})}
                />
                {isDevMode && <EngineControlPanel engine={panelEngine} position={panelPosition} />}
            </main>
        </>
    );
}

export default App;
