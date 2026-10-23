import { open } from "@tauri-apps/plugin-dialog";

/** 評価関数のファイルを選ぶダイアログを開き、選んだパスを返す。 */
export async function requestNnueFilePath(): Promise<string | null> {
    const result = await open({
        filters: [{ name: "NNUE Files", extensions: ["nnue", "bin"] }],
        multiple: false,
        directory: false,
    });
    return typeof result === "string" ? result : null;
}
