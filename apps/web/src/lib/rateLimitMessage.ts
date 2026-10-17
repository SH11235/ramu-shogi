/** zone のレート制限は本文が JSON でない HTML なので、本文の message ではなくステータス 429 で判断して出す。 */
export const RATE_LIMITED_MESSAGE = "操作が多すぎます。しばらく待ってからお試しください";
