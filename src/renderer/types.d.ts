export {};

declare global {
  interface Window {
    termpro: {
      platform: string;
      smoke: boolean;
      requestHostPort(): void;
      pickDirectory(): Promise<string | null>;
      onMenu(callback: (action: string) => void): () => void;
      smokeOk(): void;
      storeGet(): Promise<unknown>;
      storeSet(state: unknown): void;
    };
  }
}
