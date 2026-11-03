import type { AfterglowApi } from '@shared/ipc';

declare global {
  interface Window {
    afterglow: AfterglowApi;
  }
}

export {};
