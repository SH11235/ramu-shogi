import { NativeSelect } from "../../native-select";
import { resolveBatchWorkerCount } from "../utils/threadOptions";

export function BatchParallelismSelect({
    limit,
    value,
    onChange,
}: {
    limit: number;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <NativeSelect
            aria-label="同時に解析する局面の数"
            value={String(value === 0 ? 0 : resolveBatchWorkerCount(value, limit))}
            onChange={(event) => onChange(Number(event.target.value))}
        >
            <option value={0}>自動（{resolveBatchWorkerCount(0, limit)}）</option>
            {Array.from({ length: limit }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                    {count}
                </option>
            ))}
        </NativeSelect>
    );
}
