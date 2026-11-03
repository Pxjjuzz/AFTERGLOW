import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import MakerSquirrel from '@electron-forge/maker-squirrel';
import MakerZIP from '@electron-forge/maker-zip';

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
export default {
  packagerConfig: {
    asar: true,
    name: 'AFTERGLOW',
    executableName: 'afterglow',
    appBundleId: 'com.afterglow.app',
    icon: './assets/icon',
    win32metadata: {
      CompanyName: 'AFTERGLOW',
      FileDescription: 'AFTERGLOW — constellation lyrics experience',
      ProductName: 'AFTERGLOW',
      InternalName: 'afterglow',
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'afterglow',
      authors: 'AFTERGLOW',
      description: 'Every song creates its own universe.',
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
