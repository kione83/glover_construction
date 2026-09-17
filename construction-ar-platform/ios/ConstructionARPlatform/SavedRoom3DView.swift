import Foundation
import React
import SceneKit
import simd
import UIKit

@objcMembers
final class SavedRoom3DView: UIView, UIGestureRecognizerDelegate {
  @objc var modelJSON: String = "" { didSet { rebuildIfNeeded() } }
  @objc var selectedRoomId: String? { didSet { refreshSelection() } }
  @objc var selectedFeatureIdsJSON: String = "[]" { didSet { refreshSelection() } }
  @objc var roomTransformsJSON: String = "{}" { didSet { applyAssemblyTransforms() } }
  @objc var lockedRoomId: String? { didSet { refreshSelection() } }
  @objc var assemblyMode: Bool = false
  @objc var editingRoomId: String?
  @objc var allowDirectManipulation: Bool = false { didSet { configureGestures() } }
  @objc var showMeasurements: Bool = true { didSet { updateAnnotations() } }
  @objc var resetRequestId: NSNumber = 0 { didSet { guard resetRequestId != oldValue else { return }; resetCamera() } }
  @objc var focusRequestId: NSNumber = 0 { didSet {
    guard focusRequestId != oldValue, let id = selectedRoomId, let node = roomNodes[id] else { return }
    fitCamera(to: [node])
  } }
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
  private var rotationGesture: UIRotationGestureRecognizer?
  private var gestureStartTransform: simd_float4x4?
  private var roomCenters: [String: SIMD3<Float>] = [:]
  private var displayLink: CADisplayLink?
  private struct Annotation {
    let label: UILabel
    let leader: CAShapeLayer
    let anchor: SCNNode
    let roomId: String
    let summary: Bool
    let title: String
    let dimensions: String
  }
  private var annotations: [Annotation] = []
  private var hasReleasedScene = false
  private var measurementLabelCount = 0
  #if DEBUG
  private let debugMeshDiagnostics = ProcessInfo.processInfo.environment["CONSTRUCTION_AR_MESH_DIAGNOSTICS"] == "1"
  private let debugMeshAnchorFilter = ProcessInfo.processInfo.environment["CONSTRUCTION_AR_MESH_ANCHOR"]
  private let debugRenderMode = ProcessInfo.processInfo.environment["CONSTRUCTION_AR_RENDER_MODE"] ?? "semantic"
  private let debugRenderFixture = ProcessInfo.processInfo.environment["CONSTRUCTION_AR_RENDER_FIXTURE"]
  #else
  private let debugMeshDiagnostics = false
  private let debugMeshAnchorFilter: String? = nil
  private let debugRenderMode = "semantic"
  private let debugRenderFixture: String? = nil
  #endif

  private var transformDiagnostics: Bool {
    #if DEBUG
    return ProcessInfo.processInfo.environment["CONSTRUCTION_AR_TRANSFORM_DIAGNOSTICS"] == "1"
    #else
    return false
    #endif
  }

  private struct PersistedMesh {
    let id: String
    let points: [SCNVector3]
    let indices: [Int32]
    let transform: simd_float4x4
    let bytesPerIndex: Int?
    let localBounds: (min: SCNVector3, max: SCNVector3)
  }

  private struct TriangleProvenance {
    let source: String
    let triangle: Int
    let indexes: [Int32]
    let local: [SCNVector3]
    let world: [SCNVector3]
  }

  override init(frame: CGRect) { super.init(frame: frame); configureView() }
  required init?(coder: NSCoder) { super.init(coder: coder); configureView() }
  override func layoutSubviews() { super.layoutSubviews(); sceneView.frame = bounds }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      if hasReleasedScene {
        hasReleasedScene = false
        sceneView.scene = scene
        if contentNode.parent == nil { scene.rootNode.addChildNode(contentNode) }
        lastModelJSON = ""
      }
      // React Native may apply modelJSON before this view is attached. Always
      // reconcile once it enters a window so the first saved scan is visible.
      sceneView.isHidden = false
      configureGestures()
      if displayLink == nil {
        displayLink = CADisplayLink(target: self, selector: #selector(updateAnnotations))
        displayLink?.preferredFramesPerSecond = 30
        displayLink?.add(to: .main, forMode: .common)
      }
      rebuildIfNeeded()
    } else if window == nil {
      releaseSceneResources()
    }
  }

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
    if let rotationGesture { sceneView.removeGestureRecognizer(rotationGesture) }
    panGesture = nil; rotationGesture = nil
    // Distinct camera and placement modes prevent one gesture moving both.
    sceneView.allowsCameraControl = !allowDirectManipulation
    guard allowDirectManipulation else { return }
    let pan = UIPanGestureRecognizer(target: self, action: #selector(handleRoomPan(_:)))
    pan.minimumNumberOfTouches = 1; pan.maximumNumberOfTouches = 1; pan.delegate = self
    let rotation = UIRotationGestureRecognizer(target: self, action: #selector(handleRoomRotation(_:)))
    rotation.delegate = self
    sceneView.addGestureRecognizer(pan); sceneView.addGestureRecognizer(rotation)
    panGesture = pan; rotationGesture = rotation
  }

  private func applyAssemblyTransforms() {
    guard let data = roomTransformsJSON.data(using: .utf8),
          let transforms = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { return }
    SCNTransaction.begin(); SCNTransaction.animationDuration = 0
    for (id, transform) in transforms {
      guard let node = roomNodes[id] else { continue }
      apply(transform, to: node); roomTransforms[id] = transform
    }
    SCNTransaction.commit()
    updateAnnotations()
  }

  private func rebuildIfNeeded(force: Bool = false) {
    guard window != nil else { return }
    guard force || modelJSON != lastModelJSON || roomNodes.isEmpty else { refreshSelection(); return }
    let shouldFitCamera = roomNodes.isEmpty
    lastModelJSON = modelJSON
    clearAnnotations()
    roomCenters.removeAll()
    roomNodes.removeAll(); roomTransforms.removeAll(); measurementLabelCount = 0
    contentNode.childNodes.forEach { $0.removeFromParentNode() }
    #if DEBUG
    if let fixture = debugRenderFixture {
      buildRoom(debugFixtureRoom(named: fixture))
    } else if let data = modelJSON.data(using: .utf8), let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let rooms = root["rooms"] as? [[String: Any]] {
      for room in rooms { buildRoom(room) }
    } else {
      resetCamera()
      return
    }
    #else
    guard let data = modelJSON.data(using: .utf8), let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let rooms = root["rooms"] as? [[String: Any]] else { resetCamera(); return }
    for room in rooms { buildRoom(room) }
    #endif
    applyAssemblyTransforms()
    if shouldFitCamera { resetCamera() }
    addProjectGrid(); refreshSelection()
  }

  private func buildRoom(_ room: [String: Any]) {
    guard let roomId = room["id"] as? String else { return }
    let roomNode = SCNNode(); roomNode.name = "room|\(roomId)"
    if let transform = room["transform"] as? [String: Any] { roomTransforms[roomId] = transform; apply(transform, to: roomNode) }
    if debugRenderMode != "anchors" && debugRenderMode != "merged", let scan = room["roomScan"] as? [String: Any], let elements = scan["elements"] as? [[String: Any]] {
      let measurements = scan["measurements"] as? [[String: Any]] ?? []
      for element in elements { buildElement(element, roomId: roomId, parent: roomNode, measurements: measurements) }
    }
    // Proposed placements share the room parent but are not part of the captured archive.
    if let objects = room["placedObjects"] as? [[String: Any]] {
      for object in objects { buildElement(object, roomId: roomId, parent: roomNode, measurements: []) }
    }
    if let scan = room["roomScan"] as? [String: Any], let mesh = scan["arkitMesh"] as? [String: Any], let anchors = mesh["anchors"] as? [[String: Any]] {
      if debugRenderMode == "merged" {
        buildMergedMesh(anchors, roomId: roomId, parent: roomNode)
      } else if debugRenderMode == "anchors" {
        for (index, anchor) in anchors.enumerated() { buildMesh(anchor, roomId: roomId, parent: roomNode, anchorIndex: index) }
      }
    }
    let center = room["assemblyCenter"] as? [String: Any]
    let box = roomNode.boundingBox
    let boundsCenter = SIMD3<Float>(Float((box.min.x + box.max.x) / 2), Float((box.min.y + box.max.y) / 2), Float((box.min.z + box.max.z) / 2))
    roomCenters[roomId] = center.map { SIMD3<Float>(number($0["x"]), number($0["y"]), number($0["z"])) } ?? boundsCenter
    let anchor = SCNNode()
    anchor.simdPosition = SIMD3(roomCenters[roomId]!.x, Float(box.max.y) + 0.15, roomCenters[roomId]!.z)
    roomNode.addChildNode(anchor)
    addAnnotation(anchor: anchor, roomId: roomId, title: room["name"] as? String ?? "Room", dimensions: room["roomDimensionsLabel"] as? String ?? "", summary: true)
    contentNode.addChildNode(roomNode); roomNodes[roomId] = roomNode
    logComponent(kind: "room", id: roomId, node: roomNode, source: room["transform"], dimensions: nil)
  }

  private func buildElement(_ element: [String: Any], roomId: String, parent: SCNNode, measurements: [[String: Any]]) {
    guard let featureId = element["id"] as? String, let kind = element["kind"] as? String, let dimensions = element["dimensions"] as? [String: Any], let transform = element["transform"] as? [String: Any] else { return }
    let width = number(dimensions["width"]), height = number(dimensions["height"]), depth = number(dimensions["depth"])
    let node: SCNNode
    if kind == "wall" {
      node = capturedPolygonNode(element) ?? makeWallQuad(width: width, height: height)
      apply(transform, to: node)
    } else if kind == "floor" || kind == "ceiling" {
      let floorDepth = max(depth == 0 ? height : depth, 0.01)
      node = capturedPolygonNode(element) ?? SCNNode(geometry: SCNBox(width: CGFloat(max(width, 0.01)), height: 0.015, length: CGFloat(floorDepth), chamferRadius: 0))
      // ARKit world is the canonical room frame (meters, right-handed, Y-up).
      // Preserve the same captured local-to-world matrix as every other feature.
      apply(transform, to: node)
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
    logComponent(kind: kind, id: featureId, node: node, source: transform, dimensions: dimensions)
    if kind == "wall" { logSemanticCorners(featureId: featureId, node: node, parent: parent, width: width, height: height) }
    if transformDiagnostics, let corners = element["polygonCorners"] as? [[String: Any]] {
      let worldCorners = corners.map { node.convertPosition(SCNVector3(number($0["x"]), number($0["y"]), number($0["z"])), to: nil) }
      NSLog("[RoomTransform] kind=\(kind) id=\(featureId) capturedBoundaryWorld=\(worldCorners)")
    }
    // No project-wide cap: each feature retains its own annotation. The active
    // room's details are laid out on screen; other rooms keep summary callouts.
    let isObject = ["furniture", "built-in", "fixture"].contains(kind)
    // Object labels use the same local geometry as their persisted metadata;
    // smoothed measurement history must not silently replace a captured axis.
    var available = isObject ? [] : measurements.filter { ($0["elementId"] as? String) == featureId }
    let axes = kind == "floor" || kind == "ceiling" ? ["width", "depth"] : ["wall", "door", "window", "opening"].contains(kind) ? ["width", "height"] : ["width", "depth", "height"]
    for axis in axes where !available.contains(where: { ($0["dimension"] as? String) == axis }) {
      let value = number(dimensions[axis])
      if value.isFinite && value > 0 { available.append(["dimension": axis, "value": value]) }
    }
    let title = element["wallId"] as? String ?? element["category"] as? String ?? kind
    addMeasurementLabel(available, to: node, kind: title, dimensions: SIMD3<Float>(width, height, depth))
  }

  private func logComponent(kind: String, id: String, node: SCNNode, source: Any?, dimensions: [String: Any]?) {
    guard transformDiagnostics else { return }
    // Logged after parenting. World = container * captured local-to-AR-world.
    NSLog("[RoomTransform] kind=\(kind) id=\(id) localPosition=\(node.simdPosition) worldPosition=\(node.simdWorldPosition) localQuaternion=\(node.simdOrientation.vector) worldQuaternion=\(node.simdWorldOrientation.vector) dimensions=\(String(describing: dimensions)) parent=\(String(describing: node.parent?.simdWorldTransform)) source=\(String(describing: source)) localMatrix=\(node.simdTransform) worldMatrix=\(node.simdWorldTransform)")
    if let source = node.geometry?.sources(for: .vertex).first {
      NSLog("[RoomTransform] kind=\(kind) id=\(id) renderedVertexCount=\(source.vectorCount)")
    }
    if kind == "wall", let dimensions {
      let w = number(dimensions["width"]) / 2
      let h = number(dimensions["height"]) / 2
      let endpoints = [SCNVector3(-w, -h, 0), SCNVector3(w, -h, 0)]
      NSLog("[RoomTransform] wall=\(id) bottomEndpointsWorld=\(endpoints.map { node.convertPosition($0, to: nil) })")
    }
  }

  static func measurementText(_ measurements: [[String: Any]]) -> String {
    var values: [String: Float] = [:]
    for item in measurements {
      guard let dimension = item["dimension"] as? String,
            let value = item["value"] as? NSNumber, value.floatValue.isFinite, value.floatValue > 0 else { continue }
      values[dimension] = value.floatValue
    }
    return [("width", "W"), ("depth", "D"), ("height", "H")].compactMap { dimension, label in
      values[dimension].map { String(format: "%@: %.2f m", label, $0) }
    }.joined(separator: " · ")
  }

  private func addMeasurementLabel(_ measurements: [[String: Any]], to node: SCNNode, kind: String, dimensions: SIMD3<Float>) {
    let text = Self.measurementText(measurements)
    guard !text.isEmpty, let identity = sceneIdentity(for: node) else { return }
    let anchor = SCNNode()
    anchor.simdPosition = SIMD3(0, dimensions.y / 2 + 0.06, dimensions.z / 2 + 0.03)
    node.addChildNode(anchor)
    addAnnotation(anchor: anchor, roomId: identity.roomId, title: kind.capitalized, dimensions: text, summary: false)
  }

  private func addAnnotation(anchor: SCNNode, roomId: String, title: String, dimensions: String, summary: Bool) {
    let label = UILabel()
    label.font = UIFont.systemFont(ofSize: summary ? 13 : 12, weight: summary ? .bold : .semibold)
    label.textColor = .white
    label.backgroundColor = UIColor(red: 0.06, green: 0.10, blue: 0.16, alpha: 0.94)
    label.numberOfLines = 0; label.textAlignment = .center
    label.layer.cornerRadius = 5; label.clipsToBounds = true
    label.layer.borderWidth = 1
    label.isUserInteractionEnabled = false; label.isHidden = true
    let leader = CAShapeLayer(); leader.strokeColor = UIColor(red: 0.60, green: 0.76, blue: 0.89, alpha: 0.9).cgColor
    leader.lineWidth = 1; leader.fillColor = UIColor.clear.cgColor
    sceneView.layer.addSublayer(leader); sceneView.addSubview(label)
    annotations.append(Annotation(label: label, leader: leader, anchor: anchor, roomId: roomId, summary: summary, title: title, dimensions: dimensions))
  }

  @objc private func updateAnnotations() {
    guard sceneView.bounds.width > 0, sceneView.pointOfView != nil else { return }
    var occupied: [CGRect] = []
    let selectedData = selectedFeatureIdsJSON.data(using: .utf8) ?? Data()
    let selectedFeatures = (try? JSONSerialization.jsonObject(with: selectedData) as? [String]) ?? []
    // Summaries have first claim on space, followed by selected-room features.
    for a in annotations.sorted(by: { $0.summary && !$1.summary }) {
      let active = a.roomId == selectedRoomId
      let featureId = sceneIdentity(for: a.anchor)?.featureId
      let featureMatches = selectedFeatures.isEmpty || featureId.map(selectedFeatures.contains) == true
      let visible = a.summary || (showMeasurements && featureMatches && (active || roomNodes.count == 1))
      let p = sceneView.projectPoint(a.anchor.presentation.worldPosition)
      guard visible, p.z >= 0, p.z <= 1, p.x >= 0, p.y >= 0,
            p.x <= Float(sceneView.bounds.width), p.y <= Float(sceneView.bounds.height) else {
        a.label.isHidden = true; a.leader.isHidden = true; continue
      }
      let locked = a.roomId == lockedRoomId
      a.label.text = a.title + (a.summary && locked ? " · Locked" : "") + (showMeasurements ? "\n" + (a.dimensions.isEmpty ? "Room dimensions unavailable" : a.dimensions) : "")
      a.label.layer.borderColor = (active ? UIColor.systemBlue : UIColor(red: 0.40, green: 0.51, blue: 0.62, alpha: 1)).cgColor
      let size = a.label.sizeThatFits(CGSize(width: min(250, sceneView.bounds.width - 16), height: 100))
      let width = min(size.width + 12, sceneView.bounds.width - 8), height = size.height + 10
      let x = min(max(CGFloat(p.x) - width / 2, 4), sceneView.bounds.width - width - 4)
      let y = min(max(CGFloat(p.y) - height - 10, 4), sceneView.bounds.height - height - 4)
      var frame = CGRect(x: x, y: y, width: width, height: height)
      var found = false
      var offsets: [CGFloat] = [0]
      for step in 1...2 { let distance = CGFloat(step) * (height + 4); offsets.append(distance); offsets.append(-distance) }
      for offset in offsets {
        let candidate = frame.offsetBy(dx: 0, dy: offset)
        if candidate.minY >= 4 && candidate.maxY <= sceneView.bounds.height - 4 && !occupied.contains(where: { $0.intersects(candidate) }) {
          frame = candidate; found = true; break
        }
      }
      // Keep room summaries visible even in dense overlap; choose a room to
      // inspect its feature callouts. No stale world-space label positions.
      a.label.isHidden = !found && !a.summary
      a.leader.isHidden = a.label.isHidden
      if a.label.isHidden { continue }
      a.label.frame = frame; occupied.append(frame.insetBy(dx: -2, dy: -2))
      let line = UIBezierPath(); line.move(to: CGPoint(x: CGFloat(p.x), y: CGFloat(p.y)))
      line.addLine(to: CGPoint(x: frame.midX, y: frame.maxY)); a.leader.path = line.cgPath
    }
  }

  private func clearAnnotations() {
    annotations.forEach { $0.label.removeFromSuperview(); $0.leader.removeFromSuperlayer() }
    annotations.removeAll()
  }

  private func buildMesh(_ anchor: [String: Any], roomId: String, parent: SCNNode, anchorIndex: Int) {
    guard let mesh = decodeMesh(anchor, fallbackIndex: anchorIndex) else { return }
    guard mesh.indices.count % 3 == 0, mesh.indices.min() ?? -1 >= 0, mesh.indices.max() ?? -1 < mesh.points.count else {
      reportPersistedMeshFailure(mesh.id, reason: "Final mesh index validation failed before SceneKit construction")
      return
    }
    let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: mesh.points)], elements: [SCNGeometryElement(indices: mesh.indices, primitiveType: .triangles)])
    geometry.firstMaterial = debugMeshDiagnostics ? diagnosticMeshMaterial(anchorIndex) : material(for: "mesh", category: "")
    let node = SCNNode(geometry: geometry)
    node.name = "feature|\(roomId)|mesh-\(mesh.id)"
    node.simdTransform = mesh.transform
    parent.addChildNode(node)

    let worldBounds = bounds(for: boundsCorners(mesh.localBounds).map { node.convertPosition($0, to: parent) })
    logMeshDiagnostics(mesh, worldBounds: worldBounds, node: node, parent: parent, provenance: true)
    if debugMeshDiagnostics, let debugMeshAnchorFilter, debugMeshAnchorFilter != mesh.id {
      node.isHidden = true
    }
  }

  private func buildMergedMesh(_ anchors: [[String: Any]], roomId: String, parent: SCNNode) {
    var points: [SCNVector3] = []
    var indices: [Int32] = []
    var provenance: [TriangleProvenance] = []
    for (anchorIndex, anchor) in anchors.enumerated() {
      guard let mesh = decodeMesh(anchor, fallbackIndex: anchorIndex) else { continue }
      let offset = Int32(points.count)
      let transformed = mesh.points.map { transformPoint($0, by: mesh.transform) }
      points.append(contentsOf: transformed)
      for triangleStart in stride(from: 0, to: mesh.indices.count, by: 3) {
        let localIndexes = Array(mesh.indices[triangleStart..<(triangleStart + 3)])
        let localPoints = localIndexes.map { mesh.points[Int($0)] }
        provenance.append(TriangleProvenance(source: mesh.id, triangle: triangleStart / 3, indexes: localIndexes, local: localPoints, world: localPoints.map { transformPoint($0, by: mesh.transform) }))
        indices.append(contentsOf: localIndexes.map { $0 + offset })
      }
    }
    guard points.count >= 3, !indices.isEmpty, indices.count % 3 == 0, indices.min() ?? -1 >= 0, indices.max() ?? -1 < points.count else {
      NSLog("[SavedRoom3D][MeshDiagnostics][INVALID] merged room=%@ final index validation failed", roomId)
      return
    }
    let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: points)], elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
    geometry.firstMaterial = diagnosticMeshMaterial(0)
    let node = SCNNode(geometry: geometry)
    node.name = "feature|\(roomId)|mesh-merged"
    parent.addChildNode(node)
    let localBounds = bounds(for: points)
    logGeometryDiagnostics(source: "merged room=\(roomId)", points: points, indices: indices, node: node, parent: parent, provenance: provenance)
    NSLog("[SavedRoom3D][MeshDiagnostics] merged room=%@ vertices=%ld faces=%ld bounds=%@-%@ indexOwnership=worldVertices+identityTransform", roomId, points.count, indices.count / 3, String(describing: localBounds.min), String(describing: localBounds.max))
  }

  private func decodeMesh(_ anchor: [String: Any], fallbackIndex: Int) -> PersistedMesh? {
    let anchorId = anchor["id"] as? String ?? "unknown-\(fallbackIndex)"
    guard let vertices = anchor["vertices"] as? [[String: Any]], let indexValues = numericArray(anchor["indices"]), vertices.count >= 3, indexValues.count >= 3 else {
      reportPersistedMeshFailure(anchorId, reason: "Missing or empty vertices/indices")
      return nil
    }
    let indexCountPerPrimitive = integer(anchor["indexCountPerPrimitive"]) ?? 3
    let bytesPerIndex = integer(anchor["bytesPerIndex"])
    let declaredFaceCount = integer(anchor["faceCount"])
    let declaredIndexCount = integer(anchor["indexCount"])
    guard indexCountPerPrimitive == 3 else {
      reportPersistedMeshFailure(anchorId, reason: "indexCountPerPrimitive=\(indexCountPerPrimitive), expected 3")
      return nil
    }
    if let bytesPerIndex, bytesPerIndex != 2 && bytesPerIndex != 4 {
      reportPersistedMeshFailure(anchorId, reason: "Unsupported bytesPerIndex=\(bytesPerIndex)")
      return nil
    }
    guard indexValues.count % indexCountPerPrimitive == 0 else {
      reportPersistedMeshFailure(anchorId, reason: "Index count \(indexValues.count) is not divisible by 3; refusing malformed topology")
      return nil
    }
    guard declaredIndexCount == nil || declaredIndexCount == indexValues.count else {
      reportPersistedMeshFailure(anchorId, reason: "Declared index count does not match persisted indexes")
      return nil
    }
    guard declaredFaceCount == nil || declaredFaceCount == indexValues.count / indexCountPerPrimitive else {
      reportPersistedMeshFailure(anchorId, reason: "Declared face count does not match persisted indexes")
      return nil
    }
    let rawIndexes = indexValues.map { $0.int64Value }
    guard rawIndexes.allSatisfy({ $0 >= 0 && $0 < Int64(vertices.count) }) else {
      reportPersistedMeshFailure(anchorId, reason: "Index range [\(rawIndexes.min() ?? -1), \(rawIndexes.max() ?? -1)] exceeds vertex count \(vertices.count)")
      return nil
    }
    let points = vertices.map { SCNVector3(number($0["x"]), number($0["y"]), number($0["z"])) }
    guard points.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }) else {
      reportPersistedMeshFailure(anchorId, reason: "Non-finite persisted vertex")
      return nil
    }
    guard let transform = anchor["transform"] as? [String: Any], finiteTransform(transform), let matrix = simdMatrix(from: transform) else {
      reportPersistedMeshFailure(anchorId, reason: "Missing or non-finite persisted transform")
      return nil
    }
    return PersistedMesh(id: anchorId, points: points, indices: rawIndexes.map { Int32($0) }, transform: matrix, bytesPerIndex: bytesPerIndex, localBounds: bounds(for: points))
  }

  // Triangulate only within one captured boundary; never join separate surfaces
  // or fan arbitrary/concave polygons (which can recreate exploded topology).
  private func capturedPolygonNode(_ element: [String: Any]) -> SCNNode? {
    guard let corners = element["polygonCorners"] as? [[String: Any]], corners.count >= 3 else { return nil }
    let points = corners.map { SIMD3<Float>(number($0["x"]), number($0["y"]), number($0["z"])) }
    guard let indices = Self.triangulateBoundary(points) else { return nil }
    let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: points.map { SCNVector3($0.x, $0.y, $0.z) })], elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
    return SCNNode(geometry: geometry)
  }

  static func triangulateBoundary(_ points: [SIMD3<Float>]) -> [Int32]? {
    guard points.count >= 3, points.count < 10000,
          points.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }) else { return nil }
    var normal = SIMD3<Float>.zero
    for i in points.indices { normal += simd_cross(points[i], points[(i + 1) % points.count]) }
    guard simd_length(normal) > 1e-8 else { return nil }
    let axis = abs(normal.x) > abs(normal.y) ? (abs(normal.x) > abs(normal.z) ? 0 : 2) : (abs(normal.y) > abs(normal.z) ? 1 : 2)
    let projected = points.map { p in axis == 0 ? SIMD2(p.y, p.z) : axis == 1 ? SIMD2(p.z, p.x) : SIMD2(p.x, p.y) }
    func cross(_ a: SIMD2<Float>, _ b: SIMD2<Float>, _ c: SIMD2<Float>) -> Float {
      let u = b - a; let v = c - a
      return u.x * v.y - u.y * v.x
    }
    let sign: Float = normal[axis] > 0 ? 1 : -1
    var remaining = Array(points.indices)
    var indices: [Int32] = []
    while remaining.count > 3 {
      var clipped = false
      for i in remaining.indices {
        let a = remaining[(i + remaining.count - 1) % remaining.count]
        let b = remaining[i]; let c = remaining[(i + 1) % remaining.count]
        guard sign * cross(projected[a], projected[b], projected[c]) > 1e-8 else { continue }
        let contains = remaining.contains { j in
          j != a && j != b && j != c &&
          sign * cross(projected[a], projected[b], projected[j]) >= -1e-8 &&
          sign * cross(projected[b], projected[c], projected[j]) >= -1e-8 &&
          sign * cross(projected[c], projected[a], projected[j]) >= -1e-8
        }
        if contains { continue }
        indices += [Int32(a), Int32(b), Int32(c)]
        remaining.remove(at: i); clipped = true; break
      }
      guard clipped else { return nil }
    }
    indices += remaining.map(Int32.init)
    return indices
  }

  private func makeWallQuad(width: Float, height: Float) -> SCNNode {
    let halfWidth = max(width, 0.01) / 2
    let wallHeight = max(height, 0.01)
    let vertices = [
      SCNVector3(-halfWidth, -wallHeight / 2, 0),
      SCNVector3(halfWidth, -wallHeight / 2, 0),
      SCNVector3(halfWidth, wallHeight / 2, 0),
      SCNVector3(-halfWidth, wallHeight / 2, 0),
    ]
    let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: vertices)], elements: [SCNGeometryElement(indices: [Int32(0), 1, 2, 0, 2, 3], primitiveType: .triangles)])
    return SCNNode(geometry: geometry)
  }

  private func logSemanticCorners(featureId: String, node: SCNNode, parent: SCNNode, width: Float, height: Float) {
    #if DEBUG
    guard debugMeshDiagnostics else { return }
    let halfWidth = max(width, 0.01) / 2
    let halfHeight = max(height, 0.01) / 2
    let local = [
      SCNVector3(-halfWidth, -halfHeight, 0), SCNVector3(halfWidth, -halfHeight, 0),
      SCNVector3(halfWidth, halfHeight, 0), SCNVector3(-halfWidth, halfHeight, 0),
    ]
    let roomSpace = local.map { node.convertPosition($0, to: parent) }
    NSLog("[SavedRoom3D][SemanticDiagnostics] feature=%@ corners=%@ indices=[0,1,2,0,2,3]", featureId, String(describing: roomSpace))
    logGeometryDiagnostics(source: "RoomPlan feature=\(featureId)", points: local, indices: [0, 1, 2, 0, 2, 3], node: node, parent: parent, provenance: nil)
    #endif
  }

  private func logMeshDiagnostics(_ mesh: PersistedMesh, worldBounds: (min: SCNVector3, max: SCNVector3), node: SCNNode, parent: SCNNode, provenance: Bool) {
    guard debugMeshDiagnostics else { return }
    let triangleProvenance: [TriangleProvenance]? = provenance ? stride(from: 0, to: mesh.indices.count, by: 3).map { offset in
      let localIndexes = Array(mesh.indices[offset..<(offset + 3)])
      let localPoints = localIndexes.map { mesh.points[Int($0)] }
      return TriangleProvenance(source: mesh.id, triangle: offset / 3, indexes: localIndexes, local: localPoints, world: localPoints.map { node.convertPosition($0, to: parent) })
    } : nil
    NSLog("[SavedRoom3D][MeshDiagnostics] anchor=%@ vertices=%ld faces=%ld indexes=%ld bytesPerIndex=%@ indexCountPerPrimitive=3 minIndex=%d maxIndex=%d localBounds=%@-%@ worldBounds=%@-%@ transform=%@", mesh.id, mesh.points.count, mesh.indices.count / 3, mesh.indices.count, mesh.bytesPerIndex.map(String.init) ?? "legacy", mesh.indices.min() ?? -1, mesh.indices.max() ?? -1, String(describing: mesh.localBounds.min), String(describing: mesh.localBounds.max), String(describing: worldBounds.min), String(describing: worldBounds.max), String(describing: node.simdTransform))
    logGeometryDiagnostics(source: "ARMeshAnchor=\(mesh.id)", points: mesh.points, indices: mesh.indices, node: node, parent: parent, provenance: triangleProvenance)
  }

  private func logGeometryDiagnostics(source: String, points: [SCNVector3], indices: [Int32], node: SCNNode, parent: SCNNode, provenance: [TriangleProvenance]?) {
    #if DEBUG
    guard debugMeshDiagnostics || debugRenderMode == "anchors" || debugRenderMode == "merged" else { return }
    let localBounds = bounds(for: points)
    let diagonal = distance(localBounds.min, localBounds.max)
    NSLog("[SavedRoom3D][TriangleDiagnostics] source=%@ vertices=%ld indexes=%ld triangles=%ld minIndex=%d maxIndex=%d diagonal=%.4f", source, points.count, indices.count, indices.count / 3, indices.min() ?? -1, indices.max() ?? -1, diagonal)
    for offset in stride(from: 0, to: min(indices.count, 60), by: 3) {
      let triangle = Array(indices[offset..<(offset + 3)])
      let trianglePoints = triangle.map { points[Int($0)] }
      let edges = [distance(trianglePoints[0], trianglePoints[1]), distance(trianglePoints[1], trianglePoints[2]), distance(trianglePoints[2], trianglePoints[0])]
      NSLog("[SavedRoom3D][TriangleDiagnostics] source=%@ triangle=%ld indexes=%@ edges=[%.4f,%.4f,%.4f]", source, offset / 3, String(describing: triangle), edges[0], edges[1], edges[2])
      if edges.max() ?? 0 > max(diagonal * 4, 10) {
        let matching = provenance?.first { $0.triangle == offset / 3 }
        NSLog("[SavedRoom3D][TriangleDiagnostics][LARGE] source=%@ triangle=%ld provenanceSource=%@ localIndexes=%@ local=%@ world=%@", source, offset / 3, matching?.source ?? "unknown", String(describing: matching?.indexes ?? []), String(describing: matching?.local ?? []), String(describing: matching?.world ?? []))
      }
    }
    if indices.count > 60 { NSLog("[SavedRoom3D][TriangleDiagnostics] source=%@ additionalTriangles=%ld", source, indices.count / 3 - 20) }
    _ = node
    _ = parent
    #endif
  }

  private func distance(_ lhs: SCNVector3, _ rhs: SCNVector3) -> Float {
    simd_length(SIMD3<Float>(lhs.x - rhs.x, lhs.y - rhs.y, lhs.z - rhs.z))
  }

  private func transformPoint(_ point: SCNVector3, by matrix: simd_float4x4) -> SCNVector3 {
    let result = matrix * SIMD4<Float>(point.x, point.y, point.z, 1)
    return SCNVector3(result.x, result.y, result.z)
  }

  private func numericArray(_ value: Any?) -> [NSNumber]? {
    if let value = value as? [NSNumber] { return value }
    if let value = value as? [Any] {
      let numbers = value.compactMap { $0 as? NSNumber }
      return numbers.count == value.count ? numbers : nil
    }
    return nil
  }

  private func simdMatrix(from transform: [String: Any]) -> simd_float4x4? {
    if let values = numericArray(transform["matrix"]), values.count == 16 {
      let v = values.map { $0.floatValue }
      guard v.allSatisfy({ $0.isFinite }) else { return nil }
      // RoomScanView persists matrix.columns as rows so JSON has a row-major
      // representation. Rebuild SIMD columns explicitly; assigning the array
      // directly to SCNMatrix4 fields transposes the translation/projective row.
      return simd_float4x4(
        SIMD4(v[0], v[4], v[8], v[12]),
        SIMD4(v[1], v[5], v[9], v[13]),
        SIMD4(v[2], v[6], v[10], v[14]),
        SIMD4(v[3], v[7], v[11], v[15])
      )
    }
    let position = transform["position"] as? [String: Any] ?? [:]
    let rotation = transform["rotation"] as? [String: Any] ?? [:]
    guard ["x", "y", "z"].allSatisfy({ finiteNumber(position[$0]) }), ["pitch", "yaw", "roll"].allSatisfy({ finiteNumber(rotation[$0]) }) else { return nil }
    let node = SCNNode()
    node.position = SCNVector3(number(position["x"]), number(position["y"]), number(position["z"]))
    node.eulerAngles = SCNVector3(number(rotation["pitch"]), number(rotation["yaw"]), number(rotation["roll"]))
    if let scale = transform["scale"] as? [String: Any] {
      node.simdScale = SIMD3(number(scale["x"]), number(scale["y"]), number(scale["z"]))
    }
    return node.simdTransform
  }

  private func matrixTransform(_ matrix: simd_float4x4) -> [String: Any] {
    let node = SCNNode(); node.simdTransform = matrix
    let c0 = matrix.columns.0; let c1 = matrix.columns.1; let c2 = matrix.columns.2; let c3 = matrix.columns.3
    return ["matrix": [
      NSNumber(value: c0.x), NSNumber(value: c1.x), NSNumber(value: c2.x), NSNumber(value: c3.x),
      NSNumber(value: c0.y), NSNumber(value: c1.y), NSNumber(value: c2.y), NSNumber(value: c3.y),
      NSNumber(value: c0.z), NSNumber(value: c1.z), NSNumber(value: c2.z), NSNumber(value: c3.z),
      NSNumber(value: c0.w), NSNumber(value: c1.w), NSNumber(value: c2.w), NSNumber(value: c3.w),
    ], "position": ["x": c3.x, "y": c3.y, "z": c3.z], "rotation": ["pitch": node.eulerAngles.x, "yaw": node.eulerAngles.y, "roll": node.eulerAngles.z], "scale": ["x": node.simdScale.x, "y": node.simdScale.y, "z": node.simdScale.z] ]
  }

  #if DEBUG
  private func debugFixtureRoom(named name: String) -> [String: Any] {
    let fixtureName = name.lowercased()
    let roomWidth: Float = 4
    let roomLength: Float = 5
    let roomHeight: Float = fixtureName == "single-wall" || fixtureName == "two-wall" ? 3.4 : 3
    let wall = { (id: String, width: Float, matrix: simd_float4x4) -> [String: Any] in
      ["id": id, "kind": "wall", "dimensions": ["width": width, "height": roomHeight, "depth": 0.1], "transform": self.matrixTransform(matrix)]
    }
    let identity = matrix_identity_float4x4
    let rotation90 = simd_float4x4(
      SIMD4<Float>(0, 0, -1, 0), SIMD4<Float>(0, 1, 0, 0), SIMD4<Float>(1, 0, 0, 0), SIMD4<Float>(2, 0, 0, 1)
    )
    switch fixtureName {
    case "single-wall":
      return ["id": "debug-single-wall", "transform": matrixTransform(identity), "roomScan": ["elements": [wall("wall-1", 4, identity)], "measurements": []]]
    case "two-wall":
      return ["id": "debug-two-wall", "transform": matrixTransform(identity), "roomScan": ["elements": [wall("wall-1", 4, identity), wall("wall-2", 3.4, rotation90)], "measurements": []]]
    default:
      let back = matrixTransform(simd_float4x4(columns: (identity.columns.0, identity.columns.1, identity.columns.2, SIMD4<Float>(0, 0, -roomLength / 2, 1))))
      let front = matrixTransform(simd_float4x4(columns: (identity.columns.0, identity.columns.1, identity.columns.2, SIMD4<Float>(0, 0, roomLength / 2, 1))))
      let right = matrixTransform(simd_float4x4(columns: (rotation90.columns.0, rotation90.columns.1, rotation90.columns.2, SIMD4<Float>(roomWidth / 2, 0, 0, 1))))
      let left = matrixTransform(simd_float4x4(columns: (rotation90.columns.0, rotation90.columns.1, rotation90.columns.2, SIMD4<Float>(-roomWidth / 2, 0, 0, 1))))
      var elements: [[String: Any]] = [
        ["id": "wall-back", "kind": "wall", "dimensions": ["width": roomWidth, "height": roomHeight, "depth": 0.1], "transform": back],
        ["id": "wall-front", "kind": "wall", "dimensions": ["width": roomWidth, "height": roomHeight, "depth": 0.1], "transform": front],
        ["id": "wall-right", "kind": "wall", "dimensions": ["width": roomLength, "height": roomHeight, "depth": 0.1], "transform": right],
        ["id": "wall-left", "kind": "wall", "dimensions": ["width": roomLength, "height": roomHeight, "depth": 0.1], "transform": left],
      ]
      elements.append(["id": "floor", "kind": "floor", "dimensions": ["width": roomWidth, "height": 0, "depth": roomLength], "transform": matrixTransform(simd_float4x4(columns: (identity.columns.0, identity.columns.1, identity.columns.2, SIMD4<Float>(0, -roomHeight / 2, 0, 1))))])
      elements.append(["id": "door", "kind": "door", "dimensions": ["width": 0.9, "height": 2.1, "depth": 0.04], "transform": matrixTransform(simd_float4x4(columns: (identity.columns.0, identity.columns.1, identity.columns.2, SIMD4<Float>(0.5, -roomHeight / 2 + 1.05, -roomLength / 2, 1))))])
      // A non-axis-aligned capture exposes a floor-only rotation immediately.
      var capture = simd_float4x4(simd_quatf(angle: 37 * .pi / 180, axis: SIMD3<Float>(0, 1, 0)))
      capture.columns.3 = SIMD4<Float>(8.123456, 0, -6.765432, 1)
      elements = elements.map { element in
        var next = element
        if let transform = element["transform"] as? [String: Any], let matrix = simdMatrix(from: transform) {
          next["transform"] = matrixTransform(capture * matrix)
        }
        return next
      }
      return ["id": "debug-room", "transform": matrixTransform(identity), "roomScan": ["elements": elements, "measurements": []]]
    }
  }
  #endif

  private func makeOpeningNode(width: Float, height: Float, depth: Float, opening: Bool) -> SCNNode {
    let group = SCNNode(); let thickness = max(width * 0.08, 0.035)
    let left = SCNNode(geometry: SCNBox(width: CGFloat(thickness), height: CGFloat(max(height, 0.02)), length: CGFloat(depth), chamferRadius: 0)); left.simdPosition.x = -max(width / 2 - thickness / 2, 0)
    let right = left.clone(); right.simdPosition.x *= -1
    let top = SCNNode(geometry: SCNBox(width: CGFloat(max(width, thickness)), height: CGFloat(thickness), length: CGFloat(depth), chamferRadius: 0)); top.simdPosition.y = max(height / 2 - thickness / 2, 0)
    let children: [SCNNode] = [left, right, top]
    children.forEach { child in child.geometry?.firstMaterial = material(for: opening ? "opening" : "door", category: ""); group.addChildNode(child) }
    return group
  }

  private func material(for kind: String, category: String) -> SCNMaterial {
    let material = SCNMaterial(); material.isDoubleSided = true
    switch kind {
    case "wall": material.diffuse.contents = UIColor(red: 0.12, green: 0.25, blue: 0.40, alpha: 0.8)
    case "floor": material.diffuse.contents = UIColor(red: 0.32, green: 0.40, blue: 0.49, alpha: 0.65)
    case "ceiling": material.diffuse.contents = UIColor(red: 0.72, green: 0.80, blue: 0.87, alpha: 0.16)
    case "window": material.diffuse.contents = UIColor.systemBlue.withAlphaComponent(0.55)
    case "mesh": material.diffuse.contents = UIColor(red: 0.24, green: 0.35, blue: 0.48, alpha: 0.34)
    case "furniture": material.diffuse.contents = furnitureColor(category)
    case "built-in", "fixture": material.diffuse.contents = UIColor(red: 0.43, green: 0.54, blue: 0.64, alpha: 0.68)
    case "opening": material.diffuse.contents = UIColor(red: 0.10, green: 0.14, blue: 0.19, alpha: 0.85)
    case "door": material.diffuse.contents = UIColor(red: 0.62, green: 0.73, blue: 0.82, alpha: 0.85)
    case "measurement": material.diffuse.contents = UIColor.white
    default: material.diffuse.contents = UIColor.systemGray.withAlphaComponent(0.55)
    }
    material.transparency = kind == "mesh" ? 0.75 : 1; return material
  }

  private func diagnosticMeshMaterial(_ anchorIndex: Int) -> SCNMaterial {
    let colors: [UIColor] = [.systemPurple, .systemPink, .systemTeal, .systemYellow, .systemOrange, .systemGreen, .systemBlue]
    let material = SCNMaterial()
    material.isDoubleSided = true
    material.diffuse.contents = colors[anchorIndex % colors.count].withAlphaComponent(0.5)
    material.transparency = 0.75
    return material
  }

  private func furnitureColor(_ category: String) -> UIColor {
    switch category {
    case "sofa", "bed": return UIColor(red: 0.23, green: 0.33, blue: 0.46, alpha: 1)
    case "table", "chair": return UIColor(red: 0.43, green: 0.51, blue: 0.60, alpha: 1)
    default: return UIColor(red: 0.30, green: 0.43, blue: 0.57, alpha: 1)
    }
  }

  private func addProjectGrid() {
    let grid = SCNNode(); let gridMaterial = material(for: "grid", category: "")
    for index in stride(from: -10, through: 10, by: 1) {
      let x = SCNNode(geometry: SCNBox(width: 0.01, height: 0.005, length: 20, chamferRadius: 0)); x.position.x = Float(index); x.geometry?.firstMaterial = gridMaterial; grid.addChildNode(x)
      let z = SCNNode(geometry: SCNBox(width: 20, height: 0.005, length: 0.01, chamferRadius: 0)); z.position.z = Float(index); z.geometry?.firstMaterial = gridMaterial; grid.addChildNode(z)
    }
    grid.enumerateChildNodes { node, _ in node.categoryBitMask = 2 }
    grid.name = "project-grid"; contentNode.addChildNode(grid)
  }

  @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
    // Closest geometry only; do not enumerate through to rooms behind it.
    let options: [SCNHitTestOption: Any] = [.searchMode: SCNHitTestSearchMode.closest.rawValue, .categoryBitMask: 1]
    guard let hit = sceneView.hitTest(gesture.location(in: sceneView), options: options).first,
          let identity = sceneIdentity(for: hit.node) else { onSceneSelection?(["kind": "background"]); return }
    if assemblyMode {
      var selection: [String: Any] = ["kind": "room", "roomId": identity.roomId]
      if let featureId = identity.featureId { selection["featureId"] = featureId }
      onSceneSelection?(selection)
    }
    else if let featureId = identity.featureId { onSceneSelection?(["kind": "feature", "roomId": identity.roomId, "featureId": featureId]) }
    else { onSceneSelection?(["kind": "room", "roomId": identity.roomId]) }
  }

  private func planePoint(_ location: CGPoint, elevation: Float) -> SIMD3<Float>? {
    let near = sceneView.unprojectPoint(SCNVector3(Float(location.x), Float(location.y), 0))
    let far = sceneView.unprojectPoint(SCNVector3(Float(location.x), Float(location.y), 1))
    let origin = SIMD3<Float>(near.x, near.y, near.z), direction = SIMD3<Float>(far.x - near.x, far.y - near.y, far.z - near.z)
    guard abs(direction.y) > 0.00001 else { return nil }
    let t = (elevation - origin.y) / direction.y
    guard t >= 0 else { return nil }
    return origin + direction * t
  }

  private func editableRoom() -> (String, SCNNode)? {
    guard allowDirectManipulation, let id = editingRoomId, id != lockedRoomId, let node = roomNodes[id] else { return nil }
    return (id, node)
  }

  private func finishRoomGesture(_ gesture: UIGestureRecognizer, id: String, node: SCNNode) {
    if gesture.state == .cancelled || gesture.state == .failed {
      if let gestureStartTransform { node.simdTransform = gestureStartTransform }
      self.gestureStartTransform = nil
    } else if gesture.state == .ended {
      let next = matrixTransform(node.simdTransform)
      roomTransforms[id] = next
      onRoomTransformChange?(["roomId": id, "transform": next])
      gestureStartTransform = nil
    }
    updateAnnotations()
  }

  @objc private func handleRoomPan(_ gesture: UIPanGestureRecognizer) {
    guard let (id, node) = editableRoom() else { return }
    let location = gesture.location(in: sceneView)
    if gesture.state == .began { lastPanLocation = location; gestureStartTransform = node.simdTransform; return }
    if gesture.state == .changed {
      let center = node.simdConvertPosition(roomCenters[id] ?? .zero, to: nil)
      if let previous = planePoint(lastPanLocation, elevation: center.y), let current = planePoint(location, elevation: center.y) {
        let delta = contentNode.simdConvertVector(current - previous, from: nil)
        node.simdPosition += delta
      }
      lastPanLocation = location
    }
    finishRoomGesture(gesture, id: id, node: node)
  }

  static func rotatedRoomMatrix(_ matrix: simd_float4x4, radians: Float, center: SIMD3<Float>) -> simd_float4x4 {
    let pivot = matrix * SIMD4<Float>(center.x, center.y, center.z, 1)
    var rotation = simd_float4x4(simd_quatf(angle: radians, axis: SIMD3<Float>(0, 1, 0)))
    let rotatedPivot = rotation * pivot
    rotation.columns.3 = SIMD4<Float>(pivot.x - rotatedPivot.x, 0, pivot.z - rotatedPivot.z, 1)
    return rotation * matrix
  }

  @objc private func handleRoomRotation(_ gesture: UIRotationGestureRecognizer) {
    guard let (id, node) = editableRoom() else { return }
    if gesture.state == .began { gestureStartTransform = node.simdTransform }
    if gesture.state == .changed {
      node.simdTransform = Self.rotatedRoomMatrix(node.simdTransform, radians: -Float(gesture.rotation), center: roomCenters[id] ?? .zero)
    }
    gesture.rotation = 0
    finishRoomGesture(gesture, id: id, node: node)
  }

  private func refreshSelection() {
    let data = selectedFeatureIdsJSON.data(using: .utf8) ?? Data(); let selectedFeatures = (try? JSONSerialization.jsonObject(with: data) as? [String]) ?? []
    for roomNode in roomNodes.values { roomNode.enumerateChildNodes { node, _ in guard let identity = self.sceneIdentity(for: node) else { return }; let selected = identity.roomId == self.selectedRoomId || (identity.featureId.map(selectedFeatures.contains) ?? false); node.geometry?.firstMaterial?.emission.contents = selected ? UIColor(red: 0.22, green: 0.42, blue: 0.65, alpha: 1) : identity.roomId == self.lockedRoomId ? UIColor(red: 0.10, green: 0.17, blue: 0.24, alpha: 1) : UIColor.clear } }
  }

  private func resetCamera() { fitCamera(to: Array(roomNodes.values)) }

  private func fitCamera(to nodes: [SCNNode]) {
    let cameraNode = SCNNode(); let camera = SCNCamera(); cameraNode.camera = camera
    let roomBounds = nodes.flatMap { node in boundsCorners(node.boundingBox).map { node.convertPosition($0, to: contentNode) } }
    let box = bounds(for: roomBounds); let center = SCNVector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)
    let aspect = max(Float(sceneView.bounds.width / max(sceneView.bounds.height, 1)), 0.1)
    let halfVertical = Float(camera.fieldOfView) * .pi / 360
    let halfHorizontal = atan(tan(halfVertical) * aspect)
    let radius = max(distance(box.min, box.max) / 2, 0.5)
    let cameraDistance = radius / sin(min(halfVertical, halfHorizontal)) * 1.15
    let direction = simd_normalize(SIMD3<Float>(1.35, 0.95, 1.35))
    cameraNode.simdPosition = SIMD3<Float>(center.x, center.y, center.z) + direction * cameraDistance
    camera.automaticallyAdjustsZRange = true
    cameraNode.look(at: center)
    scene.rootNode.childNodes.filter { $0.camera != nil }.forEach { $0.removeFromParentNode() }; scene.rootNode.addChildNode(cameraNode)
    sceneView.pointOfView = cameraNode
    sceneView.defaultCameraController.stopInertia()
    sceneView.defaultCameraController.target = center
  }

  private func releaseSceneResources() {
    guard !hasReleasedScene else { return }
    hasReleasedScene = true
    displayLink?.invalidate(); displayLink = nil
    clearAnnotations()
    roomCenters.removeAll()
    if let rotationGesture { sceneView.removeGestureRecognizer(rotationGesture) }; rotationGesture = nil
    if let panGesture { sceneView.removeGestureRecognizer(panGesture) }
    panGesture = nil
    roomNodes.removeAll()
    roomTransforms.removeAll()
    lastModelJSON = ""
    measurementLabelCount = 0
    contentNode.childNodes.forEach { $0.removeFromParentNode() }
    scene.rootNode.childNodes.filter { $0.camera != nil }.forEach { $0.removeFromParentNode() }
    sceneView.scene = nil
  }

  deinit { releaseSceneResources() }

  private func apply(_ transform: [String: Any], to node: SCNNode) {
    if let matrix = simdMatrix(from: transform) {
      node.simdTransform = matrix
      return
    }
    let position = transform["position"] as? [String: Any] ?? [:]; node.position = SCNVector3(number(position["x"]), number(position["y"]), number(position["z"]))
    let rotation = transform["rotation"] as? [String: Any] ?? [:]; node.eulerAngles = SCNVector3(number(rotation["pitch"]), number(rotation["yaw"]), number(rotation["roll"]))
  }

  private func integer(_ value: Any?) -> Int? {
    if let value = value as? NSNumber { return value.intValue }
    if let value = value as? Int { return value }
    return nil
  }

  private func finiteNumber(_ value: Any?) -> Bool {
    if let value = value as? NSNumber { return value.doubleValue.isFinite }
    if let value = value as? Double { return value.isFinite }
    if let value = value as? Float { return value.isFinite }
    return false
  }

  private func finiteTransform(_ transform: [String: Any]) -> Bool {
    if let values = numericArray(transform["matrix"]) {
      return values.count == 16 && values.allSatisfy(finiteNumber)
    }
    let position = transform["position"] as? [String: Any] ?? [:]
    let rotation = transform["rotation"] as? [String: Any] ?? [:]
    return ["x", "y", "z"].allSatisfy { finiteNumber(position[$0]) }
      && ["pitch", "yaw", "roll"].allSatisfy { finiteNumber(rotation[$0]) }
  }

  private func reportPersistedMeshFailure(_ anchorId: String, reason: String) {
    NSLog("[SavedRoom3D][MeshDiagnostics][INVALID] anchor=%@ %@", anchorId, reason)
  }

  private func bounds(for points: [SCNVector3]) -> (min: SCNVector3, max: SCNVector3) {
    guard let first = points.first else { return (SCNVector3Zero, SCNVector3Zero) }
    return points.dropFirst().reduce(into: (min: first, max: first)) { result, point in
      result.min = SCNVector3(min(result.min.x, point.x), min(result.min.y, point.y), min(result.min.z, point.z))
      result.max = SCNVector3(max(result.max.x, point.x), max(result.max.y, point.y), max(result.max.z, point.z))
    }
  }

  private func boundsCorners(_ bounds: (min: SCNVector3, max: SCNVector3)) -> [SCNVector3] {
    [
      SCNVector3(bounds.min.x, bounds.min.y, bounds.min.z), SCNVector3(bounds.min.x, bounds.min.y, bounds.max.z),
      SCNVector3(bounds.min.x, bounds.max.y, bounds.min.z), SCNVector3(bounds.min.x, bounds.max.y, bounds.max.z),
      SCNVector3(bounds.max.x, bounds.min.y, bounds.min.z), SCNVector3(bounds.max.x, bounds.min.y, bounds.max.z),
      SCNVector3(bounds.max.x, bounds.max.y, bounds.min.z), SCNVector3(bounds.max.x, bounds.max.y, bounds.max.z),
    ]
  }

  private func number(_ value: Any?) -> Float { if let value = value as? NSNumber { return value.floatValue }; if let value = value as? Double { return Float(value) }; return 0 }
  private struct SceneIdentity { let roomId: String; let featureId: String? }
  private func sceneIdentity(for node: SCNNode?) -> SceneIdentity? { var current = node; while let candidate = current { let parts = (candidate.name ?? "").split(separator: "|").map(String.init); if parts.first == "feature", parts.count >= 3 { return SceneIdentity(roomId: parts[1], featureId: parts[2]) }; if parts.first == "room", parts.count >= 2 { return SceneIdentity(roomId: parts[1], featureId: nil) }; current = candidate.parent }; return nil }
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
