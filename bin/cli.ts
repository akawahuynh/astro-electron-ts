#!/usr/bin/env node

import { input, select, confirm } from '@inquirer/prompts';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { readFile, writeFile, rename } from 'fs/promises';
import { detect } from 'detect-package-manager';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates');
const BASE_TEMPLATE_PATH = path.join(TEMPLATE_PATH, 'base');
const ELECTRON_TEMPLATE_PATH = path.join(TEMPLATE_PATH, 'base', 'electron');
const ASTRO_EXTENSIONS = ['.mjs', '.js', '.ts', '.cjs', '.mts', '.cts'];

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

async function detectPackageManager(): Promise<PackageManager> {
  try {
    const pm = await detect();
    return pm as PackageManager;
  } catch (error) {
    console.warn(
      'Failed to detect package manager:',
      error instanceof Error ? error.message : String(error),
      '\nDefaulting to npm'
    );
    return 'npm';
  }
}

async function copyTemplate(targetPath: string) {
  try {
    await fs.cp(BASE_TEMPLATE_PATH, targetPath, { recursive: true });
  } catch (error) {
    console.error(
      'Error copying template:',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

function getInstallCommand(
  packageManager: PackageManager,
  packageName?: string
): string {
  switch (packageManager) {
    case 'yarn':
      return packageName ? `yarn add ${packageName}` : 'yarn';
    case 'pnpm':
      return packageName ? `pnpm add ${packageName}` : 'pnpm install';
    case 'bun':
      return packageName ? `bun add ${packageName}` : 'bun install';
    default:
      return packageName ? `npm install ${packageName}` : 'npm install';
  }
}

function getRunCommand(packageManager: PackageManager, script: string): string {
  switch (packageManager) {
    case 'yarn':
      return `yarn ${script}`;
    case 'pnpm':
      return `pnpm run ${script}`;
    case 'bun':
      return `bun run ${script}`;
    default:
      return `npm run ${script}`;
  }
}

async function isAstroProject(): Promise<boolean> {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
    let packageJson;
    try {
      packageJson = JSON.parse(packageJsonContent);
    } catch {
      return false; // Invalid JSON means no valid Astro project
    }

    return !!(
      packageJson.dependencies?.astro || packageJson.devDependencies?.astro
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return false; // No package.json means no Astro project
      }
    }
    throw error; // Throw other errors
  }
}

async function isElectronProject(): Promise<boolean> {
  try {
    // Check package.json first
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);

    const hasElectronDep = !!(
      packageJson.dependencies?.electron ||
      packageJson.devDependencies?.electron
    );

    // Check for astro-electron-ts in the config
    let configContent = '';

    for (const ext of ASTRO_EXTENSIONS) {
      const configPath = path.join(process.cwd(), `astro.config${ext}`);
      try {
        configContent = await readFile(configPath, 'utf-8');
        break;
      } catch {
        continue;
      }
    }

    const hasElectronIntegration = configContent.includes('astro-electron-ts');

    return hasElectronDep && hasElectronIntegration;
  } catch {
    return false;
  }
}

async function hasMainField(): Promise<boolean> {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    return !!packageJson.main;
  } catch {
    return false;
  }
}

async function hasElectronFiles(): Promise<boolean> {
  try {
    const isJS = await isJavaScriptProject();
    const electronDir = path.join(process.cwd(), 'electron');
    const mainFile = path.join(electronDir, isJS ? 'main.js' : 'main.ts');
    const preloadFile = path.join(
      electronDir,
      isJS ? 'preload.js' : 'preload.ts'
    );

    // Check if all required files exist
    await Promise.all([
      fs.access(electronDir),
      fs.access(mainFile),
      fs.access(preloadFile),
    ]);

    return true;
  } catch {
    return false;
  }
}

async function getPackageManager(
  defaultPackageManager: PackageManager
): Promise<PackageManager> {
  if (defaultPackageManager !== 'npm') {
    // If we successfully detected a package manager other than npm, use it
    return defaultPackageManager;
  }

  // Only ask if we defaulted to npm due to detection failure
  return (await select({
    message: 'Which package manager would you like to use?',
    choices: [
      { value: 'npm', name: 'npm', description: 'Node Package Manager' },
      { value: 'yarn', name: 'yarn', description: 'Yarn' },
      { value: 'pnpm', name: 'pnpm', description: 'pnpm' },
      { value: 'bun', name: 'bun', description: 'Bun' },
    ],
    default: defaultPackageManager,
  })) as PackageManager;
}

// Add this type for handling Inquirer errors
type ExitPromptError = Error & {
  code?: string;
  exitCode?: number;
};

function isExitPromptError(error: unknown): error is ExitPromptError {
  return (
    error instanceof Error &&
    (error.message.includes('User force closed the prompt') ||
      error.message.includes('Prompt was canceled'))
  );
}

async function hasPackageJson(): Promise<boolean> {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    await fs.access(packageJsonPath);
    return true;
  } catch {
    return false;
  }
}

async function addElectronIntegration(): Promise<void> {
  try {
    let configPath: string | undefined;

    for (const ext of ASTRO_EXTENSIONS) {
      const filePath = path.join(process.cwd(), `astro.config${ext}`);
      try {
        await fs.access(filePath);
        configPath = filePath;
        break;
      } catch {
        continue;
      }
    }

    if (!configPath) {
      console.warn(
        'Could not find astro.config file. Skipping integration setup.'
      );
      return;
    }

    let content = await fs.readFile(configPath, 'utf-8');

    // Check if electron integration is already added
    if (content.includes('astro-electron-ts')) {
      return;
    }

    const isJS = await isJavaScriptProject();

    // Add the electron integration with different config based on JS/TS
    const electronConfig = isJS
      ? `
      electron({
        main: {
          entry: 'electron/main.js',
        },
        preload: {
          input: 'electron/preload.js',
        }
      })`
      : `electron()`; // Keep TypeScript config minimal

    // Add the electron integration
    if (content.includes('defineConfig({')) {
      // Config already has some configuration
      content = content.replace(
        'defineConfig({',
        `defineConfig({\n  integrations: [${electronConfig}],\n`
      );
    } else if (content.includes('defineConfig()')) {
      // Empty config
      content = content.replace(
        'defineConfig()',
        `defineConfig({\n  integrations: [${electronConfig}]\n})`
      );
    }

    // Add import statement if not present
    if (!content.includes('astro-electron-ts')) {
      content = `import electron from 'astro-electron-ts';\n${content}`;
    }

    await fs.writeFile(configPath, content, 'utf-8');
    console.log('✨ Added Electron integration to Astro config');

    // If JavaScript was chosen, rename and modify Electron files
    if (isJS) {
      const electronDir = path.join(process.cwd(), 'electron');
      await rename(
        path.join(electronDir, 'main.ts'),
        path.join(electronDir, 'main.js')
      );
      await rename(
        path.join(electronDir, 'preload.ts'),
        path.join(electronDir, 'preload.js')
      );

      // Modify main.js to remove TypeScript-specific syntax
      const mainJsPath = path.join(electronDir, 'main.js');
      let mainJsContent = await readFile(mainJsPath, 'utf-8');
      mainJsContent = mainJsContent.replace(
        /let win: BrowserWindow \| null;/,
        'let win;'
      );
      await writeFile(mainJsPath, mainJsContent, 'utf-8');
    }
  } catch (error) {
    console.error('Error adding Electron integration:', error);
    throw error;
  }
}

// Add this function to detect if it's a JavaScript project
async function isJavaScriptProject(): Promise<boolean> {
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);

    // Check if typescript is in dependencies or devDependencies
    const hasTypeScript = !!(
      packageJson.dependencies?.typescript ||
      packageJson.devDependencies?.typescript
    );

    return !hasTypeScript;
  } catch {
    // If we can't read package.json, default to JavaScript
    return true;
  }
}

// Modify getTemplateType function to handle cancellation properly
async function getTemplateType(): Promise<'javascript' | 'typescript'> {
  try {
    return (await select({
      message: 'Which language would you like to use?',
      choices: [
        {
          value: 'typescript',
          name: 'TypeScript',
          description: 'Strongly typed JavaScript (recommended)',
        },
        {
          value: 'javascript',
          name: 'JavaScript',
          description: 'Plain JavaScript',
        },
      ],
      default: 'typescript',
    })) as 'javascript' | 'typescript';
  } catch (error) {
    // Log cancellation message and rethrow
    if (isExitPromptError(error)) {
      console.log('\nOperation cancelled');
    }
    throw error;
  }
}

async function createNewProject(defaultPackageManager: PackageManager) {
  let projectName;
  try {
    projectName = await input({
      message: 'What is your project name?',
      default: 'astro-electron-app',
    });
  } catch (error) {
    if (isExitPromptError(error)) {
      console.log('\nOperation cancelled');
      return;
    }
    throw error;
  }

  try {
    const packageManager = await getPackageManager(defaultPackageManager);
    const templateType = await getTemplateType();
    const targetPath = path.join(process.cwd(), projectName);

    // Check if directory exists
    try {
      await fs.access(targetPath);
      const overwrite = await confirm({
        message: 'Directory already exists. Overwrite?',
        default: false,
      });

      if (!overwrite) {
        console.log('Operation cancelled');
        return;
      }
    } catch (error: unknown) {
      // Directory doesn't exist, which is what we want
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        console.error('Error checking directory:', error.message);
        throw error;
      }
    }

    // Copy template
    await copyTemplate(targetPath);

    // If JavaScript was chosen, modify package.json and astro.config.mjs
    if (templateType === 'javascript') {
      const packageJsonPath = path.join(targetPath, 'package.json');
      const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      // Remove TypeScript-related dependencies
      delete packageJson.dependencies['@astrojs/check'];
      delete packageJson.dependencies['typescript'];

      // Remove astro check from build script
      if (packageJson.scripts?.build) {
        packageJson.scripts.build = packageJson.scripts.build.replace(
          'astro check && ',
          ''
        );
      }

      await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

      // Add Electron configuration to astro.config.mjs
      const astroConfigPath = path.join(targetPath, 'astro.config.mjs');
      const astroConfigContent = `
        import { defineConfig } from 'astro/config';
        import electron from 'astro-electron-ts';

        export default defineConfig({
          integrations: [
            electron({
              main: {
                entry: 'electron/main.js', // Path to your Electron main file
              },
              preload: {
                input: 'electron/preload.js', // Path to your Electron preload file
              }
            })
          ]
        });
      `;
      await writeFile(astroConfigPath, astroConfigContent, 'utf-8');

      // Rename Electron files from .ts to .js
      const electronDir = path.join(targetPath, 'electron');
      await rename(
        path.join(electronDir, 'main.ts'),
        path.join(electronDir, 'main.js')
      );
      await rename(
        path.join(electronDir, 'preload.ts'),
        path.join(electronDir, 'preload.js')
      );

      // Modify main.js to remove TypeScript-specific syntax
      const mainJsPath = path.join(electronDir, 'main.js');
      let mainJsContent = await readFile(mainJsPath, 'utf-8');
      mainJsContent = mainJsContent.replace(
        /let win: BrowserWindow \| null;/,
        'let win;'
      );
      await writeFile(mainJsPath, mainJsContent, 'utf-8');
    }

    const installCommand = getInstallCommand(packageManager);
    const devCommand = getRunCommand(packageManager, 'dev');

    console.log(`
✨ Project created successfully!

Next steps:
1. cd ${projectName}
2. ${installCommand}
3. ${devCommand}
    `);
  } catch (error) {
    if (isExitPromptError(error)) {
      console.log('\nOperation cancelled');
      return;
    }
    throw error;
  }
}

async function copyElectronFiles(targetPath: string) {
  try {
    // Use ELECTRON_TEMPLATE_PATH directly instead of joining with BASE_TEMPLATE_PATH
    const targetElectronDir = path.join(targetPath, 'electron');

    // Check if electron directory already exists
    try {
      await fs.access(targetElectronDir);
      const overwrite = await confirm({
        message: 'Electron directory already exists. Overwrite?',
        default: false,
      });

      if (!overwrite) {
        console.log('Skipping electron files copy');
        return;
      }
    } catch {
      // Directory doesn't exist, proceed with copy
    }

    // Copy directly from the electron template directory
    await fs.cp(ELECTRON_TEMPLATE_PATH, targetElectronDir, { recursive: true });
    console.log('✨ Added Electron files to your project');
  } catch (error) {
    console.error(
      'Error copying electron files:',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

export async function main() {
  try {
    const defaultPackageManager = await detectPackageManager();
    let packageManager = defaultPackageManager;

    // First check if package.json exists
    const hasProject = await hasPackageJson();

    // If no package.json exists, only show create option
    if (!hasProject) {
      return createNewProject(defaultPackageManager);
    }

    // If we get here, package.json exists, so check project status
    const projectStatus = {
      hasAstro: await isAstroProject(),
      hasElectron: await isElectronProject(),
      mainExists: await hasMainField(),
      electronFilesExist: await hasElectronFiles(),
    };

    // If we're in an Astro project and everything is set up
    if (
      projectStatus.hasAstro &&
      projectStatus.hasElectron &&
      projectStatus.mainExists &&
      projectStatus.electronFilesExist
    ) {
      console.log('✨ Astro + Electron project detected!');
      console.log("You're all set! Run your dev command to get started.");
      return;
    }

    // If no Astro project detected, only show create option
    if (!projectStatus.hasAstro) {
      return createNewProject(defaultPackageManager);
    }

    // If we're in an Astro project but Electron needs to be added/configured
    if (
      projectStatus.hasAstro &&
      (!projectStatus.hasElectron ||
        !projectStatus.mainExists ||
        !projectStatus.electronFilesExist)
    ) {
      console.log('✨ Astro project detected!');

      if (!projectStatus.hasElectron) {
        console.log('ℹ️  Electron not detected in package.json');
      }
      if (!projectStatus.mainExists) {
        console.log('ℹ️  Main field missing in package.json');
      }
      if (!projectStatus.electronFilesExist) {
        const isJS = await isJavaScriptProject();
        const mainPath = `electron/main${isJS ? '.js' : '.ts'}`;
        const preloadPath = `electron/preload${isJS ? '.js' : '.ts'}`;
        console.log(
          `ℹ️  Required Electron files missing (${mainPath} and/or ${preloadPath})`
        );
      }

      let shouldAddElectron;
      try {
        shouldAddElectron = await confirm({
          message: `Would you like to ${
            !projectStatus.hasElectron ? 'add Electron' : 'configure Electron'
          } for this project?`,
          default: true,
        });
      } catch (error) {
        if (isExitPromptError(error)) {
          console.log('\nOperation cancelled');
          return;
        }
        throw error;
      }

      if (!shouldAddElectron) {
        console.log('Operation cancelled');
        return;
      }

      const currentDir = process.cwd();

      // Only copy electron files if they're missing
      if (!projectStatus.electronFilesExist) {
        await copyElectronFiles(currentDir);
      }

      // Add integration
      await addElectronIntegration();

      // Only modify package.json if main field is missing
      if (!projectStatus.mainExists) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        try {
          const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);
          packageJson.main = 'dist-electron/main.js';
          await writeFile(
            packageJsonPath,
            JSON.stringify(packageJson, null, 2)
          );
          console.log('✨ Added main field to package.json');
        } catch (error) {
          console.error('Error updating package.json:', error);
          throw error;
        }
      }

      // If no Electron detected, install dependencies
      if (!projectStatus.hasElectron) {
        console.log('Installing dependencies...');
        const dependencies = ['electron', 'astro-electron-ts'];
        const devDependencies = ['electron-builder'];

        // Install regular dependencies
        for (const dep of dependencies) {
          try {
            const { execSync } = await import('child_process');
            const installCmd = getInstallCommand(packageManager, dep);
            console.log(`Running: ${installCmd}`);
            execSync(installCmd, { stdio: 'inherit' });
          } catch (error) {
            console.error(`Failed to install ${dep}:`, error);
            throw error;
          }
        }

        // Install dev dependencies
        for (const dep of devDependencies) {
          try {
            const { execSync } = await import('child_process');
            const installCmd = getInstallCommand(packageManager, `-D ${dep}`);
            console.log(`Running: ${installCmd}`);
            execSync(installCmd, { stdio: 'inherit' });
          } catch (error) {
            console.error(`Failed to install ${dep}:`, error);
            throw error;
          }
        }
      }

      const devCommand = getRunCommand(packageManager, 'dev');
      console.log(`
✨ ${
        !projectStatus.hasElectron
          ? 'Electron and dependencies have been added'
          : projectStatus.electronFilesExist
          ? 'Main field has been configured'
          : 'Electron has been configured'
      } for your project!

Next steps:
  1. Add electron scripts to your package.json
  2. ${devCommand}
      `);
      return;
    }
  } catch (error) {
    if (isExitPromptError(error)) {
      // Don't log again since getTemplateType already logs
      return;
    }
    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Failed to run CLI:', error);
    process.exit(1);
  });
}

export { addElectronIntegration, isElectronProject };
