import type { Preview } from "@storybook/react-vite";
import "./storybook.css";

// staging では Storybook がアプリと同じオリジン（`/storybook/`）で動くので、story が書く設定
// （自動で読む、など）がアプリの localStorage に入ると、開いているアプリの動作が変わる。story からの
// 読み書きは別の名前の下に分ける。
const STORY_KEY_PREFIX = "storybook:";
const { getItem, setItem, removeItem } = Storage.prototype;
Storage.prototype.getItem = function (this: Storage, key: string) {
    return getItem.call(this, STORY_KEY_PREFIX + key);
};
Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, STORY_KEY_PREFIX + key, value);
};
Storage.prototype.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, STORY_KEY_PREFIX + key);
};

const preview: Preview = {
    parameters: {
        layout: "fullscreen",
        viewport: {
            options: {
                phone: {
                    name: "スマートフォン（375×812）",
                    styles: { width: "375px", height: "812px" },
                },
                desktop: { name: "PC（1280×800）", styles: { width: "1280px", height: "800px" } },
            },
        },
    },
    initialGlobals: { viewport: { value: "desktop", isRotated: false } },
};

export default preview;
