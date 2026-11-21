import { STUDY_HIRATE_SFEN } from "@shogi/app-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudyStartFromHirateButton } from "./StudyImportForm";

describe("StudyStartFromHirateButton", () => {
    it("平手の開始局面で、指し手の無いノートを作る", async () => {
        const onImport = vi.fn().mockResolvedValue(undefined);
        render(<StudyStartFromHirateButton onImport={onImport} />);
        fireEvent.click(screen.getByRole("button", { name: "平手の盤から始める" }));
        await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
        expect(onImport).toHaveBeenCalledWith({
            kind: "moves",
            startSfen: STUDY_HIRATE_SFEN,
            moves: [],
        });
    });

    it("作れなかったときは理由を出す", async () => {
        const onImport = vi.fn().mockRejectedValue(new Error("上限を超えています"));
        render(<StudyStartFromHirateButton onImport={onImport} />);
        fireEvent.click(screen.getByRole("button", { name: "平手の盤から始める" }));
        expect((await screen.findByRole("alert")).textContent).toBe("上限を超えています");
    });
});
