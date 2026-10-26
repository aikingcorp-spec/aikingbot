// Copyright (c) 2026 AIKING. 4-part Windows version for a semver (prerelease counter as the 4th part).
function windowsVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]*?(\d+))?$/.exec(version);
  if (!match) throw new Error(`Unsupported version for Windows metadata: ${version}`);
  return `${match[1]}.${match[2]}.${match[3]}.${match[4] ?? 0}`;
}
module.exports = { windowsVersion };
