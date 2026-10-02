import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

interface AuthRequiredCardProps {
    title: string;
    details: string[];
    nextPath: string;
    loginLabel?: string;
}

export function AuthRequiredCard({
    title,
    details,
    nextPath,
    loginLabel = "Googleでログイン",
}: AuthRequiredCardProps): ReactElement {
    const authHref = `/auth?next=${encodeURIComponent(nextPath)}`;

    return (
        <section className="rounded-3xl border border-card-edge bg-card/80 p-5 shadow-puffy">
            <div className="flex flex-col gap-4">
                <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>

                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {details.map((detail) => (
                        <li key={detail}>{detail}</li>
                    ))}
                </ul>

                <div className="flex flex-col gap-2 sm:flex-row">
                    <a
                        href={authHref}
                        className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground shadow transition-colors hover:bg-primary/90"
                    >
                        {loginLabel}
                    </a>
                    <Link
                        to="/"
                        className="inline-flex h-10 items-center justify-center rounded-full border border-card-edge bg-card/80 px-4 text-sm font-bold shadow-puffy text-foreground transition-colors hover:bg-muted/50"
                    >
                        トップへ戻る
                    </Link>
                </div>
            </div>
        </section>
    );
}
