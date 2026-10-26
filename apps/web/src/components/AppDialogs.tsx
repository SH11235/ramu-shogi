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
import { type ReactElement, useSyncExternalStore } from "react";

interface DialogOptions {
    title: string;
    description?: string;
    actionLabel?: string;
}

interface ConfirmOptions extends DialogOptions {
    cancelLabel?: string;
}

type DialogRequest =
    | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
    | { kind: "alert"; options: DialogOptions; resolve: (ok: boolean) => void };

/** window.confirm / alert の代わり。順に 1 つずつ出し、答えを Promise で返す。 */
function createDialogQueue() {
    let queue: DialogRequest[] = [];
    // 閉じる途中（フェードアウト中）も中身を出しておくため、最後に出したものを覚えておく
    let lastShown: DialogRequest | undefined;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of listeners) listener();
    };
    const push = (request: DialogRequest) => {
        queue = [...queue, request];
        lastShown = queue[0];
        notify();
    };
    return {
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        current: (): DialogRequest | undefined => queue[0],
        lastShown: (): DialogRequest | undefined => lastShown,
        confirm: (options: ConfirmOptions) =>
            new Promise<boolean>((resolve) => push({ kind: "confirm", options, resolve })),
        alert: (options: DialogOptions) =>
            new Promise<void>((resolve) =>
                push({ kind: "alert", options, resolve: () => resolve() }),
            ),
        // 決定のボタンは押すと閉じる処理（onOpenChange）も呼ぶので、答えた相手を指定して二重に答えない
        answer: (request: DialogRequest, ok: boolean) => {
            const [head, ...rest] = queue;
            if (head !== request) return;
            queue = rest;
            lastShown = rest[0] ?? head;
            head.resolve(ok);
            notify();
        },
    };
}

const dialogQueue = createDialogQueue();

export const confirmDialog = dialogQueue.confirm;
export const alertDialog = dialogQueue.alert;

/** confirmDialog / alertDialog の表示先。アプリの根元に 1 つ置く。 */
export function AppDialogHost(): ReactElement {
    const request = useSyncExternalStore(dialogQueue.subscribe, dialogQueue.current);
    const shown = useSyncExternalStore(dialogQueue.subscribe, dialogQueue.lastShown);
    const options: ConfirmOptions | undefined = shown?.options;
    return (
        <AlertDialog
            open={request !== undefined}
            onOpenChange={(open) => {
                // Esc は「やめる」と同じ扱いにする
                if (!open && request) dialogQueue.answer(request, false);
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{options?.title}</AlertDialogTitle>
                    {options?.description && (
                        <AlertDialogDescription>{options.description}</AlertDialogDescription>
                    )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {shown?.kind === "confirm" && (
                        <AlertDialogCancel
                            onClick={() => request && dialogQueue.answer(request, false)}
                        >
                            {options?.cancelLabel ?? "やめる"}
                        </AlertDialogCancel>
                    )}
                    <AlertDialogAction onClick={() => request && dialogQueue.answer(request, true)}>
                        {options?.actionLabel ?? "OK"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
