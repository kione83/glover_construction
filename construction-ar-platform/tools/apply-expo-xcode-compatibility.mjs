import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function readOptionalFile(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.warn(`${label} compatibility patch skipped; file was not found at ${path}`);
      return null;
    }
    throw error;
  }
}

const sourcePath = resolve(
  "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Coding/JavaScriptCodable+Date.swift"
);
const original = "abs(milliseconds)";
const fixed = "Swift.abs(milliseconds)";
const source = await readOptionalFile(sourcePath, "ExpoModulesJSI Date");

if (source && !source.includes(fixed)) {
  if (source.includes(original)) {
    await writeFile(sourcePath, source.replace(original, fixed));
    console.log("Applied ExpoModulesJSI Xcode 26 Swift abs compatibility fix.");
  } else {
    console.warn(
      `ExpoModulesJSI Date compatibility patch skipped; expected source text was not found in ${sourcePath}`
    );
  }
}

const buildScriptPath = resolve(
  "node_modules/expo-modules-jsi/apple/scripts/build-xcframework.sh"
);
const buildScript = await readOptionalFile(buildScriptPath, "ExpoModulesJSI build script");
const buildCommand = "swift build -c release";
const safeBuildCommand =
  "CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO swift build -c release";

if (buildScript && !buildScript.includes(safeBuildCommand)) {
  if (!buildScript.includes(buildCommand)) {
    console.warn(
      `ExpoModulesJSI build script compatibility patch skipped; expected build command was not found in ${buildScriptPath}`
    );
  } else {
    await writeFile(buildScriptPath, buildScript.replace(buildCommand, safeBuildCommand));
    console.log("Disabled nested ExpoModulesJSI framework signing for file-provider-safe builds.");
  }
}

const runtimeSchedulerPath = resolve(
  "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h"
);
const runtimeScheduler = await readOptionalFile(runtimeSchedulerPath, "ExpoModulesJSI RuntimeScheduler");
const retainedConstructor = "SWIFT_RETURNS_RETAINED RuntimeScheduler(";

if (runtimeScheduler && runtimeScheduler.includes(retainedConstructor)) {
  await writeFile(
    runtimeSchedulerPath,
    runtimeScheduler.replaceAll(retainedConstructor, "RuntimeScheduler(")
  );
  console.log("Removed invalid RuntimeScheduler Swift ownership annotations for Xcode 26.");
}
