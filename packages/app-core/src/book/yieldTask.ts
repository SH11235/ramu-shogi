/** Yield to another task without relying on background-tab timers. */
export function yieldTask(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof globalThis.MessageChannel !== "function") {
            setTimeout(resolve, 0);
            return;
        }
        const channel = new globalThis.MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}
