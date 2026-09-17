#!/usr/bin/env python3
"""Run the production SceneKit geometry helpers on macOS, without UIKit/React.
Requires Xcode. No copied transform or triangulation implementation.
"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'ios/ConstructionARPlatform/SavedRoom3DView.swift').read_text()
methods = ['buildRoom', 'buildElement', 'capturedPolygonNode', 'triangulateBoundary', 'makeWallQuad',
           'simdMatrix', 'matrixTransform', 'apply', 'numericArray', 'finiteNumber',
           'number', 'makeOpeningNode', 'material', 'furnitureColor', 'rotatedRoomMatrix', 'measurementText', 'editableRoom']
parts = []
for name in methods:
    marker = ('  static func ' if name in ['triangulateBoundary', 'rotatedRoomMatrix', 'measurementText'] else '  private func ') + name + '('
    start = source.index(marker)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    parts.append(source[start:end].replace('private func', 'func').replace('UIColor', 'NSColor'))
prelude = '''import Foundation
import SceneKit
import AppKit
import simd
final class Renderer {
  var roomNodes: [String: SCNNode] = [:]
  var roomTransforms: [String: [String: Any]] = [:]
  var roomCenters: [String: SIMD3<Float>] = [:]
  let contentNode = SCNNode()
  let debugRenderMode = "semantic"
  func buildMergedMesh(_ anchors: [[String: Any]], roomId: String, parent: SCNNode) {}
  func buildMesh(_ anchor: [String: Any], roomId: String, parent: SCNNode, anchorIndex: Int) {}
  func addAnnotation(anchor: SCNNode, roomId: String, title: String, dimensions: String, summary: Bool) {}
  var allowDirectManipulation = false
  var editingRoomId: String?
  var lockedRoomId: String?
  let transformDiagnostics = false
  var showMeasurements = false
  var measurementLabelCount = 0
  func logSemanticCorners(featureId: String, node: SCNNode, parent: SCNNode, width: Float, height: Float) {}
  func logComponent(kind: String, id: String, node: SCNNode, source: Any?, dimensions: [String: Any]?) {}
  func addMeasurementLabel(_ m: [[String: Any]], to: SCNNode, kind: String, dimensions: SIMD3<Float>) {}
'''
tests = r'''
let renderer = Renderer()
func rigid(_ yaw: Float, _ p: SIMD3<Float>) -> simd_float4x4 {
  var m = simd_float4x4(simd_quatf(angle: yaw, axis: SIMD3(0, 1, 0)))
  m.columns.3 = SIMD4(p.x, p.y, p.z, 1)
  return m
}
func close(_ a: SIMD3<Float>, _ b: SIMD3<Float>, _ label: String) {
  precondition(simd_distance(a, b) < 0.00001, "\(label): \(a) != \(b)")
}
func point(_ node: SCNNode, _ p: SIMD3<Float>) -> SIMD3<Float> {
  let v = node.simdWorldTransform * SIMD4(p.x, p.y, p.z, 1)
  return SIMD3(v.x, v.y, v.z)
}
// Non-yaw rotations must survive the row-major JSON / SIMD round trip too.
var tilted = simd_float4x4(simd_quatf(angle: 0.63, axis: simd_normalize(SIMD3<Float>(1, 2, 3))))
tilted.columns.3 = SIMD4(3.123456, -2.765432, 9.876543, 1)
let decoded = renderer.simdMatrix(from: renderer.matrixTransform(tilted))!
for i in 0..<4 { precondition(simd_length(decoded[i] - tilted[i]) < 0.000001) }
let captured = rigid(37 * .pi / 180, SIMD3(8.123456, -0.37, -6.765432))
let container = rigid(-23 * .pi / 180, SIMD3(-3, 2, 7))
func element(_ id: String, _ kind: String, _ w: Float, _ h: Float, _ d: Float, _ local: simd_float4x4) -> [String: Any] {
  ["id": id, "kind": kind, "dimensions": ["width": w, "height": h, "depth": d], "transform": renderer.matrixTransform(captured * local)]
}
let elements = [
  element("back", "wall", 4, 3, 0, rigid(0, SIMD3(0, 1.5, -2.5))),
  element("right", "wall", 5, 3, 0, rigid(.pi / 2, SIMD3(2, 1.5, 0))),
  element("front", "wall", 4, 3, 0, rigid(0, SIMD3(0, 1.5, 2.5))),
  element("left", "wall", 5, 3, 0, rigid(.pi / 2, SIMD3(-2, 1.5, 0))),
  element("floor", "floor", 4, 0, 5, matrix_identity_float4x4),
  element("door", "door", 0.9, 2.1, 0.04, rigid(0, SIMD3(0.5, 1.05, -2.5))),
  element("window", "window", 1, 1, 0.04, rigid(0, SIMD3(-0.5, 1.7, 2.5))),
  element("opening", "opening", 1, 2.2, 0.04, rigid(.pi / 2, SIMD3(2, 1.1, 0)))
]
func render(_ payload: [[String: Any]]) -> SCNNode {
  let room = SCNNode(); room.simdTransform = container
  for e in payload { renderer.buildElement(e, roomId: "fixture", parent: room, measurements: []) }
  return room
}
func check(_ room: SCNNode) {
  let n = room.childNodes
  close(point(n[0], SIMD3(2, -1.5, 0)), point(n[1], SIMD3(2.5, -1.5, 0)), "back/right")
  close(point(n[1], SIMD3(-2.5, -1.5, 0)), point(n[2], SIMD3(2, -1.5, 0)), "right/front")
  close(point(n[2], SIMD3(-2, -1.5, 0)), point(n[3], SIMD3(-2.5, -1.5, 0)), "front/left")
  close(point(n[3], SIMD3(2.5, -1.5, 0)), point(n[0], SIMD3(-2, -1.5, 0)), "left/back")
  for x: Float in [-2, 2] {
    close(point(n[4], SIMD3(x, 0, -2.5)), point(n[0], SIMD3(x, -1.5, 0)), "floor/back")
    close(point(n[4], SIMD3(x, 0, 2.5)), point(n[2], SIMD3(x, -1.5, 0)), "floor/front")
  }
  close(point(n[5], SIMD3(0, -1.05, 0)), point(n[0], SIMD3(0.5, -1.5, 0)), "door embedded in wall")
  close(SIMD3(n[4].simdWorldTransform.columns.0.x, n[4].simdWorldTransform.columns.0.y, n[4].simdWorldTransform.columns.0.z), SIMD3(n[0].simdWorldTransform.columns.0.x, n[0].simdWorldTransform.columns.0.y, n[0].simdWorldTransform.columns.0.z), "same floor/wall yaw")
  for node in n.prefix(4) {
    precondition(node.geometry!.elements[0].bytesPerIndex == 4, "wall indices must be UInt32/Int32")
  }
}
for kind in ["wall", "floor", "ceiling", "door", "opening", "window", "mesh", "furniture", "fixture"] {
  let color = (renderer.material(for: kind, category: "chair").diffuse.contents as! NSColor).usingColorSpace(.deviceRGB)!
  precondition(color.blueComponent >= color.redComponent, "warm material: \(kind)")
}
let room = render(elements); check(room)
let archive = try JSONSerialization.data(withJSONObject: elements)
let reopened = render(try JSONSerialization.jsonObject(with: archive) as! [[String: Any]])
check(reopened)
for (a, b) in zip(room.childNodes, reopened.childNodes) {
  close(point(a, .zero), point(b, .zero), "save/reopen")
}
// Room-wide centering/rotation changes only the common parent.
let before = simd_distance(point(room.childNodes[0], .zero), point(room.childNodes[5], .zero))
room.simdTransform = rigid(1.1, SIMD3(-8, 0, 6)); check(room)
precondition(abs(before - simd_distance(point(room.childNodes[0], .zero), point(room.childNodes[5], .zero))) < 0.00001)
// Concave captured footprint: six authoritative vertices, four local triangles.
let polygon: [SIMD3<Float>] = [SIMD3(0,0,0), SIMD3(3,0,0), SIMD3(3,0,1), SIMD3(1,0,1), SIMD3(1,0,3), SIMD3(0,0,3)]
for boundary in [polygon, Array(polygon.reversed())] {
  let indices = Renderer.triangulateBoundary(boundary)!
  precondition(indices.count == 12 && indices.allSatisfy { $0 >= 0 && $0 < boundary.count })
  var area: Float = 0
  for i in stride(from: 0, to: indices.count, by: 3) {
    let a = boundary[Int(indices[i])], b = boundary[Int(indices[i+1])], c = boundary[Int(indices[i+2])]
    area += simd_length(simd_cross(b-a, c-a)) / 2
  }
  precondition(abs(area - 5) < 0.00001, "concavity must not be filled")
}
var capturedFloor = elements[4]
capturedFloor["polygonCorners"] = polygon.map { ["x": $0.x, "y": $0.y, "z": $0.z] }
let polygonRoom = render([capturedFloor])
precondition(polygonRoom.childNodes[0].geometry!.sources(for: .vertex)[0].vectorCount == polygon.count)
precondition(Renderer.triangulateBoundary([.zero, .zero, .zero]) == nil)
precondition(Renderer.triangulateBoundary([SIMD3(.nan,0,0), .zero, SIMD3(1,0,1)]) == nil)
// Three serialized room scans share only their assembly parent.
let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String: Any]]
let assembly = SCNNode()
for (index, saved) in fixture.enumerated() {
  let id = saved["id"] as! String
  let node = SCNNode(); node.simdPosition.x = Float(index) * 6
  let scan = saved["roomScan"] as! [String: Any]
  for element in scan["elements"] as! [[String: Any]] {
    renderer.buildElement(element, roomId: id, parent: node, measurements: [])
  }
  assembly.addChildNode(node); renderer.roomNodes[id] = node
}
renderer.allowDirectManipulation = true; renderer.lockedRoomId = "room-1"
renderer.editingRoomId = "room-1"; precondition(renderer.editableRoom() == nil)
renderer.editingRoomId = "room-2"; precondition(renderer.editableRoom()?.0 == "room-2")
let a = assembly.childNodes[0], b = assembly.childNodes[1], cRoom = assembly.childNodes[2]
let aMatrix = a.simdTransform, cMatrix = cRoom.simdTransform
let localMatrices = b.childNodes.map { $0.simdTransform }
let center = SIMD3<Float>(0, 1.5, 0)
let beforePivot = point(b, center)
b.simdTransform = Renderer.rotatedRoomMatrix(b.simdTransform, radians: .pi / 2, center: center)
close(point(b, center), beforePivot, "assembly rotation pivot")
b.simdPosition += SIMD3(2, 0.25, -4)
for (node, original) in zip(b.childNodes, localMatrices) { precondition(node.simdTransform == original, "internal geometry modified") }
precondition(a.simdTransform == aMatrix && cRoom.simdTransform == cMatrix)
let savedPlacement = try JSONSerialization.data(withJSONObject: renderer.matrixTransform(b.simdTransform))
let restoredPlacement = try JSONSerialization.jsonObject(with: savedPlacement) as! [String: Any]
let restored = SCNNode(); renderer.apply(restoredPlacement, to: restored)
close(point(b, center), point(restored, center), "assembly reopen")
precondition(Renderer.measurementText([["dimension": "depth", "value": 2.25]]) == "D: 2.25 m")
precondition(Renderer.measurementText([["dimension": "height", "value": 3], ["dimension": "width", "value": 4], ["dimension": "depth", "value": 5]]) == "W: 4.00 m · D: 5.00 m · H: 3.00 m")
precondition(Renderer.measurementText([["dimension": "height", "value": 0]]) == "")
// Shared metadata must never collapse physical instances in the native renderer.
let chairs = SCNNode()
for i in 0..<4 {
  let pose = rigid(Float(i) * .pi / 2, SIMD3(Float(i) * 2, 0.5, Float(i)))
  let payload: [String: Any] = ["id": "chair-\(i)", "roomCaptureId": "room", "objectTypeId": "shared-chair", "kind": "furniture", "category": "chair", "dimensions": ["width": 0.5, "depth": 0.6, "height": 1.0], "transform": renderer.matrixTransform(pose)]
  renderer.buildElement(payload, roomId: "room", parent: chairs, measurements: [])
  let node = chairs.childNodes[i], box = node.geometry as! SCNBox
  precondition(box.width == 0.5 && abs(box.length - 0.6) < 0.00001 && box.height == 1)
  precondition(node.simdTransform == pose)
}
precondition(chairs.childNodes.count == 4)
precondition(Set(chairs.childNodes.compactMap { $0.name }).count == 4)
// Exercise production buildRoom, including the new proposed-placement path.
let hierarchy = Renderer()
func roomPayload(_ id: String, _ pose: simd_float4x4) -> [String: Any] {
  let children: [[String: Any]] = (0..<4).map { i in
    ["id": "chair-\(i)", "kind": "furniture", "category": "chair", "objectTypeId": "shared-chair", "dimensions": ["width": 0.5, "depth": 0.6, "height": 1], "transform": hierarchy.matrixTransform(rigid(Float(i), SIMD3(Float(i), 0.5, 1)))]
  }
  let placed: [String: Any] = ["id": "placed:proposed", "kind": "furniture", "category": "Proposed chair", "dimensions": ["width": 0.5, "depth": 0.6, "height": 1], "transform": hierarchy.matrixTransform(rigid(0.3, SIMD3(1, 0.5, 3)))]
  return ["id": id, "transform": hierarchy.matrixTransform(pose), "roomScan": ["elements": children, "measurements": []], "placedObjects": [placed]]
}
hierarchy.buildRoom(roomPayload("A", rigid(0, SIMD3(0,0,0))))
hierarchy.buildRoom(roomPayload("B", rigid(0, SIMD3(8,0,0))))
let roomA = hierarchy.roomNodes["A"]!, roomB = hierarchy.roomNodes["B"]!
let objectsB = roomB.childNodes.filter { $0.name?.hasPrefix("feature|") == true }
precondition(objectsB.count == 5, "four scanned chairs and one proposed chair must be rendered")
let localsB = objectsB.map { $0.simdTransform }, originalA = roomA.simdTransform
roomB.simdTransform = rigid(.pi / 2, SIMD3(20,2,-4))
for (node, local) in zip(objectsB, localsB) {
  precondition(node.simdTransform == local)
  precondition(node.simdWorldTransform == roomB.simdWorldTransform * local)
}
precondition(roomA.simdTransform == originalA)
let reopenedHierarchy = Renderer()
reopenedHierarchy.buildRoom(roomPayload("B", roomB.simdTransform))
let reopenedObjects = reopenedHierarchy.roomNodes["B"]!.childNodes.filter { $0.name?.hasPrefix("feature|") == true }
for (before, after) in zip(objectsB, reopenedObjects) { precondition(before.simdWorldTransform == after.simdWorldTransform) }
print("PASS: production buildRoom parents every scanned/proposed instance; moving B preserves A and local matrices; reopen restores world poses")
// Verify the JS fallback's Rz * Ry * Rx convention against SceneKit itself.
let pitch: Float = 0.15, yaw: Float = 0.6, roll: Float = -0.2
let rx = simd_float4x4(simd_quatf(angle: pitch, axis: SIMD3(1,0,0)))
let ry = simd_float4x4(simd_quatf(angle: yaw, axis: SIMD3(0,1,0)))
let rz = simd_float4x4(simd_quatf(angle: roll, axis: SIMD3(0,0,1)))
let eulerNode = SCNNode(); eulerNode.eulerAngles = SCNVector3(pitch, yaw, roll)
for i in 0..<4 { precondition(simd_length(eulerNode.simdTransform[i] - (rz * ry * rx)[i]) < 0.000001) }
print("PASS: three-room assembly lock, independent root translation/rotation, rigid internals, saved placement, W/D/H formatting")
print("PASS: native SceneKit rectangular room, corners, door, floor yaw, parent composition, rigid centering, JSON reopen, 32-bit quad indices, concave boundary triangulation")
print("PASS: four shared-type chairs retain individual native nodes, local W/D/H and spatial transforms")
'''
# Execute the production live-label formatter too; it needs only Foundation.
live_source = (root / 'ios/ConstructionARPlatform/RoomScanView.swift').read_text()
start = live_source.index('  private func measurementText(')
brace = live_source.index('{', start)
depth, end = 1, brace + 1
while depth:
    depth += (live_source[end] == '{') - (live_source[end] == '}')
    end += 1
live_labels = '\nfinal class LiveLabels {\n' + live_source[start:end].replace('private func', 'func') + '\n}\n'
live_tests = r'''
let labels = LiveLabels()
precondition(labels.measurementText(values: [["dimension": "height", "value": 1], ["dimension": "width", "value": 0.5], ["dimension": "depth", "value": 0.6]], kind: "chair") == "W 0.50 m × D 0.60 m × H 1.00 m")
precondition(labels.measurementText(values: [["dimension": "depth", "value": 0], ["dimension": "width", "value": Double.nan]], kind: "chair") == "")
precondition(labels.measurementText(values: [["dimension": "width", "value": 2], ["dimension": "height", "value": 3]], kind: "wall") == "Wall W 2.00 m × H 3.00 m")
print("PASS: production live labels explicitly identify W/D/H and omit invalid dimensions")
'''
with tempfile.TemporaryDirectory(prefix='room-transform-test-') as tmp:
    script = Path(tmp) / 'test.swift'
    script.write_text(prelude + '\n'.join(parts) + '\n}\n' + tests + live_labels + live_tests)
    subprocess.run(['xcrun', 'swift', '-module-cache-path', tmp + '/cache', str(script), str(root / 'src/domain/fixtures/threeRoomAssembly.json')], check=True)
