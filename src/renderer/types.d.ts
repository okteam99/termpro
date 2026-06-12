export {};

declare global {
  interface Window {
    termpro: {
      platform: string;
      requestHostPort(): void;
      pickDirectory(): Promise<string | null>;
      smokeOk(): void;
    };
  }
}
