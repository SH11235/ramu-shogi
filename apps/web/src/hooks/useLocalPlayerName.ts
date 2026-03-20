const STORAGE_KEY = "online-player-name";

export function getLocalPlayerName(): string {
    return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function saveLocalPlayerName(name: string): void {
    localStorage.setItem(STORAGE_KEY, name);
}
