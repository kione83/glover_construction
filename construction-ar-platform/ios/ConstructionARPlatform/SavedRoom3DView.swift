import Foundation
import React
import SceneKit
import UIKit

@objcMembers
final class SavedRoom3DView: UIView, UIGestureRecognizerDelegate {
  @objc var modelJSON: String = "" { didSet { rebuildIfNeeded() } }
  @objc var selectedRoomId: String? { didSet { refreshSelection() } }
  @objc var selectedFeatureIdsJSON: String = "[]" { didSet { refreshSelection() } }
  @objc var editingRoomId: String?
  @objc var allowDirectManipulation: Bool = false { didSet { configureGestures() } }
  @objc var showMeasurements: Bool = true { didSet { rebuildIfNeeded(force: true) } }
  @objc var resetRequestId: NSNumber = 0 { didSet { guard resetRequestId != oldValue else { return }; resetCamera() } }
  @objc var onSceneSelection: RCTBubblingEventBlock?
  @objc var onRoomTransformChange: RCTBubblingEventBlock?

  private let sceneView = SCNView()
  private let scene = SCNScene()
  private let contentNode = SCNNode()
  private var roomNodes: [String: SCNNode] = [:]
  private var roomTransforms: [String: [String: Any]] = [:]
  private var lastModelJSON = ""
  private var panGesture: UIPanGestureRecognizer?
  private var lastPanLocation = CGPoint.zero

  override init(frame: CGRect) { super.init(frame: frame); configureView() }
  required init?(coder: NSCoder) { super.init(coder: coder); configureView() }
  override func layoutSubviews() { super.layoutSubviews(); sceneView.frame = bounds }

  private func configureView() {
    sceneView.scene = scene
    sceneView.backgroundColor = UIColor(red: 0.035, green: 0.055, blue: 0.09, alpha: 1)
    sceneView.allowsCameraControl = true
    sceneView.cameraControlConfiguration.allowsTranslation = true
    sceneView.autoenablesDefaultLighting = true
    sceneView.antialiasingMode = .multisampling4X
    scene.rootNode.addChildNode(contentNode)
    addSubview(sceneView)
    sceneView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap(_:))))
    configureGestures()
  }

  private func configureGestures() {
    if let panGesture { sceneView.removeGestureRecognizer(panGesture) }
    guard allowDirectManipulation else { panGesture = nil; return }
    let gesture = UIPanGestureRecognizer(target: self, action: #selector(handleRoomPan(_:)))
    gesture.minimumNumberOfTouches = 1
    gesture.maximumNumberOfTouches = 1
    gesture.delegate = self
    sceneView.addGestureRecognizer(gesture)
    panGesture = gesture
  }

  private func rebuildIfNeeded(force: Bool = false) {
    guard force || modelJSON != lastModelJSON || roomNodes.isEmpty else { refreshSelection(); return }
    let shouldFitCamera = roomNodes.isEmpty
    lastModelJSON = modelJSON
    roomNodes.removeAll(); roomTransforms.removeAll()
    contentNode.childNodes.forEach { $0.removeFromParentNode() }
    guard let data = modelJSON.data(using: .utf8), let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let rooms = root["rooms"] as? [[String: Any]] else { resetCamera(); return }
    for room in rooms { buildRoom(room) }
    if shouldFitCamera { resetCamera() }
    addProjectGrid(); refreshSelection()
  }

  private func buildRoom(_ room: [String: Any]) {
    guard let roomId = room["id"] as? String else { return }
    let roomNode = SCNNode(); roomNode.name = "room|\(roomId)"
    if let transform = room["transform"] as? [String: Any] { roomTransforms[roomId] = transform; apply(transform, to: roomNode) }
    if let scan = room["roomScan"] as? [String: Any], let elements = scan["elements"] as? [[String: Any]] {
      let measurements = scan["measurements"] as? [[String: Any]] ?? []
      for element in elements { buildElement(element, roomId: roomId, parent: roomNode, measurements: measurements) }
    }
    if let scan = room["roomScan"] as? [String: Any], let mesh = scan["arkitMesh"] as? [String: Any], let anchors = mesh["anchors"] as? [[String: Any]] { for anchor in anchors { buildMesh(anchor, roomId: roomId, parent: roomNode) } }
    contentNode.addChildNode(roomNode); roomNodes[roomId] = roomNode
  }

  private func buildElement(_ element: [String: Any], roomId: String, parent: SCNNode, measurements: [[String: Any]]) {
    guard let featureId = element["id"] as? String, let kind = element["kind"] as? String, let dimensions = element["dimensions"] as? [String: Any], let transform = element["transform"] as? [String: Any] else { return }
    let width = number(dimensions["width"]), height = number(dimensions["height"]), depth = number(dimensions["depth"])
    let node: SCNNode
    if kind == "floor" || kind == "ceiling" {
      let floorDepth = max(depth == 0 ? height : depth, 0.01)
      node = SCNNode(geometry: SCNBox(width: CGFloat(max(width, 0.01)), height: 0.015, length: CGFloat(floorDepth), chamferRadius: 0))
      let position = transform["position"] as? [String: Any] ?? [:]
      node.position = SCNVector3(number(position["x"]), number(position["y"]) - (kind == "floor" ? 0.01 : -0.01), number(position["z"]))
    } else if kind == "door" || kind == "opening" {
      node = makeOpeningNode(width: width, height: height, depth: max(depth, 0.04), opening: kind == "opening")
      apply(transform, to: node)
    } else {
      node = SCNNode(geometry: SCNBox(width: CGFloat(max(width, 0.02)), height: CGFloat(max(height, 0.02)), length: CGFloat(max(depth, 0.02)), chamferRadius: CGFloat(kind == "furniture" ? 0.04 : 0)))
      apply(transform, to: node)
    }
    node.name = "feature|\(roomId)|\(featureId)"
    node.geometry?.firstMaterial = material(for: kind, category: element["category"] as? String ?? "")
    parent.addChildNode(node)
    if showMeasurements {
      addMeasurementLabel(measurements.filter { ($0["elementId"] as? String) == featureId }, to: node, kind: kind, dimensions: SIMD3<Float>(width, height, depth))
    }
  }

  private func addMeasurementLabel(_ measurements: [[String: Any]], to node: SCNNode, kind: String, dimensions: SIMD3<Float>) {
    guard !measurements.isEmpty else { return }
    let values = Dictionary(uniqueKeysWithValues: measurements.compactMap { measurement -> (String, Float)? in
      guard let dimension = measurement["dimension"] as? String else { return nil }
      return (dimension, number(measurement["value"]))
    })
    let orderedDimensions: [String] = kind == "wall" ? ["width", "height"] : kind == "floor" ? ["depth", "width"] : ["width", "height", "depth"]
    let available = orderedDimensions.compactMap { values[$0] }
    guard !available.isEmpty else { return }
    let labelText: String
    if kind == "wall" || kind == "floor" {
      let wallPrefix = kind == "wall" ? "\((measurements.first?["wallId"] as? String) ?? "Wall") — " : ""
      labelText = wallPrefix + available.map { String(format: "%.2f", $0) }.joined(separator: " × ") + " m"
    } else {
      labelText = zip(["W", "H", "D"], available).map { "\($0.0) \(String(format: "%.2f", $0.1))" }.joined(separator: " × ") + " m"
    }
    let text = SCNText(string: labelText, extrusionDepth: 0.003)
    text.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
    text.flatness = 0.1
    text.firstMaterial = material(for: "measurement", category: "")
    let labelNode = SCNNode(geometry: text)
    labelNode.scale = SCNVector3(0.01, 0.01, 0.01)
    switch kind {
    case "floor": labelNode.position = SCNVector3(0, 0.08, 0)
    case "wall", "door", "window", "opening": labelNode.position = SCNVector3(0, 0, dimensions.z / 2 + 0.06)
    default: labelNode.position = SCNVector3(0, dimensions.y / 2 + 0.08, dimensions.z / 2 + 0.04)
    }
    // The node remains a child of the measured feature, while the billboard
    // only changes orientation so the annotation stays readable.
    labelNode.constraints = [SCNBillboardConstraint()]
    centerTextPivot(labelNode)
    node.addChildNode(labelNode)
  }

  private func centerTextPivot(_ node: SCNNode) {
    guard let text = node.geometry as? SCNText else { return }
    let (minBounds, maxBounds) = text.boundingBox
    node.pivot = SCNMatrix4MakeTranslation((minBounds.x + maxBounds.x) / 2, (minBounds.y + maxBounds.y) / 2, 0)
  }

  private func buildMesh(_ anchor: [String: Any], roomId: String, parent: SCNNode) {
    guard let vertices = anchor["vertices"] as? [[String: Any]], let indices = anchor["indices"] as? [NSNumber], vertices.count >= 3, indices.count >= 3 else { return }
    let points = vertices.map { SCNVector3(number($0["x"]), number($0["y"]), number($0["z"])) }
    let source = SCNGeometrySource(vertices: points)
    let element = SCNGeometryElement(indices: indices.map { Int32($0.intValue) }, primitiveType: .triangles)
    let geometry = SCNGeometry(sources: [source], elements: [element]); geometry.firstMaterial = material(for: "mesh", category: "")
    let node = SCNNode(geometry: geometry); node.name = "feature|\(roomId)|mesh-\(anchor["id"] as? String ?? UUID().uuidString)"
    if let transform = anchor["transform"] as? [String: Any] { apply(transform, to: node) }
    parent.addChildNode(node)
  }

  private func makeOpeningNode(width: Float, height: Float, depth: Float, opening: Bool) -> SCNNode {
    let group = SCNNode(); let thickness = max(width * 0.08, 0.035)
    let color = opening ? UIColor.systemTeal.withAlphaComponent(0.45) : UIColor.systemOrange.withAlphaComponent(0.85)
    let left = SCNNode(geometry: SCNBox(width: CGFloat(thickness), height: CGFloat(max(height, 0.02)), length: CGFloat(depth), chamferRadius: 0)); left.position.x = -max(width / 2 - thickness / 2, 0)
    let right = left.clone(); right.position.x *= -1
    let top = SCNNode(geometry: SCNBox(width: CGFloat(max(width, thickness)), height: CGFloat(thickness), length: CGFloat(depth), chamferRadius: 0)); top.position.y = max(height / 2 - thickness / 2, 0)
    let children: [SCNNode] = [left, right, top]
    children.forEach { child in child.geometry?.firstMaterial = material(for: opening ? "opening" : "door", category: ""); child.geometry?.firstMaterial?.diffuse.contents = color; group.addChildNode(child) }
    return group
  }

  private func material(for kind: String, category: String) -> SCNMaterial {
    let material = SCNMaterial(); material.isDoubleSided = true
    switch kind {
    case "wall": material.diffuse.contents = UIColor(white: 0.82, alpha: 0.8)
    case "floor": material.diffuse.contents = UIColor.systemBrown.withAlphaComponent(0.52)
    case "ceiling": material.diffuse.contents = UIColor(white: 0.95, alpha: 0.16)
    case "window": material.diffuse.contents = UIColor.systemBlue.withAlphaComponent(0.55)
    case "mesh": material.diffuse.contents = UIColor.systemPurple.withAlphaComponent(0.34)
    case "furniture": material.diffuse.contents = furnitureColor(category)
    case "built-in", "fixture": material.diffuse.contents = UIColor.systemGreen.withAlphaComponent(0.68)
    case "opening": material.diffuse.contents = UIColor.systemTeal.withAlphaComponent(0.45)
    case "door": material.diffuse.contents = UIColor.systemOrange.withAlphaComponent(0.85)
    case "measurement": material.diffuse.contents = UIColor.white
    default: material.diffuse.contents = UIColor.systemGray.withAlphaComponent(0.55)
    }
    material.transparency = kind == "mesh" ? 0.75 : 1; return material
  }

  private func furnitureColor(_ category: String) -> UIColor {
    switch category { case "sofa": return .systemIndigo; case "bed": return .systemPink; case "table": return .systemOrange; case "chair": return .systemYellow; default: return .systemBlue }
  }

  private func addProjectGrid() {
    let grid = SCNNode(); let gridMaterial = material(for: "grid", category: "")
    for index in stride(from: -10, through: 10, by: 1) {
      let x = SCNNode(geometry: SCNBox(width: 0.01, height: 0.005, length: 20, chamferRadius: 0)); x.position.x = Float(index); x.geometry?.firstMaterial = gridMaterial; grid.addChildNode(x)
      let z = SCNNode(geometry: SCNBox(width: 20, height: 0.005, length: 0.01, chamferRadius: 0)); z.position.z = Float(index); z.geometry?.firstMaterial = gridMaterial; grid.addChildNode(z)
    }
    grid.name = "project-grid"; contentNode.addChildNode(grid)
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: sceneView)
    guard let hit = sceneView.hitTest(point, options: [SCNHitTestOption.firstFoundOnly: true]).first, let identity = sceneIdentity(for: hit.node) else { onSceneSelection?(["kind": "background"]); return }
    if let featureId = identity.featureId { onSceneSelection?(["kind": "feature", "roomId": identity.roomId, "featureId": featureId]) } else { onSceneSelection?(["kind": "room", "roomId": identity.roomId]) }
  }

  @objc private func handleRoomPan(_ gesture: UIPanGestureRecognizer) {
    guard let editingRoomId, let roomNode = roomNodes[editingRoomId] else { return }
    let location = gesture.location(in: sceneView)
    if gesture.state == .began { lastPanLocation = location; return }
    let previous = sceneView.unprojectPoint(SCNVector3(Float(lastPanLocation.x), Float(lastPanLocation.y), 0.5))
    let current = sceneView.unprojectPoint(SCNVector3(Float(location.x), Float(location.y), 0.5))
    roomNode.position.x += current.x - previous.x; roomNode.position.z += current.z - previous.z; lastPanLocation = location
    if let transform = roomTransforms[editingRoomId] {
      var next = transform; var position = (transform["position"] as? [String: Any]) ?? [:]
      position["x"] = roomNode.position.x; position["y"] = roomNode.position.y; position["z"] = roomNode.position.z; next["position"] = position; roomTransforms[editingRoomId] = next
      onRoomTransformChange?(["roomId": editingRoomId, "transform": next])
    }
  }

  private func refreshSelection() {
    let data = selectedFeatureIdsJSON.data(using: .utf8) ?? Data(); let selectedFeatures = (try? JSONSerialization.jsonObject(with: data) as? [String]) ?? []
    for roomNode in roomNodes.values { roomNode.enumerateChildNodes { node, _ in guard let identity = self.sceneIdentity(for: node) else { return }; let selected = identity.roomId == self.selectedRoomId || (identity.featureId.map(selectedFeatures.contains) ?? false); node.geometry?.firstMaterial?.emission.contents = selected ? UIColor.systemYellow.withAlphaComponent(0.7) : UIColor.clear } }
  }

  private func resetCamera() {
    let cameraNode = SCNNode(); let camera = SCNCamera(); cameraNode.camera = camera
    let box = contentNode.boundingBox; let center = SCNVector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2); let span = max(max(box.max.x - box.min.x, box.max.y - box.min.y), max(box.max.z - box.min.z, 1))
    cameraNode.position = SCNVector3(center.x + span * 1.35, center.y + span * 0.95, center.z + span * 1.35); cameraNode.look(at: center)
    scene.rootNode.childNodes.filter { $0.camera != nil }.forEach { $0.removeFromParentNode() }; scene.rootNode.addChildNode(cameraNode)
  }

  private func apply(_ transform: [String: Any], to node: SCNNode) {
    let position = transform["position"] as? [String: Any] ?? [:]; node.position = SCNVector3(number(position["x"]), number(position["y"]), number(position["z"]))
    let rotation = transform["rotation"] as? [String: Any] ?? [:]; node.eulerAngles = SCNVector3(number(rotation["pitch"]), number(rotation["yaw"]), number(rotation["roll"]))
  }

  private func number(_ value: Any?) -> Float { if let value = value as? NSNumber { return value.floatValue }; if let value = value as? Double { return Float(value) }; return 0 }
  private struct SceneIdentity { let roomId: String; let featureId: String? }
  private func sceneIdentity(for node: SCNNode?) -> SceneIdentity? { var current = node; while let candidate = current { let parts = (candidate.name ?? "").split(separator: "|").map(String.init); if parts.first == "feature", parts.count >= 3 { return SceneIdentity(roomId: parts[1], featureId: parts[2]) }; if parts.first == "room", parts.count >= 2 { return SceneIdentity(roomId: parts[1], featureId: nil) }; current = candidate.parent }; return nil }
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }
}
