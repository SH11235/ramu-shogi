/**
 * NNUE ファイル管理の定数
 */

/**
 * NNUE ファイルの最大サイズ（バイト）
 * 悪意のあるファイルや誤アップロード対策
 *
 * 現在の一般的な NNUE サイズ:
 * - HalfKA_hm 512: ~72MB
 * - HalfKA-1024-8-96: 270.5 MB
 * - HalfKA_hm-1024-8-96: 143.2 MB
 */
export const NNUE_MAX_SIZE_BYTES = 300 * 1024 * 1024; // 300MB

/**
 * 進捗通知のスロットリング間隔（ミリ秒）
 */
export const NNUE_PROGRESS_THROTTLE_MS = 100;

/**
 * IndexedDB データベース名
 */
export const NNUE_DB_NAME = "shogi-nnue-storage";

/**
 * IndexedDB バージョン
 */
export const NNUE_DB_VERSION = 1;

/**
 * NNUE フォーマット検出に必要なヘッダサイズ（バイト）
 */
export const NNUE_HEADER_SIZE = 1024;
