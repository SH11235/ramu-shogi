import babel from "@rolldown/plugin-babel";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { workspaceAliases } from "../../../tooling/workspace-aliases.ts";

const config: StorybookConfig = {
    stories: ["../src/**/*.stories.tsx"],
    framework: { name: "@storybook/react-vite", options: {} },
    // 駒の画像などは Web アプリの public にある（盤の部品はそのパスを前提にする）。
    staticDirs: ["../../../apps/web/public"],
    viteFinal: (viteConfig) => ({
        ...viteConfig,
        // アプリと同じく React Compiler を通す（通さないと、描画の回数が本番と変わる）。
        plugins: [
            ...(viteConfig.plugins ?? []),
            tailwindcss(),
            babel({ presets: [reactCompilerPreset()] }),
        ],
        // ほかのパッケージは、ビルドした dist ではなくソースを読む（ビルドし直さずに変更が出る）。
        resolve: { ...viteConfig.resolve, alias: workspaceAliases },
    }),
};

export default config;
