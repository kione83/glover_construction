#!/usr/bin/env python3
"""Exercise the production mounting math on macOS and typecheck the AR view for iOS."""
from pathlib import Path
import platform
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
source = (root / 'ios/ConstructionARPlatform/MeasurementARView.swift').read_text()
start = source.index('  static func mountingTransform(')
brace = source.index('{', start)
end, depth = brace + 1, 1
while depth:
    depth += (source[end] == '{') - (source[end] == '}')
    end += 1
method = source[start:end]
tests = r'''
func check(_ condition: Bool, _ label: String) { precondition(condition, label) }
func close(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ label: String) { check(simd_distance(a,b) < 0.00001, label) }
func point(_ m: simd_float4x4, _ p: SIMD3<Float>) -> SIMD3<Float> { let r = m * SIMD4(p.x,p.y,p.z,1); return SIMD3(r.x,r.y,r.z) }
let contact = SIMD3<Float>(2,3,-4)
let size = SIMD3<Float>(0.4,0.9,0.15)
let floor = Mount.mountingTransform(point: contact, normal: SIMD3(0,1,0), mode: "floor-mounted", dimensions: size, heading: 0)!
close(point(floor,SIMD3(0,-size.y/2,0)), contact, "Floor contact must be on bottom, not center")
let ceiling = Mount.mountingTransform(point: contact, normal: SIMD3(0,-1,0), mode: "ceiling-mounted", dimensions: size, heading: 0)!
close(point(ceiling,SIMD3(0,size.y/2,0)), contact, "Ceiling contact must be on top")
for yaw: Float in [0,0.5,1.2,2.8] {
  let normal = SIMD3<Float>(sin(yaw),0,cos(yaw))
  for heading: Float in [0,0.3,1.7] {
    let wall = Mount.mountingTransform(point: contact, normal: normal, mode: "wall-mounted", dimensions: size, heading: heading)!
    close(point(wall,SIMD3(0,0,-size.z/2)), contact, "Wall back face must remain at contact after rotation")
    let front = point(wall,SIMD3(0,0,size.z/2))
    close(front, contact + normal * size.z, "Front must face out of wall")
    check(abs(simd_determinant(wall)-1) < 0.00001,"Rigid right-handed scale")
  }
  let cameraOnWall = Mount.mountingTransform(point: contact, normal: normal, mode: "ceiling-mounted", dimensions: size, heading: 0)!
  close(point(cameraOnWall,SIMD3(0,size.y/2,0)),contact,"Camera ceiling mount can attach its top to an allowed wall")
}
check(Mount.mountingTransform(point: contact, normal: .zero, mode: "wall-mounted", dimensions: size, heading: 0) == nil,"Reject zero normal")
check(Mount.mountingTransform(point: contact, normal: SIMD3(0,1,0), mode: "wall-mounted", dimensions: size, heading: 0) == nil,"Reject wall product on horizontal support")
check(Mount.mountingTransform(point: contact, normal: SIMD3(0,1,0), mode: "floor-mounted", dimensions: SIMD3(-1,1,1), heading: 0) == nil,"Reject invalid size")
check(Mount.mountingTransform(point: contact, normal: SIMD3(0,1,0), mode: "floor-mounted", dimensions: size, heading: .nan) == nil,"Reject nonfinite pose")
print("Production mounting transforms passed: floor, ceiling, wall, alternate camera mount, rotation and invalid inputs")
'''
with tempfile.TemporaryDirectory(prefix='construction-mounting-') as tmp:
    tmp = Path(tmp)
    script = tmp / 'Mount.swift'
    script.write_text('import Foundation\nimport simd\nstruct Mount {\n' + method + '\n}\n' + tests)
    subprocess.run(['xcrun','swift','-module-cache-path',str(tmp/'cache'),str(script)],check=True)
    sdk = subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],text=True).strip()
    native = tmp/'MeasurementARView.swift'
    native.write_text(source.replace('import React','typealias RCTBubblingEventBlock = @convention(block) ([AnyHashable: Any]) -> Void'))
    subprocess.run(['xcrun','swiftc','-typecheck','-sdk',sdk,'-target',f'{platform.machine()}-apple-ios16.4-simulator','-module-cache-path',str(tmp/'ios-cache'),str(native)],check=True)
    print('Production MeasurementARView iOS typecheck passed')
