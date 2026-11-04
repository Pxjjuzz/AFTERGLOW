import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import MakerSquirrel from '@electron-forge/maker-squirrel';
import MakerZIP from '@electron-forge/maker-zip';

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
export default {
  packagerConfig: {
    asar: true,
    name: 'AfterGlowV2',
    executableName: 'afterglowv2',
    appBundleId: 'com.pxjuzz.afterglowv2',
    icon: './assets/icon',
    win32metadata: {
      CompanyName: 'AFTERGLOW',
      FileDescription: 'AfterGlowV2 — automatic constellation lyrics experience',
      ProductName: 'AfterGlowV2',
      InternalName: 'afterglowv2',
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'afterglowv2',
      authors: 'AFTERGLOW',
      description: 'Automatic ambient constellation lyrics for Windows.',
      setupIcon: './assets/icon.ico',
    }),
    new MakerZIP({}, ['win32']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'electron/main.ts',
          config: 'vite.main.config.mjs',
          target: 'main',
        },
        {
          entry: 'electron/preload.ts',
          config: 'vite.preload.config.mjs',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs',
        },
      ],
      hotRestart: true,
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
