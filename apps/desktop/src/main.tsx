import { StoredBoardPatternProvider } from "@shogi/ui";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializePositionService } from "./platform/position-service-bootstrap";

// PositionService を初期化（React レンダリング前に実行）
initializePositionService();

// HTML のドロップを受けるため Tauri のドロップの処理を切っている（tauri.conf.json の dragDropEnabled）。
// 受け口の外に落としたファイルを WebView が開いて画面が置き換わらないよう、既定の動作を止める。
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
        <StoredBoardPatternProvider>
            <App />
        </StoredBoardPatternProvider>
    </StrictMode>,
);
