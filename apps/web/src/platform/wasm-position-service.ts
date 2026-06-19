import {
    type BoardStateJson,
    boardJsonToPositionState,
    type PositionService,
    type PositionState,
    positionStateToBoardJson,
    type ReplayResult,
    type ReplayResultJson,
} from "@shogi/app-core";
import {
    defaultWasmModuleUrl,
    ensureWasmModule,
    wasm_board_to_sfen,
    wasm_get_initial_board,
    wasm_get_legal_moves,
    wasm_parse_sfen_to_board,
    wasm_replay_moves_strict,
} from "@shogi/engine-wasm";
import { assetReturnsNotOk, isStaleAssetError, reloadForStaleDeploy } from "./stale-deploy-reload";

export const createWasmPositionService = (): PositionService => {
    let ready: Promise<void> | null = null;
    const ensureReady = () => {
        if (!ready) {
            ready = ensureWasmModule().catch(async (error: unknown) => {
                // 旧 hash の wasm が消えて 404 → compile 失敗のときは新バンドルを取りに reload する。
                // 署名一致は V8 ("HTTP status code is not ok") の fast-path。Firefox / Safari は
                // 文言が異なるため、署名不一致でも wasm アセット自体が 404 かを確認して stale 判定する。
                // reload しない (stale でない / クールダウン中) ときは呼び出し元のエラー表示へ流す。
                // 失敗 Promise はそのままキャッシュされ retry されない。wasm ロード失敗は実質
                // terminal で、回復手段は reload (自動 or ユーザ手動) のみのため意図どおり。
                if (isStaleAssetError(error) || (await assetReturnsNotOk(defaultWasmModuleUrl))) {
                    reloadForStaleDeploy();
                }
                throw error;
            });
        }
        return ready;
    };

    const toPosition = (json: BoardStateJson): PositionState => boardJsonToPositionState(json);

    return {
        async getInitialBoard(): Promise<PositionState> {
            await ensureReady();
            const result = wasm_get_initial_board() as BoardStateJson;
            return toPosition(result);
        },

        async parseSfen(sfen: string): Promise<PositionState> {
            await ensureReady();
            const result = wasm_parse_sfen_to_board(sfen) as BoardStateJson;
            return toPosition(result);
        },

        async boardToSfen(position: PositionState): Promise<string> {
            await ensureReady();
            const payload = positionStateToBoardJson(position);
            const boardToSfen = wasm_board_to_sfen as (board: BoardStateJson) => string;
            return boardToSfen(payload);
        },

        async getLegalMoves(
            sfen: string,
            moves?: string[],
            options?: { passRights?: { sente: number; gote: number } },
        ): Promise<string[]> {
            await ensureReady();
            const result = wasm_get_legal_moves(sfen, moves ?? undefined, options?.passRights);
            return result as unknown as string[];
        },

        async replayMovesStrict(
            sfen: string,
            moves: string[],
            options?: { passRights?: { sente: number; gote: number } },
        ): Promise<ReplayResult> {
            await ensureReady();
            const result = wasm_replay_moves_strict(
                sfen,
                moves,
                options?.passRights,
            ) as ReplayResultJson;
            return {
                applied: result.applied,
                lastPly: result.last_ply,
                position: toPosition(result.board),
                error: result.error ?? undefined,
            };
        },
    };
};
