/** Type declarations for optional dependencies */

declare module '@picovoice/porcupine-web' {
  export class Porcupine {
    static create(options: { keywords: any[] }): Promise<Porcupine>;
    start(stream: MediaStream, callback: (keywordIndex: number) => void): Promise<void>;
    release(): void;
  }
  export const PorcupineKeyword: {
    HeyComputer: any;
  };
}
