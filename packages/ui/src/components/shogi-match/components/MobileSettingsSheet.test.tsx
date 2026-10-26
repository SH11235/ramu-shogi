import { NONE_NNUE_SELECTION } from "@shogi/app-core";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS } from "../types";
import { MobileSettingsSheet } from "./MobileSettingsSheet";

type Props = ComponentProps<typeof MobileSettingsSheet>;

const side = { enabled: true, mainMs: 600_000, byoyomiMs: 10_000 };

function renderSheet(overrides: Partial<Props> = {}) {
    const props: Props = {
        sides: { sente: { role: "human" }, gote: { role: "engine", engineId: "builtin" } },
        onSidesChange: vi.fn(),
        analysisEngineId: "builtin",
        onAnalysisEngineIdChange: vi.fn(),
        timeSettings: { sente: side, gote: side } as Props["timeSettings"],
        onTimeSettingsChange: vi.fn(),
        passRightsSettings: {
            enabled: true,
            senteInitialCount: 1,
            goteInitialCount: 1,
            confirmDialogThresholdMs: 0,
        },
        onPassRightsSettingsChange: vi.fn(),
        internalEngineId: "builtin",
        engineOptions: [
            { id: "builtin", label: "内蔵エンジン", kind: "internal" },
            { id: "usi", label: "外部エンジン", kind: "external" },
        ] as Props["engineOptions"],
        nnueList: [],
        presets: [],
        senteNnueSelection: NONE_NNUE_SELECTION,
        onSenteNnueSelectionChange: vi.fn(),
        goteNnueSelection: NONE_NNUE_SELECTION,
        onGoteNnueSelectionChange: vi.fn(),
        settingsLocked: false,
        isMatchRunning: false,
        isDevMode: true,
        engineThreads: { sente: 0, gote: 0 } as Props["engineThreads"],
        onEngineThreadsChange: vi.fn(),
        onStartMatch: vi.fn(),
        onStopMatch: vi.fn(),
        onResetToStartpos: vi.fn(),
        onOpenEngineManager: vi.fn(),
        displaySettings: DEFAULT_DISPLAY_SETTINGS,
        onDisplaySettingsChange: vi.fn(),
        onOpenAbout: vi.fn(),
        ...overrides,
    };
    return render(<MobileSettingsSheet {...props} />);
}

/** 対局にしか関係しない項目の目印 */
const MATCH_ONLY_TEXTS = [
    "☗先手",
    "☖後手",
    "プレイヤー",
    "持ち時間(秒)",
    "秒読み(秒)",
    "時間制限",
    "スレッド数",
    "変則ルール",
    "パス権を有効にする",
    "初期パス権数",
    "対局を開始",
    "対局を停止",
    "平手に戻す",
    "対局中は設定を変更できません",
];

describe("MobileSettingsSheet", () => {
    it("対局ページ（viewerMode でない）では、これまでどおり対局の設定を出す", () => {
        renderSheet();
        expect(screen.getAllByText("プレイヤー")).toHaveLength(2);
        expect(screen.getAllByText("持ち時間(秒)")).toHaveLength(2);
        expect(screen.getAllByText("秒読み(秒)")).toHaveLength(2);
        expect(screen.getByTitle("先手と後手の設定を入れ替える")).toBeTruthy();
        expect(screen.getByText("変則ルール")).toBeTruthy();
        expect(screen.getByRole("button", { name: "対局を開始" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "平手に戻す" })).toBeTruthy();
        expect(screen.getByText("解析エンジン")).toBeTruthy();
        expect(screen.getByText("表示設定")).toBeTruthy();
    });

    it("棋譜ビューアでは、対局にしか関係しない項目を出さない", () => {
        renderSheet({ viewerMode: true });
        for (const text of MATCH_ONLY_TEXTS) {
            expect(screen.queryByText(text), text).toBeNull();
        }
        expect(screen.queryByTitle("先手と後手の設定を入れ替える")).toBeNull();
    });

    it("棋譜ビューアでも、対局中・ロック中の表示や停止ボタンは出さない", () => {
        renderSheet({ viewerMode: true, isMatchRunning: true, settingsLocked: true });
        expect(screen.queryByText("対局を停止")).toBeNull();
        expect(screen.queryByText("対局中は設定を変更できません")).toBeNull();
    });

    it("棋譜ビューアでは、表示の設定だけを残す（解析しないので、解析の設定は出さない）", () => {
        renderSheet({ viewerMode: true });
        expect(screen.queryByText("解析エンジン")).toBeNull();
        expect(screen.queryByRole("button", { name: "外部エンジンを管理" })).toBeNull();
        expect(screen.getByText("表示設定")).toBeTruthy();
        expect(screen.getByText("マスの中の座標")).toBeTruthy();
        expect(screen.getByText("盤の外に筋・段を表示")).toBeTruthy();
        expect(screen.getByText("直前の手を強調")).toBeTruthy();
        expect(
            screen.getByRole("button", { name: "このアプリについて / ライセンス" }),
        ).toBeTruthy();
    });

    it("棋譜ビューアで表示設定だけが残るとき、先頭に空の枠や区切りだけの要素を残さない", () => {
        const { container } = renderSheet({
            viewerMode: true,
            engineOptions: undefined,
            onOpenEngineManager: undefined,
        });
        const root = container.firstElementChild as HTMLElement;
        expect(root.firstElementChild?.textContent).toContain("表示設定");
    });
});
