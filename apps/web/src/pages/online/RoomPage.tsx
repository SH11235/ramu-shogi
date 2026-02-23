import { useParams } from "@tanstack/react-router";

// 対局ルームページ（/online/:roomId）
// T-303 で本実装予定
export default function RoomPage() {
    const { roomId } = useParams({ from: "/online/$roomId" });
    return (
        <div className="mx-auto flex max-w-[600px] flex-col gap-4 p-6">
            <h1 className="text-2xl font-bold text-foreground">対局ルーム</h1>
            <p className="text-muted-foreground">ルームID: {roomId}</p>
            <p className="text-muted-foreground">（実装予定）</p>
        </div>
    );
}
