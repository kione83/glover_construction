#!/usr/bin/env python3
"""Compile production snapshot and offline-preview code into an isolated simulator QA app.
Usage: python3 tools/build-review-ui-harness.py /tmp/construction-review-qa
Install/launch on a simulator only; reads no existing project data.
"""
from pathlib import Path
import json
import platform
import plistlib
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/construction-review-qa').resolve()
app = output / 'ConstructionReviewQA.app'
app.mkdir(parents=True, exist_ok=True)
viewer = (root / 'ios/ConstructionARPlatform/SavedRoom3DView.swift').read_text().replace('import React', 'typealias RCTBubblingEventBlock = @convention(block) ([AnyHashable: Any]) -> Void')
(output / 'SavedRoom3DView.swift').write_text(viewer)
manager = (root / 'ios/ConstructionARPlatform/RoomScanViewManager.swift').read_text().split('// Native offline reference viewer:')[1]
manager = 'import UIKit\nimport Foundation\ntypealias RCTPromiseResolveBlock = @convention(block) (Any?) -> Void\ntypealias RCTPromiseRejectBlock = @convention(block) (String?, String?, NSError?) -> Void\nfunc RCTPresentedViewController() -> UIViewController? { UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\\.windows).first { $0.isKeyWindow }?.rootViewController }\n// Native offline reference viewer:'+manager
(output / 'ProjectDocumentPreview.swift').write_text(manager)
with (app / 'Info.plist').open('wb') as file:
    plistlib.dump({'CFBundleExecutable': 'ConstructionReviewQA', 'CFBundleIdentifier': 'com.constructionar.reviewqa', 'CFBundleName': 'Construction Review QA', 'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0', 'CFBundlePackageType': 'APPL', 'MinimumOSVersion': '16.4', 'LSRequiresIPhoneOS': True, 'UILaunchScreen': {}}, file)
(app / 'rooms.json').write_text((root / 'src/domain/fixtures/threeRoomAssembly.json').read_text())
sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], text=True).strip()
subprocess.run(['xcrun', 'swiftc', '-sdk', sdk, '-target', f'{platform.machine()}-apple-ios16.4-simulator', '-module-cache-path', str(output / 'ModuleCache'), str(output / 'SavedRoom3DView.swift'), str(output / 'ProjectDocumentPreview.swift'), str(root / 'tools/RoomAssemblyUIHarness.swift'), '-o', str(app / 'ConstructionReviewQA')], check=True)
print(app)
