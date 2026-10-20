// Keep npm's complete dependency tree outside ASAR and electron-builder's dependency filters.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function installPackagedProviderRuntime(source, resources) {
  const target = path.join(resources, 'provider-runtime', 'bin');
  const required = ['node.exe', 'npm.cmd', 'node_modules/npm/bin/npm-cli.js', 'node_modules/npm/LICENSE', 'LICENSE'];
  for (const name of required) if (!fs.statSync(path.join(source, name)).isFile()) throw new Error('Missing provider runtime input: ' + name);
  fs.cpSync(source, target, { recursive: true, dereference: true });
  for (const name of required) if (!fs.statSync(path.join(target, name)).isFile()) throw new Error('Missing packaged provider runtime: ' + name);
  // No globally installed Node/npm may satisfy this check.
  const result = spawnSync(path.join(target, 'node.exe'), [path.join(target, 'node_modules/npm/bin/npm-cli.js'), '--version'], {
    cwd: target, encoding: 'utf8', timeout: 30000,
    env: { HOME: target, USERPROFILE: target, SystemRoot: process.env.SystemRoot, PATH: target, TEMP: process.env.TEMP, TMP: process.env.TMP },
  });
  const version = result.stdout?.trim();
  if (result.error || result.status !== 0 || !/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Packaged npm failed with isolated PATH: ' + (result.error?.message || result.stderr || result.status));
  console.log('Verified packaged Node/npm with isolated PATH, npm ' + version);
  return version;
}
module.exports = { installPackagedProviderRuntime };
