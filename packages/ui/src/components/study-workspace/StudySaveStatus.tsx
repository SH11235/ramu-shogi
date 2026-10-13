/**
 * 保存の状態の表示。
 *
 * ふだんは画面上部に小さく出すだけ（`StudySaveIndicator`）。利用者が何かしないと成果が
 * クラウドに届かないとき・失われうるときだけ、帯で目立たせる（`StudySaveNotice`）。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { AlertIcon, CloudCheckIcon, CloudUploadIcon, DeviceIcon } from "./StudyIcons";

/**
 * 保存の状態。`@shogi/study-client` の `StudySaveStatus` をそのまま渡せる形にしている
 * （ui は study-client に依存しないので、使う項目だけを構造で受ける）。
 */
export interface StudyWorkspaceSaveStatus {
    state: "local" | "pending" | "synced" | "limit_exceeded" | "error";
    /** `local` / `error` の理由（`anonymous` / `signed_out` / `other_account` / `storage_*` / `deleted_remotely` / `rejected`）。 */
    reason: string | null;
    /** `limit_exceeded` のとき、超えた上限の名前。 */
    limit: string | null;
    /** 通信の失敗などで再送を待っている。 */
    retrying: boolean;
}

/** 上限の名前（サーバーの `LIMIT_EXCEEDED` の `limit`）を利用者向けの言葉にする。 */
const LIMIT_TEXT: Record<string, string> = {
    studiesPerUser: "研究ノートの数",
    nodesPerStudy: "局面の数",
    lineLength: "手順の長さ",
    layersPerStudy: "解析の設定の数",
    treeBytes: "棋譜と変化の大きさ",
    layerResultsBytes: "解析結果の大きさ",
    commentBytes: "コメントの長さ",
    titleLength: "表題の長さ",
};

interface IndicatorView {
    icon: ReactElement;
    text: string;
    /** 目立たせる（利用者の対応が要る）。 */
    attention: boolean;
}

function indicatorView(status: StudyWorkspaceSaveStatus): IndicatorView {
    switch (status.state) {
        case "synced":
            return { icon: <CloudCheckIcon />, text: "クラウドに保存済み", attention: false };
        case "pending":
            return {
                icon: <CloudUploadIcon />,
                text: status.retrying ? "クラウドへ再送待ち" : "クラウドへ保存中",
                attention: false,
            };
        case "limit_exceeded":
            return { icon: <AlertIcon />, text: "クラウドの上限超過", attention: true };
        case "error":
            return {
                icon: <AlertIcon />,
                text: status.reason === "deleted_remotely" ? "削除済み" : "保存に失敗",
                attention: true,
            };
        default:
            return { icon: <DeviceIcon />, text: "このブラウザに保存済み", attention: false };
    }
}

interface StudySaveIndicatorProps {
    status: StudyWorkspaceSaveStatus;
    /** ログインへ進む（未ログインのときの案内に使う）。 */
    onLogin?: () => void;
    /**
     * 保存先がこの端末だけの環境（ログインの仕組みが無い Desktop）。「この端末に保存済み」と出し、
     * ログインの案内は出さない。
     */
    localOnly?: boolean;
    className?: string;
}

/** 保存の状態（1 行、控えめ）。未ログインのときは「ログインするとクラウドにも保存できます」を添える。 */
export function StudySaveIndicator({
    status,
    onLogin,
    localOnly = false,
    className,
}: StudySaveIndicatorProps): ReactElement {
    const base = indicatorView(status);
    const view =
        localOnly && status.state === "local" ? { ...base, text: "この端末に保存済み" } : base;
    const loginText =
        localOnly || status.state !== "local"
            ? null
            : status.reason === "anonymous"
              ? "ログインするとクラウドにも保存できます"
              : status.reason === "signed_out"
                ? "ログインするとクラウドへの保存を再開します"
                : null;
    return (
        <div
            className={cn(
                "flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs",
                view.attention ? "text-destructive" : "text-muted-foreground",
                className,
            )}
        >
            <output className="flex items-center gap-1" aria-label={`保存の状態: ${view.text}`}>
                {view.icon}
                <span>{view.text}</span>
            </output>
            {loginText && <span aria-hidden="true">・</span>}
            {loginText &&
                (onLogin ? (
                    <button
                        type="button"
                        onClick={onLogin}
                        className="relative rounded-sm text-wafuu-ai underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-2.5 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        {loginText}
                    </button>
                ) : (
                    <span>{loginText}</span>
                ))}
        </div>
    );
}

interface StudySaveNoticeProps {
    status: StudyWorkspaceSaveStatus;
    /** 止まっている送信をもう一度試す。 */
    onRetry?: () => void;
    /** このブラウザからもノートを消す（他の端末で削除されたとき）。 */
    onDiscard?: () => void;
    /** 保存先がこの端末だけの環境（Desktop）。保存に失敗したときの文言を「端末」にする。 */
    localOnly?: boolean;
}

/** 対応が要る保存の問題を帯で出す。問題が無ければ何も出さない。 */
export function StudySaveNotice({
    status,
    onRetry,
    onDiscard,
    localOnly = false,
}: StudySaveNoticeProps): ReactElement | null {
    const notice = ((): { text: string; action?: ReactNode; tone: "error" | "warning" } | null => {
        const retry = onRetry ? (
            <NoticeButton onClick={onRetry}>もう一度保存する</NoticeButton>
        ) : undefined;
        if (status.state === "limit_exceeded") {
            const what = (status.limit && LIMIT_TEXT[status.limit]) ?? "保存できる量";
            return {
                tone: "warning",
                text: `このブラウザには保存済みですが、${what}がクラウドの上限を超えたため、クラウドへの保存が止まっています。`,
                action: retry,
            };
        }
        if (status.state === "local" && status.reason === "other_account") {
            return {
                tone: "warning",
                text: "別のアカウントで作ったノートです。いまのアカウントには保存されません（このブラウザには保存されます）。",
            };
        }
        if (status.state !== "error") return null;
        switch (status.reason) {
            case "deleted_remotely":
                return {
                    tone: "error",
                    text: "このノートは他の端末で削除されました。ここでの変更はクラウドに保存されません。",
                    action: onDiscard ? (
                        <NoticeButton onClick={onDiscard}>このブラウザからも消す</NoticeButton>
                    ) : undefined,
                };
            case "storage_quota":
                return {
                    tone: "error",
                    text: `${localOnly ? "端末" : "ブラウザ"}の保存容量が足りず、変更を保存できませんでした。不要なデータを消してから、もう一度操作してください。`,
                };
            case "storage_unavailable":
                return {
                    tone: "error",
                    text: localOnly
                        ? "この端末では保存領域が使えないため、変更を保存できません。"
                        : "このブラウザでは保存領域が使えないため、変更を保存できません（プライベートブラウズでは保存できないことがあります）。",
                };
            case "storage_failed":
                return {
                    tone: "error",
                    text: `${localOnly ? "端末" : "ブラウザ"}への保存に失敗しました。直前の変更は保存されていない可能性があります。`,
                };
            default:
                return {
                    tone: "error",
                    text: "クラウドへの保存に失敗しました。このブラウザには保存されています。",
                    action: retry,
                };
        }
    })();
    if (!notice) return null;
    return (
        <div
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm",
                notice.tone === "error"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-status-warning-border bg-status-warning-bg text-status-warning",
            )}
        >
            <AlertIcon />
            <p className="min-w-0 flex-1">{notice.text}</p>
            {notice.action}
        </div>
    );
}

function NoticeButton({
    onClick,
    children,
}: {
    onClick: () => void;
    children: ReactNode;
}): ReactElement {
    return (
        <button
            type="button"
            onClick={onClick}
            className="shrink-0 rounded-md border border-current px-3 py-1 text-xs font-medium transition-colors hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            {children}
        </button>
    );
}
