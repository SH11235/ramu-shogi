import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { StudyImportForm } from "./StudyImportForm";

const meta = {
    title: "研究ノート/取り込み欄",
    component: StudyImportForm,
    args: { onImport: fn(async () => {}) },
    decorators: [
        (Story) => (
            <div className="mx-auto max-w-[720px] p-4">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof StudyImportForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 一覧ページ。広い画面では貼り付けの欄とファイルの枠を横に並べ、狭い画面では縦に積む。 */
export const 一覧ページ: Story = { args: { sideBySide: true } };

/** ファイルを枠の上に持ってきたとき。 */
export const ファイルを持ってきたとき: Story = {
    args: { sideBySide: true },
    play: async ({ canvasElement }) => {
        const zone = canvasElement.querySelector("fieldset");
        zone?.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true }));
    },
};
