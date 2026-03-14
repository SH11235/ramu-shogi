// 待機画面・対局ルームページ（/online/:roomId）

import type { RoomInfo } from "@shogi/api-contract";
import { createWasmEngineClient } from "@shogi/engine-wasm";
import type { Seat, SnapshotPayload } from "@shogi/match-client";
import type { EngineOption } from "@shogi/ui";
import { OnlineGameView, PositionPresetSelector, ShogiMatch, useRoomConnection } from "@shogi/ui";
import { getRouteApi, useNavigate, useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";
import { syncProfileDisplayNameIfNeeded, useAuthSession } from "../../hooks/useAuthSession";
import { getLocalPlayerName, saveLocalPlayerName } from "../../hooks/useLocalPlayerName";
import { useOnlineAnalysis } from "../../hooks/useOnlineAnalysis";
import { useRemotePrivateNnueManager } from "../../hooks/useRemotePrivateNnueManager";

const nnueManifestUrl: string = (() => {
    const value = import.meta.env.VITE_NNUE_MANIFEST_URL as string | undefined;
    if (!value) {
        throw new Error("VITE_NNUE_MANIFEST_URL is required.");
    }
    return value;
})();

// ─── ルートAPI（loaderData アクセス用） ──────────────────────────────────────

const routeApi = getRouteApi("/online/$roomId");

// ─── サブコンポーネント ───────────────────────────────────────────────────────

function InviteLinkSection({
    inviteUrl,
    copied,
    onCopy,
}: {
    inviteUrl: string;
    copied: boolean;
    onCopy: () => void;
}): ReactElement {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">招待リンク</span>
            <div className="flex gap-2">
                <input
                    readOnly
                    value={inviteUrl}
                    className="flex h-10 flex-1 rounded-md border border-input bg-muted px-3 py-2 text-xs text-muted-foreground"
                />
                <button
                    type="button"
                    onClick={onCopy}
                    className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 transition-colors"
                >
                    {copied ? "コピーしました！" : "コピー"}
                </button>
            </div>
        </div>
    );
}

function PlayersStatusSection({
    roomInfoPlayers,
    snapshotPlayers,
}: {
    roomInfoPlayers: RoomInfo["players"];
    snapshotPlayers?: SnapshotPayload["players"] | null;
}): ReactElement {
    // スナップショットがあればリアルタイム情報を優先して表示
    if (snapshotPlayers) {
        return (
            <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-wafuu-shu">
                            先手（▲）:{" "}
                            {snapshotPlayers.b?.name ?? (
                                <span className="text-muted-foreground">待機中...</span>
                            )}
                        </span>
                        {snapshotPlayers.b?.online && (
                            <span className="text-xs text-status-online">● オンライン</span>
                        )}
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-wafuu-ai">
                            後手（△）:{" "}
                            {snapshotPlayers.w?.name ?? (
                                <span className="text-muted-foreground">待機中...</span>
                            )}
                        </span>
                        {snapshotPlayers.w?.online && (
                            <span className="text-xs text-status-online">● オンライン</span>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-wafuu-shu">
                        先手（▲）:{" "}
                        {roomInfoPlayers.b?.name ?? (
                            <span className="text-muted-foreground">待機中...</span>
                        )}
                    </span>
                    {roomInfoPlayers.b && (
                        <span className="text-xs text-muted-foreground">✓ 登録済み</span>
                    )}
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-wafuu-ai">
                        後手（△）:{" "}
                        {roomInfoPlayers.w?.name ?? (
                            <span className="text-muted-foreground">待機中...</span>
                        )}
                    </span>
                    {roomInfoPlayers.w && (
                        <span className="text-xs text-muted-foreground">✓ 登録済み</span>
                    )}
                </div>
            </div>
        </div>
    );
}

function JoinFormSection({
    joinName,
    onJoinNameChange,
    isJoining,
    joinSeat,
    error,
    isSeatTaken,
    onJoin,
}: {
    joinName: string;
    onJoinNameChange: (name: string) => void;
    isJoining: boolean;
    joinSeat: "b" | "w" | "s";
    error: string | null;
    isSeatTaken: (seat: "b" | "w") => boolean;
    onJoin: (seat: "b" | "w" | "s") => void;
}): ReactElement {
    return (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">参加する</h2>
            <div className="flex flex-col gap-1">
                <label htmlFor="join-name" className="text-sm text-foreground">
                    名前 <span className="text-destructive">*</span>
                </label>
                <input
                    id="join-name"
                    type="text"
                    value={joinName}
                    onChange={(e) => onJoinNameChange(e.target.value)}
                    placeholder="プレイヤー名を入力してください"
                    maxLength={20}
                    disabled={isJoining}
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col gap-2">
                <button
                    type="button"
                    onClick={() => onJoin("b")}
                    disabled={isJoining || !joinName.trim() || isSeatTaken("b")}
                    className="w-full rounded-lg bg-wafuu-shu py-2.5 text-sm font-semibold text-wafuu-shu-fg shadow hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {isJoining && joinSeat === "b"
                        ? "接続中..."
                        : isSeatTaken("b")
                          ? "先手（▲）は満席です"
                          : "先手として参加する"}
                </button>
                <button
                    type="button"
                    onClick={() => onJoin("w")}
                    disabled={isJoining || !joinName.trim() || isSeatTaken("w")}
                    className="w-full rounded-lg bg-wafuu-ai py-2.5 text-sm font-semibold text-wafuu-ai-fg shadow hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {isJoining && joinSeat === "w"
                        ? "接続中..."
                        : isSeatTaken("w")
                          ? "後手（△）は満席です"
                          : "後手として参加する"}
                </button>
                <button
                    type="button"
                    onClick={() => onJoin("s")}
                    disabled={isJoining || !joinName.trim()}
                    className="w-full rounded-lg bg-secondary py-2.5 text-sm font-semibold text-secondary-foreground shadow-sm hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {isJoining && joinSeat === "s" ? "接続中..." : "観戦者として参加する"}
                </button>
            </div>
        </div>
    );
}

function GameSettingsSection({
    settings,
    timeControlLabel,
    startSfenLabel,
    joined,
    currentStatus,
    displayStartSfen,
    onUpdateStartSfen,
}: {
    settings: RoomInfo["settings"];
    timeControlLabel: string;
    startSfenLabel: string;
    joined: boolean;
    currentStatus: string;
    displayStartSfen: string;
    onUpdateStartSfen: (sfen: string) => void;
}): ReactElement {
    return (
        <>
            {joined && currentStatus === "waiting" && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                    <span className="text-sm font-semibold text-foreground">開始局面を変更</span>
                    <PositionPresetSelector value={displayStartSfen} onChange={onUpdateStartSfen} />
                </div>
            )}
            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">対局設定</h2>
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                        <span>持ち時間</span>
                        <span>{timeControlLabel}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>開始局面</span>
                        <span>{startSfenLabel}</span>
                    </div>
                    {settings.passRights && (
                        <div className="flex justify-between">
                            <span>パス権</span>
                            <span>各 {settings.passRights.initialCount} 回</span>
                        </div>
                    )}
                    {settings.aiSupport && (
                        <div className="flex justify-between">
                            <span>AI サポート</span>
                            <span>
                                ▲{" "}
                                {settings.aiSupport.b.mode === "unlimited"
                                    ? "無制限"
                                    : `${settings.aiSupport.b.limitCount ?? 0} 回`}
                                {" / "}△{" "}
                                {settings.aiSupport.w.mode === "unlimited"
                                    ? "無制限"
                                    : `${settings.aiSupport.w.limitCount ?? 0} 回`}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// ─── ページコンポーネント ──────────────────────────────────────────────────────

export default function RoomPage(): ReactElement {
    const { roomId } = useParams({ from: "/online/$roomId" });
    const roomInfo = routeApi.useLoaderData() as RoomInfo;
    const { session } = useAuthSession();
    const remoteNnueManager = useRemotePrivateNnueManager();

    const navigate = useNavigate();
    const didAutofillNameRef = useRef(false);
    const [joinActionError, setJoinActionError] = useState<string | null>(null);
    const [isPreparingJoin, setIsPreparingJoin] = useState(false);
    const [pendingJoinSeat, setPendingJoinSeat] = useState<"b" | "w" | "s" | null>(null);

    const {
        joinName,
        setJoinName,
        joinSeat,
        isJoining,
        joinError,
        snapshot,
        joined,
        localStartSfen,
        gamePhase,
        reviewData,
        client,
        handleJoin,
        handleUpdateStartSfen,
        startReview,
    } = useRoomConnection({ roomId });

    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const timerId = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timerId);
    }, [copied]);

    useEffect(() => {
        if (didAutofillNameRef.current || joined) return;

        const autofillName = session?.authenticated
            ? session.user.displayName
            : getLocalPlayerName();

        if (!autofillName.trim() || joinName.trim()) return;
        setJoinName(autofillName);
        didAutofillNameRef.current = true;
    }, [joined, joinName, session, setJoinName]);

    async function handleJoinWithProfileSync(seat: "b" | "w" | "s"): Promise<void> {
        const trimmedName = joinName.trim();
        if (!trimmedName) return;

        setJoinActionError(null);
        setIsPreparingJoin(true);
        setPendingJoinSeat(seat);

        try {
            if (!session?.authenticated) saveLocalPlayerName(trimmedName);
            await syncProfileDisplayNameIfNeeded(session, trimmedName);
            handleJoin(seat);
        } catch (nextError) {
            setJoinActionError(
                nextError instanceof Error ? nextError.message : "ユーザー名の保存に失敗しました",
            );
            setIsPreparingJoin(false);
            setPendingJoinSeat(null);
        }
    }

    const aiSupport = roomInfo.settings.aiSupport;
    const analysis = useOnlineAnalysis(
        aiSupport?.searchDepth ?? null,
        aiSupport?.searchTimeMs ?? null,
    );
    const inviteUrl =
        typeof window !== "undefined" ? `${window.location.origin}/online/${roomId}` : "";

    // ─── ヘルパー ──────────────────────────────────────────────────────────────

    function isSeatTaken(seat: "b" | "w"): boolean {
        return (snapshot?.players ?? roomInfo?.players)?.[seat] != null;
    }

    // ─── コピー処理 ────────────────────────────────────────────────────────────

    async function handleCopyLink(): Promise<void> {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
        } catch {
            // フォールバック: 選択状態にする
        }
    }

    // ─── レンダリング ──────────────────────────────────────────────────────────

    // 検討フェーズ: ShogiMatch で棋譜検討
    const reviewEngineOptions: EngineOption[] = [
        {
            id: "wasm",
            label: "内蔵エンジン",
            createClient: () => createWasmEngineClient({ stopMode: "terminate" }),
            kind: "internal",
        },
    ];

    if (gamePhase === "reviewing" && reviewData) {
        return (
            <ShogiMatch
                engineOptions={reviewEngineOptions}
                defaultSides={{ sente: { role: "human" }, gote: { role: "human" } }}
                initialReview={{ sfen: reviewData.sfen, moves: reviewData.moves }}
                analysisMarkers={reviewData.analysisMarkers}
                manifestUrl={nnueManifestUrl}
                remoteNnueManager={remoteNnueManager}
            />
        );
    }

    // 対局フェーズ: OnlineGameView にインプレース切り替え（WebSocket 維持）
    if (gamePhase === "playing" && snapshot && client) {
        return (
            <OnlineGameView
                client={client}
                snapshot={snapshot}
                seat={joinSeat as Seat}
                roomId={roomId}
                analysis={analysis}
                manifestUrl={nnueManifestUrl}
                remoteNnueManager={remoteNnueManager}
                onStartReview={(data) => {
                    startReview(data);
                }}
                onExit={() => void navigate({ to: "/" })}
            />
        );
    }

    const timeControlLabel = (() => {
        const tc = roomInfo.settings.timeControl;
        if (tc.type === "byoyomi") {
            const min = tc.initialMs / 60_000;
            const sec = (tc.byoyomiMs ?? 0) / 1000;
            return `${min} 分 + 秒読み ${sec} 秒`;
        }
        const min = tc.initialMs / 60_000;
        const inc = (tc.fischerIncrementMs ?? 0) / 1000;
        return `フィッシャー ${min} 分 + ${inc} 秒`;
    })();

    const displayStartSfen = localStartSfen ?? roomInfo.settings.startSfen;
    const startSfenLabel = (() => {
        const s = displayStartSfen;
        if (s === "startpos") return "平手";
        if (s === "handicap:bishop") return "角落ち";
        if (s === "handicap:rook") return "飛車落ち";
        if (s === "handicap:rook-bishop") return "飛車角落ち";
        return "カスタム局面";
    })();
    const currentStatus = snapshot?.status ?? roomInfo.status;

    return (
        <>
            <PageHeader
                items={[
                    { label: "ラム将棋", to: "/" },
                    { label: "オンライン対局", to: "/online" },
                    { label: "対局ルーム" },
                ]}
                right={<HeaderNav />}
            />
            <div className="mx-auto flex max-w-[480px] flex-col gap-5 px-4 py-8">
                <h1 className="text-xl font-bold text-foreground">対局ルーム</h1>

                <InviteLinkSection
                    inviteUrl={inviteUrl}
                    copied={copied}
                    onCopy={() => void handleCopyLink()}
                />

                <PlayersStatusSection
                    roomInfoPlayers={roomInfo.players}
                    snapshotPlayers={snapshot?.players}
                />

                {!joined && (
                    <JoinFormSection
                        joinName={joinName}
                        onJoinNameChange={(name) => {
                            setJoinActionError(null);
                            setJoinName(name);
                        }}
                        isJoining={isJoining || isPreparingJoin}
                        joinSeat={pendingJoinSeat ?? joinSeat}
                        error={joinActionError ?? joinError}
                        isSeatTaken={isSeatTaken}
                        onJoin={(seat) => void handleJoinWithProfileSync(seat)}
                    />
                )}

                {joined && (
                    <div className="rounded-lg border border-status-online-border bg-status-online-bg p-4 text-sm text-status-online">
                        接続しました。対局開始を待っています...
                    </div>
                )}

                <GameSettingsSection
                    settings={roomInfo.settings}
                    timeControlLabel={timeControlLabel}
                    startSfenLabel={startSfenLabel}
                    joined={joined}
                    currentStatus={currentStatus}
                    displayStartSfen={displayStartSfen}
                    onUpdateStartSfen={handleUpdateStartSfen}
                />
            </div>
        </>
    );
}
