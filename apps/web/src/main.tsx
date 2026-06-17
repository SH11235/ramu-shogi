import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initializePositionService } from "./platform/position-service-bootstrap";
import { installStaleDeployReloadHandlers } from "./platform/stale-deploy-reload";
import { router } from "./router";

// デプロイ更新後に旧バンドルが消えた chunk/wasm を要求して 404 になる場合の自動回復を仕込む
installStaleDeployReloadHandlers();

// PositionService を初期化（React レンダリング前に実行）
initializePositionService();

const rootElement = document.getElementById("root");

if (!rootElement) {
    throw new Error("Root element not found");
}

createRoot(rootElement).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>,
);
