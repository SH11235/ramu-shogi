import { Link } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";

interface AuthRequiredCardProps {
    title: string;
    description: ReactNode;
    details: string[];
    nextPath: string;
    loginLabel?: string;
}

export function AuthRequiredCard({
    title,
    description,
    details,
    nextPath,
    loginLabel = "Googleでログイン",
}: AuthRequiredCardProps): ReactElement {
    const authHref = `/auth?next=${encodeURIComponent(nextPath)}`;

    return (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-4">
                <div className="space-y-2">
                    <h2 className="text-lg font-semibold text-foreground">{title}</h2>
                    <p className="text-sm text-muted-foreground">{description}</p>
                </div>

                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {details.map((detail) => (
                        <li key={detail}>{detail}</li>
                    ))}
                </ul>

                <div className="flex flex-col gap-2 sm:flex-row">
                    <a
                        href={authHref}
                        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
                    >
                        {loginLabel}
                    </a>
                    <Link
                        to="/"
                        className="inline-flex h-10 items-center justify-center rounded-md border border-input px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
                    >
                        トップへ戻る
                    </Link>
                </div>
            </div>
        </section>
    );
}
