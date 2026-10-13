// @vitest-environment node
// 対局画面を開くときに game_start から組み立てる snapshot が、backend の RoomDO が対局開始直後に送る
// snapshot と一致することを、起動した backend から記録した fixtures/backend-game-start.json と
// 突き合わせて確かめる。backendCommit は記録元の commit を示すだけで、いまの backend と一致することは
// 確かめない（この repo の CI から backend は見えない）。backend の RoomDO の対局開始まわりや
// 駒落ちプリセットの定義を変えたら、scripts/record-room-game-start.mjs で記録し直す

import type { GameStartEvent, RoomSettings, SnapshotPayload } from "@shogi/match-client";
import { resolveStartSfen, snapshotAtGameStart } from "@shogi/ui/components/online-game-state";
import { POSITION_PRESETS } from "@shogi/ui/components/PositionPresetSelector";
import { describe, expect, it } from "vitest";
import recorded from "./fixtures/backend-game-start.json";

interface GameStartCase {
    name: string;
    /** ルーム作成時の設定（既定値との差分） */
    create: Partial<RoomSettings>;
    /** 1 人目が待機中に変更する開始局面 */
    startSfen?: string;
}

interface RecordedCase extends GameStartCase {
    gameStart: GameStartEvent;
    snapshot: SnapshotPayload;
}

const BACKEND_CASES = recorded.cases as RecordedCase[];

// 空白の読み方と手数の補い方をクライアントが再現しない開始局面。game_start からは組み立てず、
// サーバーの snapshot を取り直す
const NOT_BUILT_LOCALLY = [
    "先頭に空白のある SFEN",
    "末尾に空白のある SFEN",
    "手番の前に空白が 2 つある SFEN",
    "タブ区切りの SFEN",
    "手数を省いた SFEN",
];

/** game_start から組み立てた snapshot が、サーバーの snapshot と全フィールドで一致する */
function expectSameAsServer(gameStart: GameStartEvent, snapshot: SnapshotPayload): void {
    const built = snapshotAtGameStart(gameStart);

    expect(built).not.toBeNull();
    // 観戦者数は game_start に無く、待機中の snapshot から引き継ぐ
    expect({ ...built, spectators: snapshot.spectators }).toEqual(snapshot);
}

describe("backend の RoomDO が送った game_start と対局開始直後の snapshot", () => {
    it("記録に、組み立てる開始局面と組み立てない開始局面の両方がある", () => {
        const names = BACKEND_CASES.map((recordedCase) => recordedCase.name);

        expect(names.filter((name) => NOT_BUILT_LOCALLY.includes(name))).toHaveLength(5);
        expect(names.filter((name) => !NOT_BUILT_LOCALLY.includes(name))).toHaveLength(12);
    });

    it.each(
        BACKEND_CASES.filter(({ name }) => !NOT_BUILT_LOCALLY.includes(name)),
    )("$name: 組み立てた snapshot がサーバーの snapshot と一致する", ({ gameStart, snapshot }) => {
        expect(snapshot.status).toBe("playing");
        expectSameAsServer(gameStart, snapshot);
    });

    it.each(
        BACKEND_CASES.filter(({ name }) => NOT_BUILT_LOCALLY.includes(name)),
    )("$name: 組み立てない", ({ gameStart }) => {
        expect(snapshotAtGameStart(gameStart)).toBeNull();
    });
});

// 駒落ちプリセットはクライアントとサーバーがそれぞれ局面に展開する。クライアントの表と、backend が
// 対局開始時に送った局面を照合する
describe("駒落ちプリセットの展開先", () => {
    const handicapPresets = POSITION_PRESETS.map(({ value }) => value).filter((value) =>
        value.startsWith("handicap:"),
    );

    it("選べる駒落ちプリセットがある", () => {
        expect(handicapPresets.length).toBeGreaterThan(0);
    });

    it.each(handicapPresets)("%s は backend の RoomDO が展開した局面と一致する", (preset) => {
        const recordedCase = BACKEND_CASES.find(
            ({ create, startSfen }) => (startSfen ?? create.startSfen) === preset,
        );
        if (!recordedCase) throw new Error(`記録に ${preset} で始めた対局がありません`);

        expect(recordedCase.snapshot.sfen).toBe(resolveStartSfen(preset));
    });
});
