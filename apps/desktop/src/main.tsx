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
// 入力欄へのテキストのドロップは止めないよう、ファイルのときだけにする。
const preventFileDrop = (event: DragEvent): void => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
};
window.addEventListener("dragover", preventFileDrop);
window.addEventListener("drop", preventFileDrop);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
        <StoredBoardPatternProvider>
            <App />
        </StoredBoardPatternProvider>
    </StrictMode>,
);
