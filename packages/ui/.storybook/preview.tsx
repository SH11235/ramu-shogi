import type { Preview } from "@storybook/react-vite";
import "./storybook.css";

// staging では Storybook がアプリと同じオリジン（`/storybook/`）で動くので、story が書く設定
// （「読む」、など）がアプリの localStorage に入ると、開いているアプリの動作が変わる。story からの
// 読み書きは別の名前の下に分ける。
// sessionStorage は分けない（Storage.prototype は両方で共有なので、localStorage のときだけ付ける）。
const STORY_KEY_PREFIX = "storybook:";
const storyLocalStorage = window.localStorage;
const storyKey = (storage: Storage, key: string): string =>
    storage === storyLocalStorage ? STORY_KEY_PREFIX + key : key;
const { getItem, setItem, removeItem } = Storage.prototype;
Storage.prototype.getItem = function (this: Storage, key: string) {
    return getItem.call(this, storyKey(this, key));
};
Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, storyKey(this, key), value);
};
Storage.prototype.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, storyKey(this, key));
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
