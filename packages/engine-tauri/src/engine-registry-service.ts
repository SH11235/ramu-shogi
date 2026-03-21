import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** USI オプション定義（discriminated union） */
export type UsiOptionDef =
    | { name: string; type: "check"; default: boolean }
    | { name: string; type: "spin"; default: number; min: number; max: number }
    | { name: string; type: "combo"; default: string; vars: string[] }
    | { name: string; type: "string"; default: string }
    | { name: string; type: "filename"; default: string }
    | { name: string; type: "button" };

/** プローブ結果 */
export interface ProbeResult {
    name: string;
    author: string;
    options: UsiOptionDef[];
}

/** エンジン登録情報 */
export interface EngineRegistration {
    id: string;
    path: string;
    displayName: string;
    author: string;
    options: UsiOptionDef[];
}

/** 保存済みオプション値 */
export interface OptionValue {
    name: string;
    value: string | number | boolean;
}

export interface EngineRegistryService {
    probe(path: string): Promise<ProbeResult>;
    save(registration: EngineRegistration): Promise<void>;
    delete(id: string): Promise<void>;
    list(): Promise<EngineRegistration[]>;
    saveOptions(registrationId: string, options: OptionValue[]): Promise<void>;
    loadOptions(registrationId: string): Promise<OptionValue[]>;
}

export function createEngineRegistryService(): EngineRegistryService {
    return {
        async probe(path: string): Promise<ProbeResult> {
            return tauriInvoke<ProbeResult>("usi_engine_probe", { path });
        },

        async save(registration: EngineRegistration): Promise<void> {
            await tauriInvoke("usi_engine_save", { registration });
        },

        async delete(id: string): Promise<void> {
            await tauriInvoke("usi_engine_delete", { registration_id: id });
        },

        async list(): Promise<EngineRegistration[]> {
            return tauriInvoke<EngineRegistration[]>("usi_engine_list");
        },

        async saveOptions(registrationId: string, options: OptionValue[]): Promise<void> {
            await tauriInvoke("usi_engine_save_options", {
                registration_id: registrationId,
                options,
            });
        },

        async loadOptions(registrationId: string): Promise<OptionValue[]> {
            return tauriInvoke<OptionValue[]>("usi_engine_load_options", {
                registration_id: registrationId,
            });
        },
    };
}
