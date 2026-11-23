import { Button } from "@shogi/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageContainer } from "./PageContainer";
import { PageHeader } from "./PageHeader";

interface NotFoundPageProps {
    title?: string;
    destination?: { to: "/games" | "/public/games" | "/online"; label: string };
}

export function NotFoundPage({ title = "ページが見つかりません", destination }: NotFoundPageProps) {
    useEffect(() => {
        const meta = document.createElement("meta");
        meta.name = "robots";
        meta.content = "noindex";
        document.head.appendChild(meta);
        return () => meta.remove();
    }, []);

    return (
        <>
            <PageHeader items={[{ label: "ラム将棋", to: "/" }, { label: title }]} />
            <PageContainer width="form">
                <h1 className="text-xl font-bold">{title}</h1>
                <p>URL が変わったか、削除された可能性があります。</p>
                <div className="flex flex-wrap gap-2">
                    {destination && (
                        <Button asChild>
                            <Link to={destination.to}>{destination.label}</Link>
                        </Button>
                    )}
                    {!destination && (
                        <>
                            <Button asChild>
                                <Link to="/play">対局する</Link>
                            </Button>
                            <Button asChild variant="outline">
                                <Link to="/rshogi-viewer" search={{}}>
                                    観戦
                                </Link>
                            </Button>
                            <Button asChild variant="outline">
                                <Link to="/">トップ</Link>
                            </Button>
                        </>
                    )}
                </div>
            </PageContainer>
        </>
    );
}
