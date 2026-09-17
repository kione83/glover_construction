// Standalone local QA app. Compile alongside SavedRoom3DView.swift with only
// the React event-block type substituted. See ROOM_ASSEMBLY_VALIDATION.md.
#if !targetEnvironment(simulator)
#error("This QA harness must only run in the simulator")
#endif
import UIKit
import SceneKit
import simd
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  let viewer = SavedRoom3DView()
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds); self.window = window
    let controller = UIViewController(); controller.view.backgroundColor = .black
    window.rootViewController = controller; window.makeKeyAndVisible()
    viewer.frame = CGRect(x: 0, y: 70, width: window.bounds.width, height: 390)
    controller.view.addSubview(viewer)
    let rooms = try! JSONSerialization.jsonObject(with: Data(contentsOf: Bundle.main.url(forResource: "rooms", withExtension: "json")!)) as! [[String: Any]]
    var transforms: [String: Any] = [:]
    for (i, room) in rooms.enumerated() {
      transforms[room["id"] as! String] = ["position": ["x": Float(i) * 6, "y": 0, "z": 0], "rotation": ["pitch": 0, "yaw": 0, "roll": 0], "scale": ["x": 1, "y": 1, "z": 1]]
    }
    let payload = rooms.map { room -> [String: Any] in
      var r = room; r["transform"] = transforms[room["id"] as! String]
      r["roomDimensionsLabel"] = "H: 3.00 m · W: 4.00 m · L: 5.00 m"
      r["assemblyCenter"] = ["x": 0, "y": 1.5, "z": 0]
      return r
    }
    viewer.assemblyMode = true; viewer.selectedRoomId = "room-2"; viewer.lockedRoomId = "room-1"
    viewer.modelJSON = String(data: try! JSONSerialization.data(withJSONObject: ["rooms": payload]), encoding: .utf8)!
    viewer.roomTransformsJSON = String(data: try! JSONSerialization.data(withJSONObject: transforms), encoding: .utf8)!
    viewer.showMeasurements = true
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.check() }
    return true
  }
  func check() {
    let sceneView = viewer.subviews.compactMap { $0 as? SCNView }.first!
    let content = sceneView.scene!.rootNode.childNodes.first { $0.childNodes.contains { $0.name == "room|room-1" } }!
    let rooms = (1...3).map { content.childNode(withName: "room|room-\($0)", recursively: false)! }
    let before = rooms[1].childNodes.filter { $0.name?.hasPrefix("feature|") == true }.map { $0.simdTransform }
    let a = rooms[0].simdTransform, c = rooms[2].simdTransform
    var matrix = SavedRoom3DView.rotatedRoomMatrix(rooms[1].simdTransform, radians: .pi / 2, center: SIMD3(0, 1.5, 0))
    matrix.columns.3.x += 1; matrix.columns.3.y += 0.25; matrix.columns.3.z -= 2
    let values: [Float] = (0..<4).flatMap { row in (0..<4).map { col in matrix[col][row] } }
    viewer.roomTransformsJSON = String(data: try! JSONSerialization.data(withJSONObject: ["room-2": ["matrix": values]]), encoding: .utf8)!
    precondition(rooms[0].simdTransform == a && rooms[2].simdTransform == c)
    let after = rooms[1].childNodes.filter { $0.name?.hasPrefix("feature|") == true }.map { $0.simdTransform }
    precondition(before == after)
    // Geometry nodes must survive transform and measurement-toggle updates.
    viewer.showMeasurements = false
    precondition(sceneView.subviews.compactMap { $0 as? UILabel }.filter { !$0.isHidden }.allSatisfy { !($0.text ?? "").contains("H:") })
    viewer.showMeasurements = true
    viewer.focusRequestId = 1
    viewer.selectedFeatureIdsJSON = "[\"1-door\"]"
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
      let labels = sceneView.subviews.compactMap { $0 as? UILabel }.filter { !$0.isHidden }
      precondition(labels.contains { ($0.text ?? "").contains("H: 3.00 m") })
      precondition(labels.contains { ($0.text ?? "").contains("Door") && ($0.text ?? "").contains("W:") })
      precondition(before == rooms[1].childNodes.filter { $0.name?.hasPrefix("feature|") == true }.map { $0.simdTransform })
      let report = ["result": "PASS", "labels": labels.compactMap(\.text).joined(separator: "\n")]
      let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("result.json")
      try! JSONSerialization.data(withJSONObject: report).write(to: url)
    }
  }
}
