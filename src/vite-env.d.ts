/// <reference types="vite/client" />

// Web Speech API 类型定义
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

declare var SpeechRecognition: {
  new(): SpeechRecognition;
};

declare var webkitSpeechRecognition: {
  new(): SpeechRecognition;
};

// PIXI Live2D Display 扩展
declare module 'pixi-live2d-display/cubism4' {
  import { Container } from '@pixi/display';
  import type { Application } from '@pixi/app';
  import type { ObservablePoint } from '@pixi/math';

  export class Live2DModel extends Container {
    static from(modelPath: string, app?: Application): Promise<Live2DModel>;
    readonly internalModel: {
      coreModel: {
        setParameterValueById(id: string, value: number, weight?: number): void;
        getParameterValueById(id: string): number;
      };
    };
    motion(group: string, index: number): void;
    expression(name: string): void;
    anchor: ObservablePoint;
    destroy(): void;
  }
}
