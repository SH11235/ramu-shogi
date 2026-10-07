import { cn } from "@shogi/design-system";
import {
    type CSSProperties,
    type ReactElement,
    type ReactNode,
    useEffect,
    useRef,
    useState,
} from "react";

interface RevealProps {
    children: ReactNode;
    className?: string;
    // 同じ行の要素を順に出すためのずらし (ms)
    delay?: number;
}

/** 画面に入った時に一度だけ、下からふわっと現れる。reduced-motion では最初から表示する。 */
export function Reveal({ children, className, delay = 0 }: RevealProps): ReactElement {
    const ref = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (!("IntersectionObserver" in window)) {
            setShown(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setShown(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "0px 0px -12% 0px", threshold: 0.1 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            data-reveal={shown ? "in" : "out"}
            style={{ "--d": `${delay}ms` } as CSSProperties}
            className={cn("ram-reveal", className)}
        >
            {children}
        </div>
    );
}
