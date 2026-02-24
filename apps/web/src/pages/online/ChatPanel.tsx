import type { RoomClient } from "@shogi/match-client";
import type { KeyboardEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

const CHAT_MAX_LENGTH = 200;
const SEAT_LABEL: Record<string, string> = { b: "▲", w: "△", s: "観" };

export interface ChatMessage {
    seat: string;
    name: string;
    text: string;
    id: number;
}

interface ChatPanelProps {
    messages: ChatMessage[];
    client: RoomClient | null;
    /** チャット送信可能か（観戦者も可能、接続前は不可） */
    canSend: boolean;
}

export function ChatPanel({ messages, client, canSend }: ChatPanelProps): ReactElement {
    const [inputText, setInputText] = useState("");
    const listRef = useRef<HTMLDivElement>(null);

    // 新しいメッセージで自動スクロール
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, []);

    function handleSend(): void {
        const text = inputText.trim();
        if (!text || !client) return;
        client.chat({ text });
        setInputText("");
    }

    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            handleSend();
        }
    }

    return (
        <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-card">
            <div className="px-3 py-2 border-b border-border">
                <span className="text-sm font-semibold text-foreground">チャット</span>
            </div>

            {/* メッセージ一覧 */}
            <div
                ref={listRef}
                className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1 min-h-0"
            >
                {messages.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                        まだメッセージはありません
                    </p>
                ) : (
                    messages.map((msg) => (
                        <div key={msg.id} className="text-xs leading-relaxed">
                            <span className="font-medium text-muted-foreground">
                                {SEAT_LABEL[msg.seat] ?? "？"} {msg.name}
                            </span>
                            <span className="text-foreground">: {msg.text}</span>
                        </div>
                    ))
                )}
            </div>

            {/* 入力フィールド */}
            <div className="flex gap-1 px-2 py-2 border-t border-border">
                <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value.slice(0, CHAT_MAX_LENGTH))}
                    onKeyDown={handleKeyDown}
                    placeholder="メッセージ..."
                    disabled={!canSend}
                    className="flex-1 h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                />
                <button
                    type="button"
                    onClick={handleSend}
                    disabled={!canSend || !inputText.trim()}
                    className="h-8 px-3 rounded-md bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50"
                >
                    送信
                </button>
            </div>
        </div>
    );
}
