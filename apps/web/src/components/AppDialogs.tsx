import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shogi/ui/components/alert-dialog";
import { type ReactElement, useEffect, useRef, useSyncExternalStore } from "react";

interface DialogOptions {
    title: string;
    description?: string;
    actionLabel?: string;
}

interface ConfirmOptions extends DialogOptions {
    cancelLabel?: string;
    /**
     * 同じ key の確認がまだ答えを待っているあいだは、新しく出さずにその答えを共有する
     * （確認中にもう一度「戻る」を押したときなど）。`dismissDialog(key)` で取り下げられる。
     */
    key?: string;
}

interface DialogRequest {
    kind: "confirm" | "alert";
    options: ConfirmOptions;
    resolvers: Array<(ok: boolean) => void>;
}

/** window.confirm / alert の代わり。順に 1 つずつ出し、答えを Promise で返す。 */
function createDialogQueue() {
    let queue: DialogRequest[] = [];
    // 閉じる途中（フェードアウト中）も中身を出しておくため、最後に出したものを覚えておく
    let lastShown: DialogRequest | undefined;
    // Host にはダイアログを開くボタン（Trigger）が無いので、閉じたあとに戻す先を自分で覚える
    let returnFocus: Element | null = null;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of listeners) listener();
    };
    const request = (kind: DialogRequest["kind"], options: ConfirmOptions) =>
        new Promise<boolean>((resolve) => {
            const pending =
                options.key === undefined
                    ? undefined
                    : queue.find((item) => item.options.key === options.key);
            if (pending) {
                pending.resolvers.push(resolve);
                return;
            }
            if (queue.length === 0) returnFocus = document.activeElement;
            queue = [...queue, { kind, options, resolvers: [resolve] }];
            lastShown = queue[0];
            notify();
        });
    const settle = (target: DialogRequest, ok: boolean) => {
        if (!queue.includes(target)) return;
        queue = queue.filter((item) => item !== target);
        lastShown = queue[0] ?? target;
        for (const resolve of target.resolvers) resolve(ok);
        notify();
    };
    return {
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        current: (): DialogRequest | undefined => queue[0],
        lastShown: (): DialogRequest | undefined => lastShown,
        confirm: (options: ConfirmOptions) => request("confirm", options),
        alert: async (options: DialogOptions): Promise<void> => {
            await request("alert", options);
        },
        // 決定のボタンは押すと閉じる処理（onOpenChange）も呼ぶので、答えた相手を指定して二重に答えない
        answer: settle,
        /** 答えを待っている同じ key の確認を、false（やめる）として閉じる。 */
        dismiss: (key: string) => {
            for (const item of queue.filter((entry) => entry.options.key === key)) {
                settle(item, false);
            }
        },
        takeReturnFocus: (): Element | null => {
            const target = returnFocus;
            returnFocus = null;
            return target;
        },
    };
}

const dialogQueue = createDialogQueue();

export const confirmDialog = dialogQueue.confirm;
export const alertDialog = dialogQueue.alert;
export const dismissDialog = dialogQueue.dismiss;

/** 確認は「やめる」、お知らせは「OK」にフォーカスする。 */
function focusDefaultButton(
    cancel: HTMLButtonElement | null,
    action: HTMLButtonElement | null,
): void {
    (cancel ?? action)?.focus();
}

/** confirmDialog / alertDialog の表示先。アプリの根元に 1 つ置く。 */
export function AppDialogHost(): ReactElement {
    const request = useSyncExternalStore(dialogQueue.subscribe, dialogQueue.current);
    const shown = useSyncExternalStore(dialogQueue.subscribe, dialogQueue.lastShown);
    const options = shown?.options;
    const cancelRef = useRef<HTMLButtonElement>(null);
    const actionRef = useRef<HTMLButtonElement>(null);

    // 続けて出すときはダイアログを開いたまま中身だけ替わるので、そのたびに既定のボタンへ移す
    useEffect(() => {
        if (request) focusDefaultButton(cancelRef.current, actionRef.current);
    }, [request]);

    return (
        <AlertDialog
            open={request !== undefined}
            onOpenChange={(open) => {
                // Esc は「やめる」と同じ扱いにする
                if (!open && request) dialogQueue.answer(request, false);
            }}
        >
            <AlertDialogContent
                // お知らせ（alert）には「やめる」が無く、Radix の既定ではフォーカスが背後に残る
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    focusDefaultButton(cancelRef.current, actionRef.current);
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    const target = dialogQueue.takeReturnFocus();
                    if (target instanceof HTMLElement && target.isConnected) target.focus();
                }}
            >
                <AlertDialogHeader>
                    <AlertDialogTitle>{options?.title}</AlertDialogTitle>
                    {options?.description && (
                        <AlertDialogDescription>{options.description}</AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {shown?.kind === "confirm" && (
                        <AlertDialogCancel
                            ref={cancelRef}
                            onClick={() => request && dialogQueue.answer(request, false)}
                        >
                            {options?.cancelLabel ?? "やめる"}
                        </AlertDialogCancel>
                    )}
                    <AlertDialogAction
                        ref={actionRef}
                        onClick={() => request && dialogQueue.answer(request, true)}
                    >
                        {options?.actionLabel ?? "OK"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
