/**
 * ドラッグ・リサイズ可能なウィンドウの状態管理フック
 *
 * position と size を useReducer で統合し、
 * mousemove/mouseup グローバルリスナーを内包する。
 */
import { useEffect, useReducer, useRef } from "react";

interface Position {
    x: number;
    y: number;
}

interface Size {
    width: number;
    height: number;
}

type DragMode =
    | "none"
    | "move"
    | "resize-n"
    | "resize-s"
    | "resize-e"
    | "resize-w"
    | "resize-ne"
    | "resize-nw"
    | "resize-se"
    | "resize-sw";

interface WindowGeometry {
    position: Position;
    size: Size;
}

type GeometryAction =
    | { type: "MOVE"; position: Position }
    | { type: "RESIZE_SIZE"; size: Size }
    | { type: "RESIZE_POSITION"; position: Position }
    | { type: "RESIZE_BOTH"; position: Position; size: Size };

function geometryReducer(state: WindowGeometry, action: GeometryAction): WindowGeometry {
    switch (action.type) {
        case "MOVE":
            return { ...state, position: action.position };
        case "RESIZE_SIZE":
            return { ...state, size: action.size };
        case "RESIZE_POSITION":
            return { ...state, position: action.position };
        case "RESIZE_BOTH":
            return { position: action.position, size: action.size };
    }
}

interface DraggableWindowHandlers {
    onMoveStart: (e: React.MouseEvent) => void;
    createResizeHandler: (mode: DragMode) => (e: React.MouseEvent) => void;
}

interface UseDraggableWindowOptions {
    minWidth: number;
    minHeight: number;
    /** ウィンドウが開いているか（false の場合リスナーを登録しない） */
    open?: boolean;
}

export function useDraggableWindow(
    initialPosition: Position,
    initialSize: Size,
    options: UseDraggableWindowOptions,
): { geometry: WindowGeometry; handlers: DraggableWindowHandlers } {
    const { minWidth, minHeight, open = true } = options;

    const [geometry, dispatch] = useReducer(geometryReducer, {
        position: initialPosition,
        size: initialSize,
    });

    const dragMode = useRef<DragMode>("none");
    const dragStart = useRef<Position>({ x: 0, y: 0 });
    const initialPositionRef = useRef<Position>({ x: 0, y: 0 });
    const initialSizeRef = useRef<Size>({ width: 0, height: 0 });
    // 最新のジオメトリを参照するためのref（useEffect のクロージャ問題回避）
    const geometryRef = useRef(geometry);
    geometryRef.current = geometry;

    const onMoveStart = (e: React.MouseEvent) => {
        e.preventDefault();
        dragMode.current = "move";
        dragStart.current = { x: e.clientX, y: e.clientY };
        initialPositionRef.current = { ...geometryRef.current.position };
    };

    const createResizeHandler = (mode: DragMode) => (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragMode.current = mode;
        dragStart.current = { x: e.clientX, y: e.clientY };
        initialPositionRef.current = { ...geometryRef.current.position };
        initialSizeRef.current = { ...geometryRef.current.size };
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (dragMode.current === "none") return;

            const deltaX = e.clientX - dragStart.current.x;
            const deltaY = e.clientY - dragStart.current.y;
            const { size, position } = geometryRef.current;

            if (dragMode.current === "move") {
                const newX = initialPositionRef.current.x + deltaX;
                const newY = initialPositionRef.current.y + deltaY;
                const maxX = window.innerWidth - size.width;
                const maxY = window.innerHeight - size.height;
                dispatch({
                    type: "MOVE",
                    position: {
                        x: Math.max(0, Math.min(newX, maxX)),
                        y: Math.max(0, Math.min(newY, maxY)),
                    },
                });
            } else if (dragMode.current === "resize-e") {
                const newWidth = initialSizeRef.current.width + deltaX;
                const maxWidth = window.innerWidth - position.x;
                dispatch({
                    type: "RESIZE_SIZE",
                    size: {
                        ...size,
                        width: Math.max(minWidth, Math.min(newWidth, maxWidth)),
                    },
                });
            } else if (dragMode.current === "resize-w") {
                const newX = initialPositionRef.current.x + deltaX;
                const maxX = initialPositionRef.current.x + initialSizeRef.current.width - minWidth;
                const clampedX = Math.max(0, Math.min(newX, maxX));
                const clampedWidth =
                    initialPositionRef.current.x + initialSizeRef.current.width - clampedX;
                dispatch({
                    type: "RESIZE_BOTH",
                    size: { ...size, width: Math.max(minWidth, clampedWidth) },
                    position: { ...position, x: clampedX },
                });
            } else if (dragMode.current === "resize-s") {
                const newHeight = initialSizeRef.current.height + deltaY;
                const maxHeight = window.innerHeight - position.y;
                dispatch({
                    type: "RESIZE_SIZE",
                    size: {
                        ...size,
                        height: Math.max(minHeight, Math.min(newHeight, maxHeight)),
                    },
                });
            } else if (dragMode.current === "resize-n") {
                const newY = initialPositionRef.current.y + deltaY;
                const maxY =
                    initialPositionRef.current.y + initialSizeRef.current.height - minHeight;
                const clampedY = Math.max(0, Math.min(newY, maxY));
                const clampedHeight =
                    initialPositionRef.current.y + initialSizeRef.current.height - clampedY;
                dispatch({
                    type: "RESIZE_BOTH",
                    size: { ...size, height: Math.max(minHeight, clampedHeight) },
                    position: { ...position, y: clampedY },
                });
            } else if (dragMode.current === "resize-se") {
                const newWidth = initialSizeRef.current.width + deltaX;
                const newHeight = initialSizeRef.current.height + deltaY;
                const maxWidth = window.innerWidth - position.x;
                const maxHeight = window.innerHeight - position.y;
                dispatch({
                    type: "RESIZE_SIZE",
                    size: {
                        width: Math.max(minWidth, Math.min(newWidth, maxWidth)),
                        height: Math.max(minHeight, Math.min(newHeight, maxHeight)),
                    },
                });
            } else if (dragMode.current === "resize-ne") {
                const newWidth = initialSizeRef.current.width + deltaX;
                const newY = initialPositionRef.current.y + deltaY;
                const maxWidth = window.innerWidth - position.x;
                const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
                const maxY =
                    initialPositionRef.current.y + initialSizeRef.current.height - minHeight;
                const clampedY = Math.max(0, Math.min(newY, maxY));
                const clampedHeight =
                    initialPositionRef.current.y + initialSizeRef.current.height - clampedY;
                dispatch({
                    type: "RESIZE_BOTH",
                    size: { width: clampedWidth, height: Math.max(minHeight, clampedHeight) },
                    position: { ...position, y: clampedY },
                });
            } else if (dragMode.current === "resize-sw") {
                const newX = initialPositionRef.current.x + deltaX;
                const newHeight = initialSizeRef.current.height + deltaY;
                const maxX = initialPositionRef.current.x + initialSizeRef.current.width - minWidth;
                const clampedX = Math.max(0, Math.min(newX, maxX));
                const clampedWidth =
                    initialPositionRef.current.x + initialSizeRef.current.width - clampedX;
                const maxHeight = window.innerHeight - position.y;
                dispatch({
                    type: "RESIZE_BOTH",
                    size: {
                        width: Math.max(minWidth, clampedWidth),
                        height: Math.max(minHeight, Math.min(newHeight, maxHeight)),
                    },
                    position: { ...position, x: clampedX },
                });
            } else if (dragMode.current === "resize-nw") {
                const newX = initialPositionRef.current.x + deltaX;
                const newY = initialPositionRef.current.y + deltaY;
                const maxX = initialPositionRef.current.x + initialSizeRef.current.width - minWidth;
                const clampedX = Math.max(0, Math.min(newX, maxX));
                const clampedWidth =
                    initialPositionRef.current.x + initialSizeRef.current.width - clampedX;
                const maxY =
                    initialPositionRef.current.y + initialSizeRef.current.height - minHeight;
                const clampedY = Math.max(0, Math.min(newY, maxY));
                const clampedHeight =
                    initialPositionRef.current.y + initialSizeRef.current.height - clampedY;
                dispatch({
                    type: "RESIZE_BOTH",
                    size: {
                        width: Math.max(minWidth, clampedWidth),
                        height: Math.max(minHeight, clampedHeight),
                    },
                    position: { x: clampedX, y: clampedY },
                });
            }
        };

        const handleMouseUp = () => {
            dragMode.current = "none";
        };

        if (open) {
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        }

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [open, minWidth, minHeight]);

    return {
        geometry,
        handlers: { onMoveStart, createResizeHandler },
    };
}
