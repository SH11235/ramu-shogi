import { useNavigate } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useState } from "react";
import { HeaderNav } from "../../components/HeaderNav";
import { PageHeader } from "../../components/PageHeader";

export default function OnlinePage(): ReactElement {
    const navigate = useNavigate();
    const [joinRoomId, setJoinRoomId] = useState("");

    function handleJoin(): void {
        const id = joinRoomId.trim();
        if (!id) return;
        void navigate({
            to: "/online/$roomId",
            params: { roomId: id },
            search: { name: undefined, seat: undefined, mode: undefined },
        });
    }

    return (
        <>
            <PageHeader
                items={[{ label: "ラム将棋", to: "/" }, { label: "オンライン対局" }]}
                right={<HeaderNav />}
            />
            <div className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 py-10">
                <h1 className="text-2xl font-bold text-foreground">オンライン対局</h1>

                <button
                    type="button"
                    onClick={() => void navigate({ to: "/online/create" })}
                    className="w-full rounded-lg bg-primary py-3 text-base font-semibold text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    部屋を作成する
                </button>

                <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-sm text-muted-foreground">または</span>
                    <div className="h-px flex-1 bg-border" />
                </div>

                <div className="flex flex-col gap-2">
                    <label htmlFor="join-room-id" className="text-sm font-medium text-foreground">
                        ルームID を入力して参加
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="join-room-id"
                            type="text"
                            value={joinRoomId}
                            onChange={(e) => setJoinRoomId(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleJoin();
                            }}
                            placeholder="例: abc123"
                            className="flex h-10 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                        <button
                            type="button"
                            onClick={handleJoin}
                            disabled={!joinRoomId.trim()}
                            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground shadow-sm hover:bg-secondary/80 disabled:pointer-events-none disabled:opacity-50"
                        >
                            参加する
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
