import { Switch } from "@shogi/ui/components/switch";
import { type ReactElement, useId, useState } from "react";
import { type UsageClient, usageClient } from "../../platform/usage";

const STATUS_NOTE = {
    gpc: "ブラウザの Global Privacy Control が有効なため、送っていません。",
    unsupported: "この環境では送っていません。",
} as const;

/** 利用状況の集計を送るかどうかの切り替えと、お問い合わせ用の番号 */
export function UsageSettings({ client = usageClient }: { client?: UsageClient }): ReactElement {
    const [status, setStatus] = useState(client.status);
    const [deviceId, setDeviceId] = useState(() =>
        client.status() === "enabled" ? client.deviceId() : null,
    );
    const [copyMessage, setCopyMessage] = useState<string | null>(null);
    const switchId = useId();

    const changeOptOut = (enabled: boolean) => {
        client.setOptOut(!enabled);
        const next = client.status();
        setStatus(next);
        setDeviceId(next === "enabled" ? client.deviceId() : null);
        setCopyMessage(null);
    };

    const copyDeviceId = (id: string) => {
        const failed = () =>
            setCopyMessage("コピーできませんでした。番号を選択してコピーしてください。");
        if (!navigator.clipboard) {
            failed();
            return;
        }
        navigator.clipboard
            .writeText(id)
            .then(() => setCopyMessage("コピーしました。"))
            .catch(failed);
    };

    if (status === "gpc" || status === "unsupported") {
        return <p className="mt-2">{STATUS_NOTE[status]}</p>;
    }

    return (
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-border p-4">
            <div className="flex items-center justify-between gap-4">
                <label htmlFor={switchId} className="text-foreground">
                    利用状況の集計に協力する
                </label>
                <Switch
                    id={switchId}
                    checked={status === "enabled"}
                    onCheckedChange={changeOptOut}
                />
            </div>
            {deviceId && (
                <div className="flex flex-col gap-1">
                    <span>この端末の番号（お問い合わせ用）</span>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 break-all rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">
                            {deviceId}
                        </code>
                        <button
                            type="button"
                            onClick={() => copyDeviceId(deviceId)}
                            className="shrink-0 rounded-md border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                        >
                            コピー
                        </button>
                    </div>
                    {copyMessage && <output>{copyMessage}</output>}
                </div>
            )}
        </div>
    );
}
