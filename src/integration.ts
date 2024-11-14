import fs from 'fs/promises';
import path from 'path';
import vitePluginElectron from 'vite-plugin-electron/simple';
import type { AstroIntegration, AstroConfig, RouteData } from 'astro';
import type { UserConfig as ViteUserConfig } from 'vite';

interface ElectronIntegrationConfig {
  main?: {
    entry?: string;
    vite?: Partial<ViteUserConfig>;
  };
  preload?: {
    input?: string;
    vite?: Partial<ViteUserConfig>;
  };
  renderer?: Partial<ViteUserConfig>;
}

export const integration = (
  integrationConfig: ElectronIntegrationConfig = {}
): AstroIntegration => ({
  name: 'astro-electron-ts',
  hooks: {
    'astro:config:setup': ({
      config,
      command,
      updateConfig,
    }: {
      config: AstroConfig;
      command: string;
      updateConfig: (newConfig: Partial<AstroConfig>) => void;
    }) => {
      if (command === 'build') {
        updateConfig({
          base: '/astro-electron-ts',
        });
      }

      // Add Vite plugin for Electron
      updateConfig({
        vite: {
          plugins: [
            vitePluginElectron({
              main: {
                entry: integrationConfig?.main?.entry || 'electron/main.ts',
                vite: integrationConfig?.main?.vite || config.vite,
              },
              preload: {
                input:
                  integrationConfig?.preload?.input || 'electron/preload.ts',
                vite: integrationConfig?.preload?.vite || config.vite,
              },
              renderer: integrationConfig?.renderer || undefined,
            }),
          ],
        },
      });
    },
    'astro:build:done': async ({
      dir,
      routes,
    }: {
      dir: URL;
      routes: RouteData[];
    }) => {
      await Promise.all(
        routes.map(async (route) => {
          if (route.distURL) {
            // Convert URL to a proper file path
            const filePath = route.distURL.pathname;
            // Remove any potential double slashes and fix Windows paths
            const normalizedPath = filePath
              .replace(/^\//, '')
              .replace(/\\/g, '/');

            try {
              const file = await fs.readFile(normalizedPath, 'utf-8');
              const localDir = path.dirname(normalizedPath);
              const relativePath = path
                .relative(localDir, new URL(dir).pathname)
                .replace(/\\/g, '/'); // Normalize path separators

              await fs.writeFile(
                normalizedPath,
                file.replaceAll(
                  /\/(astro-electron-ts|public)/g,
                  relativePath || '.'
                )
              );
            } catch (error) {
              console.error(`Error processing file ${normalizedPath}:`, error);
              throw error;
            }
          }
        })
      );
    },
  },
});
