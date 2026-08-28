import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve(
  "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift"
);
const buildScriptPath = resolve(
  "node_modules/expo-modules-jsi/apple/scripts/build-xcframework.sh"
);
const original = "abs(milliseconds) <= maxJavaScriptDateMilliseconds";
const fixed = "Swift.abs(milliseconds) <= maxJavaScriptDateMilliseconds";
const source = await readFile(sourcePath, "utf8");

if (!source.includes(fixed)) {
  if (!source.includes(original)) {
    throw new Error(`Expected ExpoModulesJSI source was not found in ${sourcePath}`);
  }
  await writeFile(sourcePath, source.replace(original, fixed));
  console.log("Applied ExpoModulesJSI Xcode 26 Swift abs compatibility fix.");
}

const buildScript = await readFile(buildScriptPath, "utf8");
const buildSetting = "    CODE_SIGNING_ALLOWED=NO \\\n";
if (!buildScript.includes(buildSetting)) {
  const anchor = "    COMPILER_INDEX_STORE_ENABLE=NO \\\n";
  if (!buildScript.includes(anchor)) {
    throw new Error(`Expected ExpoModulesJSI build command was not found in ${buildScriptPath}`);
  }
  await writeFile(buildScriptPath, buildScript.replace(anchor, anchor + buildSetting));
  console.log("Disabled nested ExpoModulesJSI framework signing for file-provider-safe builds.");
}
