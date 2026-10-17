/**
 * レート制限 (HTTP 429 / WebSocket の RATE_LIMITED) を受けたときに画面へ出す文言。
 * zone のレート制限は本文が JSON でない HTML なので、本文の message ではなくステータスで判断して出す。
 */
export const RATE_LIMITED_MESSAGE = "操作が多すぎます。しばらく待ってからお試しください";
