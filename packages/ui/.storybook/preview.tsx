import type { Preview } from "@storybook/react-vite";
import "./storybook.css";

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
