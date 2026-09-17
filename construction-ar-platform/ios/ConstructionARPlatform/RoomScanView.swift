import Foundation
import ARKit
import React
import RoomPlan
import SceneKit
import UIKit
import simd

@objcMembers
final class RoomScanView: UIView, RoomCaptureViewDelegate, RoomCaptureSessionDelegate, ARSessionDelegate {
  @objc var onRoomScanUpdate: RCTBubblingEventBlock?

  @objc var startRequestId: NSNumber = 0 {
    didSet {
      guard startRequestId != oldValue else { return }
      startCapture()
    }
  }

  @objc var finishRequestId: NSNumber = 0 {
    didSet {
      guard finishRequestId != oldValue else { return }
      finishCapture()
    }
  }

  @objc var showMeasurements: Bool = false { didSet { setMeasurementAnnotationsHidden(!showMeasurements) } }

  private struct MeasurementState {
    var value: Float
    let initialEstimate: Float
    var updateCount: Int
    var observationCount: Int
    var confidence: Float
    var quality: String
    var valueSource: String
    var history: [[String: Any]]
  }

  private struct RawMeasurement {
    let elementId: String
    let category: String
    let dimension: String
    let label: String
    let value: Float
    let rawValue: Float?
    let confidence: Float
    let quality: String
    let valueSource: String
    let wallId: String?
  }

  private struct WallHeightAssessment {
    let value: Float
    let rawRoomPlanValue: Float
    let quality: String
    let valueSource: String
    let floorElevation: Float?
    let ceilingElevation: Float?
    let rawBottom: Float
    let rawTop: Float
  }

  private var roomCaptureView: RoomCaptureView?
  private var didStart = false
  private var didFinish = false
  private var didNotifyUnsupported = false
  private var lastProgress: Float = 0
  private var scanUpdateCount = 0
  private var measurementStates: [String: MeasurementState] = [:]
  private var wallIds: [String: String] = [:]
  private var nextWallNumber = 1

  private struct MeshState {
    let transform: simd_float4x4
    let vertices: [SIMD3<Float>]
    let indices: [Int32]
    let floorElevation: Float?
    let ceilingElevation: Float?
    let bytesPerIndex: Int
    let indexCountPerPrimitive: Int
    let localBoundsMin: SIMD3<Float>
    let localBoundsMax: SIMD3<Float>
    let worldBoundsMin: SIMD3<Float>
    let worldBoundsMax: SIMD3<Float>
  }

  private var meshStates: [UUID: MeshState] = [:]
  private let annotationSceneView = SCNView()
  private let annotationScene = SCNScene()
  private let annotationRootNode = SCNNode()
  private let annotationCameraNode = SCNNode()
  private var measurementAnnotationNodes: [String: SCNNode] = [:]
  private let miniatureSceneView = SCNView()
  private let miniatureScene = SCNScene()
  private let miniatureRootNode = SCNNode()
  private let miniatureCameraNode = SCNNode()
  private weak var roomPlanARSessionDelegate: ARSessionDelegate?
  private weak var observedARSession: ARSession?
  private var annotationDisplayLink: CADisplayLink?
  private var processingTask: Task<Void, Never>?
  private var lastMiniatureSignature = ""
  private var didLogFirstFrame = false
  private var didLogFirstMeshAnchor = false
  private var diagnosedMeshAnchorIds: Set<UUID> = []
  private var reportedMeshFailureKeys: Set<String> = []

  override init(frame: CGRect) {
    super.init(frame: frame)
    configureCaptureView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configureCaptureView()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    roomCaptureView?.frame = bounds
    annotationSceneView.frame = bounds
    let miniWidth = min(bounds.width * 0.36, 220)
    let miniHeight = min(bounds.height * 0.30, 180)
    miniatureSceneView.frame = CGRect(x: 12, y: max(bounds.height * 0.56, bounds.height - miniHeight - 170), width: miniWidth, height: miniHeight)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      if startRequestId.intValue > 0, !didStart { startCapture() }
      if annotationDisplayLink == nil {
        let displayLink = CADisplayLink(target: self, selector: #selector(updateAnnotationsFromDisplayLink))
        displayLink.add(to: .main, forMode: .common)
        annotationDisplayLink = displayLink
      }
    } else {
      annotationDisplayLink?.invalidate()
      annotationDisplayLink = nil
      if didStart || didFinish { releaseCaptureResources() }
    }
  }

  @objc private func updateAnnotationsFromDisplayLink() {
    updateMeasurementSceneCamera(frame: sessionFrame())
  }

  private func configureCaptureView() {
    NSLog("[RoomScan][Startup] configuring scanner view")
    guard RoomCaptureSession.isSupported else {
      NSLog("[RoomScan][Startup] RoomCaptureSession is unsupported")
      notifyUnsupported()
      return
    }

    let captureView: RoomCaptureView
    if #available(iOS 17.0, *), ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
      // RoomPlan can use a caller-provided session on iOS 17+. Configure mesh
      // reconstruction before RoomPlan starts so the semantic capture and the
      // supplemental architectural mesh share one camera/world coordinate system.
      let arSession = ARSession()
      let configuration = ARWorldTrackingConfiguration()
      configuration.sceneReconstruction = .meshWithClassification
      configuration.planeDetection = [.horizontal, .vertical]
      NSLog("[RoomScan][Startup] created iOS 17 scene-reconstruction configuration")
      arSession.run(configuration)
      captureView = RoomCaptureView(frame: bounds, arSession: arSession)
    } else {
      captureView = RoomCaptureView(frame: bounds)
    }
    captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    captureView.delegate = self
    captureView.captureSession.delegate = self
    captureView.isModelEnabled = false
    roomCaptureView = captureView
    addSubview(captureView)

    // Render measurement text in a transparent SceneKit view layered over
    // RoomCaptureView. The annotation scene has the same AR world coordinates
    // and a camera whose pose/projection are synchronized from ARFrame.
    annotationSceneView.scene = annotationScene
    annotationSceneView.backgroundColor = .clear
    annotationSceneView.isOpaque = false
    annotationSceneView.allowsCameraControl = false
    annotationSceneView.isUserInteractionEnabled = false
    annotationSceneView.preferredFramesPerSecond = 60
    annotationSceneView.rendersContinuously = true
    annotationScene.rootNode.addChildNode(annotationRootNode)
    annotationCameraNode.camera = SCNCamera()
    annotationCameraNode.camera?.zNear = 0.01
    annotationCameraNode.camera?.zFar = 100
    annotationScene.rootNode.addChildNode(annotationCameraNode)
    annotationSceneView.pointOfView = annotationCameraNode
    addSubview(annotationSceneView)

    // Keep a smaller native reconstruction out of the center of the camera.
    // RoomCaptureView's built-in model is centered and cannot be repositioned.
    miniatureSceneView.scene = miniatureScene
    miniatureSceneView.backgroundColor = UIColor(red: 0.02, green: 0.08, blue: 0.15, alpha: 0.72)
    miniatureSceneView.layer.cornerRadius = 10
    miniatureSceneView.layer.borderWidth = 1
    miniatureSceneView.layer.borderColor = UIColor.white.withAlphaComponent(0.25).cgColor
    miniatureSceneView.isOpaque = false
    miniatureSceneView.isUserInteractionEnabled = false
    miniatureScene.rootNode.addChildNode(miniatureRootNode)
    miniatureCameraNode.camera = SCNCamera()
    miniatureCameraNode.camera?.zNear = 0.01
    miniatureCameraNode.camera?.zFar = 100
    miniatureScene.rootNode.addChildNode(miniatureCameraNode)
    miniatureSceneView.pointOfView = miniatureCameraNode
    miniatureSceneView.isHidden = true
    addSubview(miniatureSceneView)
    bringSubviewToFront(annotationSceneView)
  }

  private func startCapture() {
    guard !didStart else { return }
    guard let captureView = roomCaptureView else {
      notifyUnsupported()
      return
    }

    didStart = true
    didFinish = false
    didLogFirstFrame = false
    didLogFirstMeshAnchor = false
    diagnosedMeshAnchorIds.removeAll()
    reportedMeshFailureKeys.removeAll()
    lastProgress = 0
    scanUpdateCount = 0
    annotationSceneView.rendersContinuously = true
    miniatureSceneView.rendersContinuously = true
    measurementStates.removeAll()
    meshStates.removeAll()
    diagnosedMeshAnchorIds.removeAll()
    reportedMeshFailureKeys.removeAll()
    wallIds.removeAll()
    nextWallNumber = 1
    measurementAnnotationNodes.removeAll()
    annotationRootNode.childNodes.forEach { $0.removeFromParentNode() }
    lastMiniatureSignature = ""
    var configuration = RoomCaptureSession.Configuration()
    configuration.isCoachingEnabled = true
    NSLog("[RoomScan][Startup] starting RoomCaptureSession")
    if #available(iOS 17.0, *) {
      observeARSession(captureView.captureSession.arSession)
    }
    captureView.captureSession.run(configuration: configuration)
    NSLog("[RoomScan][Startup] RoomCaptureSession started")
    emit(kind: "session-started", message: "Room Scan started. Move slowly around the room and include each wall and major object.", progress: 0)
  }

  private func notifyUnsupported() {
    guard !didNotifyUnsupported else { return }
    didNotifyUnsupported = true
    // Defer one run-loop turn so React Native has attached the event callback
    // before an unsupported-device result is emitted.
    DispatchQueue.main.async { [weak self] in
      self?.emit(kind: "session-unsupported", message: "Room Scan requires a LiDAR-capable iPhone running iOS 16 or later.")
    }
  }

  private func finishCapture() {
    guard didStart, !didFinish else { return }
    didFinish = true
    roomCaptureView?.captureSession.stop()
    emit(kind: "progress", message: "Processing room geometry and recognized objects…", progress: 0.98)
  }

  func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
    if let error {
      emit(kind: "scan-failed", message: error.localizedDescription)
      releaseCaptureResources()
      return false
    }
    return true
  }

  func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
    // RoomCaptureSession's didEnd callback is used because it is also delivered
    // when the view is hosted by React Native rather than a full-screen controller.
  }

  func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
    scanUpdateCount += 1
    let observedCount = room.walls.count + room.objects.count + room.doors.count + room.windows.count + room.openings.count
    let measurements = serializeMeasurements(for: room, timestamp: ISO8601DateFormatter().string(from: Date()), observationCount: max(1, scanUpdateCount))
    updateMeasurementAnnotations(for: room, measurements: measurements)
    updateMiniatureModel(for: room)
    let estimatedProgress = min(0.95, max(lastProgress, 0.12 + Float(observedCount) / 80.0))
    if estimatedProgress - lastProgress >= 0.03 {
      lastProgress = estimatedProgress
      emit(kind: "progress", message: "Scanning room…", progress: estimatedProgress, measurements: measurements)
    }
  }

  func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
    if let error {
      emit(kind: "scan-failed", message: error.localizedDescription)
      releaseCaptureResources()
      return
    }

    processingTask = Task { @MainActor [weak self] in
      do {
        let room = try await RoomBuilder(options: []).capturedRoom(from: data)
        guard !Task.isCancelled, let self else { return }
        self.emit(kind: "scan-completed", message: "Room Scan complete.", progress: 1, scan: self.serialize(room))
        self.releaseCaptureResources()
      } catch {
        if !Task.isCancelled, let self {
          self.emit(kind: "scan-failed", message: "Room Scan could not be processed: \(error.localizedDescription)")
          self.releaseCaptureResources()
        }
      }
    }
  }

  func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
    // RoomPlan renders its own concise coaching state inside the native view.
  }

  @available(iOS 17.0, *)
  private func observeARSession(_ session: ARSession) {
    guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) else { return }
    guard observedARSession !== session else { return }
    roomPlanARSessionDelegate = session.delegate
    observedARSession = session
    // RoomCaptureSession owns the ARSession delegate. Forward its callbacks
    // through this view so mesh/frame observation does not disable RoomPlan.
    session.delegate = self
  }

  private func releaseCaptureResources() {
    annotationDisplayLink?.invalidate()
    annotationDisplayLink = nil
    processingTask?.cancel()
    processingTask = nil
    if let observedARSession, observedARSession.delegate === self {
      observedARSession.delegate = roomPlanARSessionDelegate
    }
    observedARSession?.pause()
    roomCaptureView?.captureSession.stop()
    roomCaptureView?.captureSession.delegate = nil
    roomCaptureView?.delegate = nil
    roomCaptureView?.captureSession.arSession.pause()
    roomCaptureView?.removeFromSuperview()
    roomCaptureView = nil
    roomPlanARSessionDelegate = nil
    observedARSession = nil
    measurementAnnotationNodes.removeAll()
    annotationRootNode.childNodes.forEach { $0.removeFromParentNode() }
    miniatureRootNode.childNodes.forEach { $0.removeFromParentNode() }
    measurementStates.removeAll()
    meshStates.removeAll()
    wallIds.removeAll()
    lastMiniatureSignature = ""
    annotationSceneView.rendersContinuously = false
    miniatureSceneView.rendersContinuously = false
  }

  deinit {
    releaseCaptureResources()
  }

  @available(iOS 11.0, *)
  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    if !didLogFirstFrame {
      didLogFirstFrame = true
      NSLog("[RoomScan][Startup] first ARFrame received")
    }
    updateMeasurementSceneCamera(frame: frame)
    roomPlanARSessionDelegate?.session?(session, didUpdate: frame)
  }

  @available(iOS 11.0, *)
  func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
    if #available(iOS 17.0, *) {
      let meshAnchors = anchors.compactMap { $0 as? ARMeshAnchor }
      if !meshAnchors.isEmpty && !didLogFirstMeshAnchor {
        didLogFirstMeshAnchor = true
        NSLog("[RoomScan][Startup] first ARMeshAnchor received count=%d", meshAnchors.count)
      }
      meshAnchors.forEach { rememberMesh($0) }
    }
    roomPlanARSessionDelegate?.session?(session, didAdd: anchors)
  }

  @available(iOS 11.0, *)
  func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
    if #available(iOS 17.0, *) {
      anchors.compactMap { $0 as? ARMeshAnchor }.forEach { rememberMesh($0) }
    }
    roomPlanARSessionDelegate?.session?(session, didUpdate: anchors)
  }

  @available(iOS 11.0, *)
  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    roomPlanARSessionDelegate?.session?(session, didRemove: anchors)
  }

  @available(iOS 11.0, *)
  func session(_ session: ARSession, didFailWithError error: Error) {
    roomPlanARSessionDelegate?.session?(session, didFailWithError: error)
  }

  @available(iOS 11.0, *)
  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    roomPlanARSessionDelegate?.session?(session, cameraDidChangeTrackingState: camera)
  }

  @available(iOS 11.0, *)
  func sessionWasInterrupted(_ session: ARSession) {
    roomPlanARSessionDelegate?.sessionWasInterrupted?(session)
  }

  @available(iOS 11.0, *)
  func sessionInterruptionEnded(_ session: ARSession) {
    roomPlanARSessionDelegate?.sessionInterruptionEnded?(session)
  }

  @available(iOS 11.3, *)
  func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool {
    roomPlanARSessionDelegate?.sessionShouldAttemptRelocalization?(session) ?? false
  }

  @available(iOS 11.0, *)
  func session(_ session: ARSession, didOutputAudioSampleBuffer audioSampleBuffer: CMSampleBuffer) {
    roomPlanARSessionDelegate?.session?(session, didOutputAudioSampleBuffer: audioSampleBuffer)
  }

  @available(iOS 13.0, *)
  func session(_ session: ARSession, didOutputCollaborationData data: ARSession.CollaborationData) {
    roomPlanARSessionDelegate?.session?(session, didOutputCollaborationData: data)
  }

  @available(iOS 14.0, *)
  func session(_ session: ARSession, didChange geoTrackingStatus: ARGeoTrackingStatus) {
    roomPlanARSessionDelegate?.session?(session, didChange: geoTrackingStatus)
  }

  private func updateMeasurementAnnotations(for room: CapturedRoom, measurements: [[String: Any]]) {
    let elements = Dictionary(uniqueKeysWithValues: (room.walls.map { ($0.identifier.uuidString, ($0.transform, $0.dimensions, "wall")) }
      + room.doors.map { ($0.identifier.uuidString, ($0.transform, $0.dimensions, "door")) }
      + room.windows.map { ($0.identifier.uuidString, ($0.transform, $0.dimensions, "window")) }
      + room.openings.map { ($0.identifier.uuidString, ($0.transform, $0.dimensions, "opening")) }
      + (ifAvailableFloors(room)).map { ($0.identifier.uuidString, ($0.transform, $0.dimensions, "floor")) }
      + room.objects.map { ($0.identifier.uuidString, ($0.transform, $0.dimensions, objectCategory($0.category))) }))
    let grouped = Dictionary(grouping: measurements, by: { $0["elementId"] as? String ?? "" })
    let candidates = grouped.keys.compactMap { id -> (String, String, String, SCNVector3)? in
      guard let element = elements[id], let values = grouped[id], !values.isEmpty else { return nil }
      let dimensionText = measurementText(values: values, kind: element.2)
      guard !dimensionText.isEmpty else { return nil }
      let cameraPosition = sessionFrame().map { position(from: $0.camera.transform) }
      return (id, dimensionText, element.2, annotationPoint(transform: element.0, dimensions: element.1, kind: element.2, cameraPosition: cameraPosition))
    }
    // Walls are the primary live annotation. Keep every detected wall in the
    // scene, then add a small number of object/surface labels to avoid clutter.
    let wallCandidates = candidates.filter { $0.2 == "wall" }
    let otherCandidates = candidates.filter { $0.2 != "wall" }.prefix(8)
    let prioritized = wallCandidates + otherCandidates

    let activeIds = Set(prioritized.map { $0.0 })
    for (id, text, _, point) in prioritized {
      let label = measurementAnnotationNodes[id] ?? makeMeasurementAnnotation(text: text)
      updateMeasurementAnnotation(label, text: text, position: point)
      measurementAnnotationNodes[id] = label
    }
    for (id, label) in measurementAnnotationNodes where !activeIds.contains(id) { label.isHidden = true }
    updateMeasurementSceneCamera(frame: sessionFrame())
  }

  private func ifAvailableFloors(_ room: CapturedRoom) -> [CapturedRoom.Surface] {
    if #available(iOS 17.0, *) { return room.floors }
    return []
  }

  private func measurementText(values: [[String: Any]], kind: String) -> String {
    var byDimension: [String: Float] = [:]
    for item in values {
      guard let axis = item["dimension"] as? String, let value = item["value"] as? NSNumber,
            value.floatValue.isFinite, value.floatValue > 0 else { continue }
      byDimension[axis] = value.floatValue
    }
    // RoomPlan local axes: X=width, Z=depth, Y=height, independent of camera/rotation.
    let entries = [("width", "W"), ("depth", "D"), ("height", "H")].compactMap { axis, label in
      byDimension[axis].map { String(format: "%@ %.2f m", label, $0) }
    }
    guard !entries.isEmpty else { return "" }
    let prefix = kind == "wall" ? "\((values.first?["wallId"] as? String) ?? "Wall") " : ""
    return prefix + entries.joined(separator: " × ")
  }

  private func makeMeasurementAnnotation(text: String) -> SCNNode {
    let node = SCNNode()
    node.name = "measurement-annotation"
    node.constraints = [SCNBillboardConstraint()]

    let textGeometry = SCNText(string: text, extrusionDepth: 0.003)
    textGeometry.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
    textGeometry.flatness = 0.1
    let material = SCNMaterial()
    material.diffuse.contents = UIColor.white
    material.emission.contents = UIColor.white
    textGeometry.firstMaterial = material
    let textNode = SCNNode(geometry: textGeometry)
    textNode.name = "measurement-text"
    textNode.scale = SCNVector3(0.01, 0.01, 0.01)
    node.addChildNode(textNode)

    let backingMaterial = SCNMaterial()
    backingMaterial.diffuse.contents = UIColor.black.withAlphaComponent(0.58)
    backingMaterial.emission.contents = UIColor.black.withAlphaComponent(0.12)
    backingMaterial.isDoubleSided = true
    let backingNode = SCNNode(geometry: SCNPlane(width: 0.1, height: 0.04))
    backingNode.name = "measurement-backing"
    backingNode.geometry?.firstMaterial = backingMaterial
    backingNode.position.z = -0.003
    node.addChildNode(backingNode)

    annotationRootNode.addChildNode(node)
    updateMeasurementAnnotation(node, text: text, position: SCNVector3Zero)
    return node
  }

  private func updateMeasurementAnnotation(_ node: SCNNode, text: String, position: SCNVector3) {
    if let textNode = node.childNode(withName: "measurement-text", recursively: false), let textGeometry = textNode.geometry as? SCNText {
      textGeometry.string = text
      centerTextPivot(textNode)
      let (minBounds, maxBounds) = textGeometry.boundingBox
      let rawWidth = maxBounds.x - minBounds.x
      let rawHeight = maxBounds.y - minBounds.y
      // SCNText is authored in point-sized units. Bound the physical label to
      // a small annotation card so labels cannot cover a scanned wall.
      let textScale = min(0.006, max(0.0025, 0.30 / max(rawWidth, 1)))
      textNode.scale = SCNVector3(textScale, textScale, textScale)
      let physicalWidth = min(max(rawWidth * textScale + 0.035, 0.08), 0.36)
      let physicalHeight = min(max(rawHeight * textScale + 0.025, 0.045), 0.07)
      if let backing = node.childNode(withName: "measurement-backing", recursively: false) {
        backing.geometry = SCNPlane(width: CGFloat(physicalWidth), height: CGFloat(physicalHeight))
        backing.geometry?.firstMaterial = backing.geometry?.firstMaterial ?? {
          let material = SCNMaterial()
          material.diffuse.contents = UIColor.black.withAlphaComponent(0.58)
          material.isDoubleSided = true
          return material
        }()
      }
    }
    node.position = position
    node.isHidden = !showMeasurements
  }

  private func centerTextPivot(_ node: SCNNode) {
    guard let text = node.geometry as? SCNText else { return }
    let (minBounds, maxBounds) = text.boundingBox
    node.pivot = SCNMatrix4MakeTranslation((minBounds.x + maxBounds.x) / 2, (minBounds.y + maxBounds.y) / 2, 0)
  }

  private func annotationPoint(transform: simd_float4x4, dimensions: SIMD3<Float>, kind: String, cameraPosition: SIMD3<Float>? = nil) -> SCNVector3 {
    let localPoint: SIMD4<Float>
    switch kind {
    case "floor":
      // Floor transforms are centered on the plane; lift the label above it.
      localPoint = SIMD4<Float>(0, 0.08, 0, 1)
    case "wall", "door", "window", "opening":
      // RoomPlan's local Z axis is the surface normal for planar features.
      let center = position(from: transform)
      let normal = simd_normalize(SIMD3<Float>(transform.columns.2.x, transform.columns.2.y, transform.columns.2.z))
      let outwardSign: Float
      if let cameraPosition, simd_dot(cameraPosition - center, normal) < 0 { outwardSign = -1 } else { outwardSign = 1 }
      localPoint = SIMD4<Float>(0, 0, outwardSign * (dimensions.z / 2 + 0.06), 1)
    default:
      // Put object labels at the top/front of the measured bounding box.
      localPoint = SIMD4<Float>(0, dimensions.y / 2 + 0.08, dimensions.z / 2 + 0.04, 1)
    }
    let world = transform * localPoint
    return SCNVector3(world.x, world.y, world.z)
  }

  private func updateMeasurementSceneCamera(frame: ARFrame?) {
    guard let frame, bounds.width > 0, bounds.height > 0 else { return }
    let orientation = window?.windowScene?.interfaceOrientation ?? .portrait
    annotationCameraNode.transform = SCNMatrix4(frame.camera.transform)
    annotationCameraNode.camera?.projectionTransform = SCNMatrix4(frame.camera.projectionMatrix(for: orientation, viewportSize: bounds.size, zNear: 0.01, zFar: 100))
    annotationSceneView.isHidden = !showMeasurements
  }

  private func setMeasurementAnnotationsHidden(_ hidden: Bool) {
    annotationRootNode.isHidden = hidden
    annotationSceneView.isHidden = hidden
  }

  private func updateMiniatureModel(for room: CapturedRoom) {
    let signature = ([
      room.walls.map { $0.identifier.uuidString },
      room.doors.map { $0.identifier.uuidString },
      room.windows.map { $0.identifier.uuidString },
      room.openings.map { $0.identifier.uuidString },
      room.objects.map { $0.identifier.uuidString },
    ].flatMap { $0 }).joined(separator: "|")
    guard signature != lastMiniatureSignature else { return }
    lastMiniatureSignature = signature
    miniatureRootNode.childNodes.forEach { $0.removeFromParentNode() }
    for wall in room.walls { addMiniatureElement(transform: wall.transform, dimensions: wall.dimensions, kind: "wall") }
    for surface in room.doors + room.windows + room.openings { addMiniatureElement(transform: surface.transform, dimensions: surface.dimensions, kind: surfaceCategory(surface.category)) }
    if #available(iOS 17.0, *) {
      for floor in room.floors { addMiniatureElement(transform: floor.transform, dimensions: floor.dimensions, kind: "floor") }
    }
    for object in room.objects { addMiniatureElement(transform: object.transform, dimensions: object.dimensions, kind: objectCategory(object.category)) }
    miniatureSceneView.isHidden = miniatureRootNode.childNodes.isEmpty
    resetMiniatureCamera()
  }

  private func addMiniatureElement(transform: simd_float4x4, dimensions: SIMD3<Float>, kind: String) {
    let isFloor = kind == "floor"
    let geometry = SCNBox(width: CGFloat(max(dimensions.x, 0.02)), height: CGFloat(isFloor ? 0.015 : max(dimensions.y, 0.02)), length: CGFloat(max(dimensions.z, 0.02)), chamferRadius: 0)
    geometry.firstMaterial = miniatureMaterial(for: kind)
    let node = SCNNode(geometry: geometry)
    node.transform = SCNMatrix4(transform)
    miniatureRootNode.addChildNode(node)
  }

  private func miniatureMaterial(for kind: String) -> SCNMaterial {
    let material = SCNMaterial()
    material.isDoubleSided = true
    material.diffuse.contents = kind == "wall" ? UIColor.white.withAlphaComponent(0.82) : UIColor.systemTeal.withAlphaComponent(0.65)
    material.transparency = 0.82
    return material
  }

  private func resetMiniatureCamera() {
    let box = miniatureRootNode.boundingBox
    let center = SCNVector3((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)
    let span = max(max(box.max.x - box.min.x, box.max.y - box.min.y), max(box.max.z - box.min.z, 1))
    miniatureCameraNode.position = SCNVector3(center.x + span * 1.2, center.y + span * 0.85, center.z + span * 1.2)
    miniatureCameraNode.look(at: center)
  }

  private func sessionFrame() -> ARFrame? {
    roomCaptureView?.captureSession.arSession.currentFrame
  }

  private func number(_ value: Any?) -> Float {
    if let value = value as? NSNumber { return value.floatValue }
    if let value = value as? Double { return Float(value) }
    return 0
  }

  private func readMeshIndex(_ pointer: UnsafeMutableRawPointer, index: Int, bytesPerIndex: Int) -> UInt32? {
    let address = pointer.advanced(by: index * bytesPerIndex)
    switch bytesPerIndex {
    case MemoryLayout<UInt16>.size:
      var value: UInt16 = 0
      memcpy(&value, address, MemoryLayout<UInt16>.size)
      return UInt32(value)
    case MemoryLayout<UInt32>.size:
      var value: UInt32 = 0
      memcpy(&value, address, MemoryLayout<UInt32>.size)
      return value
    default:
      return nil
    }
  }

  private func bounds(for points: [SIMD3<Float>]) -> (min: SIMD3<Float>, max: SIMD3<Float>) {
    guard let first = points.first else {
      return (SIMD3<Float>(repeating: 0), SIMD3<Float>(repeating: 0))
    }
    return points.dropFirst().reduce(into: (min: first, max: first)) { result, point in
      result.min = SIMD3<Float>(min(result.min.x, point.x), min(result.min.y, point.y), min(result.min.z, point.z))
      result.max = SIMD3<Float>(max(result.max.x, point.x), max(result.max.y, point.y), max(result.max.z, point.z))
    }
  }

  private func matrixIsFinite(_ matrix: simd_float4x4) -> Bool {
    let columns = [matrix.columns.0, matrix.columns.1, matrix.columns.2, matrix.columns.3]
    return columns.allSatisfy { column in
      column.x.isFinite && column.y.isFinite && column.z.isFinite && column.w.isFinite
    }
  }

  @available(iOS 17.0, *)
  private func reportMeshFailure(_ anchor: ARMeshAnchor, reason: String) {
    let key = "\(anchor.identifier.uuidString)|\(reason)"
    guard reportedMeshFailureKeys.insert(key).inserted else { return }
    NSLog("[RoomScan][MeshDiagnostics][INVALID] anchor=%@ %@", anchor.identifier.uuidString, reason)
  }

  @available(iOS 17.0, *)
  private func rememberMesh(_ anchor: ARMeshAnchor) {
    // Each ARMeshAnchor owns its own local vertex/index space. We persist and
    // render anchors independently, so indexes must never be combined across
    // anchors and the anchor transform is applied exactly once on the node.
    let maxAnchors = 48
    guard meshStates[anchor.identifier] != nil || meshStates.count < maxAnchors else { return }
    let geometry = anchor.geometry
    let vertexCount = geometry.vertices.count
    let indexCountPerPrimitive = geometry.faces.indexCountPerPrimitive
    let bytesPerIndex = geometry.faces.bytesPerIndex
    guard vertexCount > 0, indexCountPerPrimitive == 3, bytesPerIndex == 2 || bytesPerIndex == 4 else {
      reportMeshFailure(anchor, reason: "Unsupported mesh layout: vertices=\(vertexCount) indexCountPerPrimitive=\(indexCountPerPrimitive) bytesPerIndex=\(bytesPerIndex)")
      return
    }

    // ARGeometryElement exposes no byte offset; its index buffer starts at
    // buffer.contents(). Keep the declared primitive range bounded by the
    // actual buffer length before any pointer arithmetic.
    guard geometry.faces.count <= Int.max / indexCountPerPrimitive else {
      reportMeshFailure(anchor, reason: "Invalid face primitive count")
      return
    }
    let totalIndexCount = geometry.faces.count * indexCountPerPrimitive
    let availableFaceBytes = geometry.faces.buffer.length
    guard totalIndexCount <= availableFaceBytes / bytesPerIndex else {
      reportMeshFailure(anchor, reason: "Face buffer is shorter than the declared index range")
      return
    }
    let vertexByteWidth = MemoryLayout<SIMD3<Float>>.size
    guard geometry.vertices.offset >= 0,
          geometry.vertices.offset <= geometry.vertices.buffer.length,
          geometry.vertices.stride >= vertexByteWidth,
          geometry.vertices.offset <= geometry.vertices.buffer.length - vertexByteWidth,
          vertexCount - 1 <= (geometry.vertices.buffer.length - geometry.vertices.offset - vertexByteWidth) / geometry.vertices.stride else {
      reportMeshFailure(anchor, reason: "Vertex buffer is shorter than the declared vertex range")
      return
    }

    let vertexPointer = geometry.vertices.buffer.contents().advanced(by: geometry.vertices.offset)
    var vertices: [SIMD3<Float>] = []
    vertices.reserveCapacity(vertexCount)
    for index in 0..<vertexCount {
      var vertex = SIMD3<Float>(repeating: 0)
      memcpy(&vertex, vertexPointer.advanced(by: index * geometry.vertices.stride), MemoryLayout<SIMD3<Float>>.size)
      guard vertex.x.isFinite, vertex.y.isFinite, vertex.z.isFinite else {
        reportMeshFailure(anchor, reason: "Non-finite local vertex at index \(index)")
        return
      }
      vertices.append(vertex)
    }

    guard matrixIsFinite(anchor.transform) else {
      reportMeshFailure(anchor, reason: "Non-finite anchor transform")
      return
    }

    let localBounds = bounds(for: vertices)
    let worldVertices = vertices.map { worldPoint($0, transform: anchor.transform) }
    guard worldVertices.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.z.isFinite }) else {
      reportMeshFailure(anchor, reason: "Non-finite world vertex after applying anchor transform")
      return
    }
    let maxCoordinate = (vertices + worldVertices).flatMap { [abs($0.x), abs($0.y), abs($0.z)] }.max() ?? 0
    guard maxCoordinate <= 10_000 else {
      reportMeshFailure(anchor, reason: "Coordinate magnitude (maxCoordinate)m exceeds the corruption sanity limit")
      return
    }
    let worldBounds = bounds(for: worldVertices)

    // Decode complete primitives. Filtering individual indexes is unsafe: if
    // one corner is invalid, appending the other two changes every subsequent
    // triangle's grouping and produces the characteristic sunburst geometry.
    let indexPointer = geometry.faces.buffer.contents()
    var indices: [Int32] = []
    indices.reserveCapacity(totalIndexCount)
    var invalidFaceCount = 0
    var minimumIndex = UInt32.max
    var maximumIndex: UInt32 = 0
    for faceIndex in 0..<geometry.faces.count {
      let baseIndex = faceIndex * indexCountPerPrimitive
      guard let first = readMeshIndex(indexPointer, index: baseIndex, bytesPerIndex: bytesPerIndex),
            let second = readMeshIndex(indexPointer, index: baseIndex + 1, bytesPerIndex: bytesPerIndex),
            let third = readMeshIndex(indexPointer, index: baseIndex + 2, bytesPerIndex: bytesPerIndex),
            first < UInt32(vertexCount), second < UInt32(vertexCount), third < UInt32(vertexCount) else {
        invalidFaceCount += 1
        continue
      }
      indices.append(contentsOf: [Int32(first), Int32(second), Int32(third)])
      minimumIndex = min(minimumIndex, first, second, third)
      maximumIndex = max(maximumIndex, first, second, third)
    }
    if invalidFaceCount > 0 {
      reportMeshFailure(anchor, reason: "Skipped \(invalidFaceCount) invalid triangle primitives out of \(geometry.faces.count)")
    }
    var floorSamples: [Float] = []
    var ceilingSamples: [Float] = []
    var classificationSource: ARGeometrySource?
    var classificationPointer: UnsafeMutableRawPointer?
    if let classification = geometry.classification {
      let classificationIsSafe = classification.count >= geometry.faces.count
        && classification.stride >= MemoryLayout<UInt8>.size
        && classification.offset >= 0
        && classification.offset <= classification.buffer.length
        && classification.offset <= classification.buffer.length - MemoryLayout<UInt8>.size
        && (classification.count == 0 || classification.count - 1 <= (classification.buffer.length - classification.offset - MemoryLayout<UInt8>.size) / classification.stride)
      if classificationIsSafe {
        classificationSource = classification
        classificationPointer = classification.buffer.contents().advanced(by: classification.offset)
      } else {
        reportMeshFailure(anchor, reason: "Classification buffer is shorter than the declared face range")
      }
    }
    guard indices.count >= 3 else { return }

    if let classification = classificationSource, let classificationPointer {
      let faceCount = geometry.faces.count
      for faceIndex in 0..<faceCount {
        let classificationAddress = classificationPointer.advanced(by: faceIndex * classification.stride)
        var classificationValue: UInt8 = 0
        memcpy(&classificationValue, classificationAddress, min(classification.stride, MemoryLayout<UInt8>.size))
        let faceClassification = ARMeshClassification(rawValue: Int(classificationValue))
        let firstIndex = faceIndex * geometry.faces.indexCountPerPrimitive
        let faceIndices = (0..<geometry.faces.indexCountPerPrimitive).compactMap { offset -> Int? in
          guard let value = readMeshIndex(indexPointer, index: firstIndex + offset, bytesPerIndex: bytesPerIndex) else { return nil }
          return value < UInt32(vertexCount) ? Int(value) : nil
        }
        let faceY = faceIndices.map { worldVertices[$0].y }
        guard !faceY.isEmpty else { continue }
        switch faceClassification {
        case .floor:
          floorSamples.append(faceY.reduce(0, +) / Float(faceY.count))
        case .ceiling:
          ceilingSamples.append(faceY.reduce(0, +) / Float(faceY.count))
        default:
          break
        }
      }
    }

    meshStates[anchor.identifier] = MeshState(
      transform: anchor.transform,
      vertices: vertices,
      indices: indices,
      floorElevation: median(floorSamples),
      ceilingElevation: median(ceilingSamples),
      bytesPerIndex: bytesPerIndex,
      indexCountPerPrimitive: indexCountPerPrimitive,
      localBoundsMin: localBounds.min,
      localBoundsMax: localBounds.max,
      worldBoundsMin: worldBounds.min,
      worldBoundsMax: worldBounds.max,
    )
    if diagnosedMeshAnchorIds.insert(anchor.identifier).inserted {
      NSLog("[RoomScan][MeshDiagnostics] anchor=\(anchor.identifier.uuidString) vertices=\(vertices.count) faces=\(indices.count / 3) indexes=\(indices.count) bytesPerIndex=\(bytesPerIndex) indexCountPerPrimitive=\(indexCountPerPrimitive) minIndex=\(minimumIndex == UInt32.max ? -1 : Int(minimumIndex)) maxIndex=\(maximumIndex) localBounds=\(localBounds.min)-\(localBounds.max) worldBounds=\(worldBounds.min)-\(worldBounds.max) transform=\(anchor.transform)")
    }
  }

  private func serialize(_ room: CapturedRoom) -> [String: Any] {
    var elements: [[String: Any]] = []
    elements.append(contentsOf: room.walls.map { serializeSurface($0, kind: "wall") })
    elements.append(contentsOf: room.doors.map { serializeSurface($0, kind: "door") })
    elements.append(contentsOf: room.windows.map { serializeSurface($0, kind: "window") })
    elements.append(contentsOf: room.openings.map { serializeSurface($0, kind: "opening") })
    if #available(iOS 17.0, *) {
      elements.append(contentsOf: room.floors.map { serializeSurface($0, kind: "floor") })
    }
    elements.append(contentsOf: room.objects.map(serializeObject))
    #if DEBUG
    if ProcessInfo.processInfo.environment["CONSTRUCTION_AR_TRANSFORM_DIAGNOSTICS"] == "1" {
      NSLog("[RoomTransform][Capture] room=\(room.identifier) container=\(matrix_identity_float4x4) frame=ARKit-world Y-up meters")
      for element in elements {
        NSLog("[RoomTransform][Capture] component=\(element)")
      }
    }
    #endif
    let capturedAt = ISO8601DateFormatter().string(from: Date())

    let wallAssessments = room.walls.map { assessWallHeight($0, in: room) }
    var result: [String: Any] = [
      "source": "roomplan",
      "capturedAt": capturedAt,
      "nativeIdentifier": room.identifier.uuidString,
      "elements": elements,
      "measurements": serializeMeasurements(for: room, timestamp: capturedAt, observationCount: max(1, scanUpdateCount)),
    ]
    if let nativeData = try? JSONEncoder().encode(room), let nativeJSON = String(data: nativeData, encoding: .utf8) {
      result["nativeCapturedRoomJSON"] = nativeJSON
    }
    if !meshStates.isEmpty {
      result["arkitMesh"] = serializeMesh(capturedAt: capturedAt)
    }
    let reliableHeights = wallAssessments.compactMap { assessment -> Float? in
      guard let floor = assessment.floorElevation, let ceiling = assessment.ceilingElevation else { return nil }
      let height = ceiling - floor
      return height.isFinite && height > 0 ? height : nil
    }
    if let ceilingHeight = reliableHeights.max() {
      result["ceilingHeight"] = ceilingHeight
    }
    if let footprint = footprint(from: room) {
      result["floorFootprint"] = dimensions(width: footprint.x, height: 0, depth: footprint.y)
    }
    return result
  }

  private func serializeMesh(capturedAt: String) -> [String: Any] {
    [
      "format": "arkit-mesh-v1",
      "capturedAt": capturedAt,
      "limitation": "Bounded ARKit scene-reconstruction mesh retained for irregular architecture; RoomPlan semantics remain authoritative for classified elements.",
      "anchors": meshStates.map { identifier, mesh in
        var result: [String: Any] = [
          "id": identifier.uuidString,
          "transform": transform(from: mesh.transform),
          "vertices": mesh.vertices.map(vector),
          "indices": mesh.indices.map(Int.init),
          "faceCount": mesh.indices.count / mesh.indexCountPerPrimitive,
          "indexCount": mesh.indices.count,
          "bytesPerIndex": mesh.bytesPerIndex,
          "indexCountPerPrimitive": mesh.indexCountPerPrimitive,
          "classification": "unclassified-architectural-mesh",
          "bounds": ["min": vector(mesh.localBoundsMin), "max": vector(mesh.localBoundsMax)],
          "worldBounds": ["min": vector(mesh.worldBoundsMin), "max": vector(mesh.worldBoundsMax)],
        ]
        if let floorElevation = mesh.floorElevation { result["floorElevation"] = floorElevation }
        if let ceilingElevation = mesh.ceilingElevation { result["ceilingElevation"] = ceilingElevation }
        return result
      },
    ]
  }

  private func serializeSurface(_ surface: CapturedRoom.Surface, kind: String) -> [String: Any] {
    var result: [String: Any] = [
      "id": surface.identifier.uuidString,
      "kind": kind,
      "category": surfaceCategory(surface.category),
      "representation": kind,
      "dimensions": dimensions(width: surface.dimensions.x, height: surface.dimensions.y, depth: surface.dimensions.z),
      "transform": transform(from: surface.transform),
      "confidence": confidence(surface.confidence),
    ]
    if #available(iOS 17.0, *) {
      result["polygonCorners"] = surface.polygonCorners.map(vector)
    }
    #if DEBUG
    if ProcessInfo.processInfo.environment["CONSTRUCTION_AR_TRANSFORM_DIAGNOSTICS"] == "1" {
      let source = surface.transform
      NSLog("[RoomTransform][Capture] kind=\(kind) id=\(surface.identifier) localPosition=\(position(from: source)) worldPosition=\(position(from: source)) localQuaternion=\(simd_quatf(source).vector) worldQuaternion=\(simd_quatf(source).vector) dimensions=\(surface.dimensions) parent=\(matrix_identity_float4x4) source=\(source)")
    }
    #endif
    if kind == "wall" { result["wallId"] = wallDisplayId(for: surface.identifier) }
    return result
  }

  private func serializeObject(_ object: CapturedRoom.Object) -> [String: Any] {
    let category = objectCategory(object.category)
    let kind: String
    let representation: String
    switch object.category {
    case .sofa, .chair, .table, .bed, .television:
      kind = "furniture"
      representation = category == "television" ? "television" : category
    case .storage, .fireplace:
      kind = "built-in"
      representation = category == "storage" ? "cabinet" : "fireplace"
    case .stairs:
      kind = "built-in"
      representation = "stairs"
    default:
      kind = "fixture"
      representation = ["sink", "toilet", "bathtub"].contains(category) ? "plumbing-fixture" : "appliance"
    }
    return [
      "id": object.identifier.uuidString,
      "kind": kind,
      "category": category,
      "representation": representation,
      "dimensions": dimensions(width: object.dimensions.x, height: object.dimensions.y, depth: object.dimensions.z),
      "transform": transform(from: object.transform),
      "confidence": confidence(object.confidence),
    ]
  }

  private func serializeMeasurements(for room: CapturedRoom, timestamp: String, observationCount: Int) -> [[String: Any]] {
    var raw: [RawMeasurement] = []
    // RoomPlan dimensions are meters in the element's local frame: x is the
    // horizontal width/length, y is vertical height, and z is thickness or
    // object depth. Floors use x as width and z as length.
    for wall in room.walls {
      let assessment = assessWallHeight(wall, in: room)
      raw.append(contentsOf: measurementValues(
        elementId: wall.identifier.uuidString,
        category: "wall",
        width: wall.dimensions.x,
        height: assessment.value,
        depth: nil,
        confidenceValue: confidence(wall.confidence),
        qualityOverride: assessment.quality,
        sourceOverride: assessment.valueSource,
        rawHeight: assessment.rawRoomPlanValue,
        wallId: wallDisplayId(for: wall.identifier),
      ))
    }
    for surface in room.doors + room.windows + room.openings {
      let category = surfaceCategory(surface.category)
      raw.append(contentsOf: measurementValues(elementId: surface.identifier.uuidString, category: category, width: surface.dimensions.x, height: surface.dimensions.y, depth: nil, confidenceValue: confidence(surface.confidence)))
    }
    if #available(iOS 17.0, *) {
      for floor in room.floors {
        let floorQuality = measurementQuality(confidenceValue: confidence(floor.confidence), value: max(floor.dimensions.x, floor.dimensions.z))
        raw.append(RawMeasurement(elementId: floor.identifier.uuidString, category: "floor", dimension: "width", label: "Floor width", value: floor.dimensions.x, rawValue: nil, confidence: confidence(floor.confidence), quality: floorQuality, valueSource: "roomplan", wallId: nil))
        raw.append(RawMeasurement(elementId: floor.identifier.uuidString, category: "floor", dimension: "depth", label: "Floor length", value: floor.dimensions.z, rawValue: nil, confidence: confidence(floor.confidence), quality: floorQuality, valueSource: "roomplan", wallId: nil))
      }
    }
    for object in room.objects {
      let category = objectCategory(object.category)
      raw.append(contentsOf: measurementValues(elementId: object.identifier.uuidString, category: category, width: object.dimensions.x, height: object.dimensions.y, depth: object.dimensions.z, confidenceValue: confidence(object.confidence)))
    }

    for item in raw {
      let id = "scan-measurement-\(item.elementId)-\(item.dimension)"
      var state = measurementStates[id] ?? MeasurementState(value: item.value, initialEstimate: item.value, updateCount: 0, observationCount: 0, confidence: item.confidence, quality: item.quality, valueSource: item.valueSource, history: [])
      let sourceChanged = state.valueSource != item.valueSource
      let largeCorrection = abs(item.value - state.value) >= max(0.15, state.value * 0.12)
      state.value = state.updateCount == 0 || sourceChanged || largeCorrection ? item.value : state.value * 0.75 + item.value * 0.25
      state.updateCount += 1
      state.observationCount = observationCount
      state.confidence = item.confidence
      state.quality = item.quality
      state.valueSource = item.valueSource
      state.history.append(["timestamp": timestamp, "value": state.value, "rawValue": item.value, "confidence": item.confidence, "quality": item.quality, "valueSource": item.valueSource, "confidenceSource": "derived", "observationCount": observationCount])
      if state.history.count > 20 { state.history.removeFirst() }
      measurementStates[id] = state
    }

    if let wall = room.walls.first, scanUpdateCount == 1 || scanUpdateCount % 12 == 0 {
      logWallDiagnostics(wall, assessment: assessWallHeight(wall, in: room))
    }

    return raw.compactMap { item in
      let id = "scan-measurement-\(item.elementId)-\(item.dimension)"
      guard let state = measurementStates[id] else { return nil }
      return [
        "id": id,
        "elementId": item.elementId,
        "category": item.category,
        "dimension": item.dimension,
        "label": item.label,
        "value": state.value,
        "unit": "m",
        "status": state.quality,
        "initialEstimate": state.initialEstimate,
        "updatedAt": timestamp,
        "updateCount": state.updateCount,
        "observationCount": state.observationCount,
        "confidence": state.confidence,
        "quality": state.quality,
        "rawValue": item.rawValue ?? item.value,
        "valueSource": state.valueSource,
        "confidenceSource": "derived",
        "source": state.valueSource == "roomplan" ? "roomplan" : "derived",
        "history": state.history,
      ]
      .merging(item.wallId.map { ["wallId": $0] } ?? [:]) { current, _ in current }
    }
  }

  private func measurementValues(elementId: String, category: String, width: Float, height: Float, depth: Float?, confidenceValue: Float, qualityOverride: String? = nil, sourceOverride: String = "roomplan", rawHeight: Float? = nil, wallId: String? = nil) -> [RawMeasurement] {
    let quality = qualityOverride ?? measurementQuality(confidenceValue: confidenceValue, value: max(width, height, depth ?? 0))
    var values: [RawMeasurement] = [
      RawMeasurement(elementId: elementId, category: category, dimension: "width", label: category == "wall" ? "Wall length" : "\(category.capitalized) width", value: width, rawValue: nil, confidence: confidenceValue, quality: quality, valueSource: sourceOverride, wallId: wallId),
      RawMeasurement(elementId: elementId, category: category, dimension: "height", label: category == "wall" ? "Wall height" : "\(category.capitalized) height", value: height, rawValue: rawHeight, confidence: confidenceValue, quality: quality, valueSource: sourceOverride, wallId: wallId),
    ]
    if let depth { values.append(RawMeasurement(elementId: elementId, category: category, dimension: "depth", label: "\(category.capitalized) depth", value: depth, rawValue: nil, confidence: confidenceValue, quality: quality, valueSource: sourceOverride, wallId: wallId)) }
    return values
  }

  private func wallDisplayId(for identifier: UUID) -> String {
    let key = identifier.uuidString
    if let existing = wallIds[key] { return existing }
    let assigned = "W\(nextWallNumber)"
    wallIds[key] = assigned
    nextWallNumber += 1
    return assigned
  }

  private func measurementQuality(confidenceValue: Float, value: Float) -> String {
    if confidenceValue < 0.6 || !value.isFinite || value <= 0 { return "limited" }
    return confidenceValue >= 0.9 ? "stable" : "estimating"
  }

  private func logWallDiagnostics(_ wall: CapturedRoom.Surface, assessment: WallHeightAssessment) {
    let wallCenter = position(from: wall.transform)
    let meshBounds = meshStates.values.reduce(into: (minY: Float.greatestFiniteMagnitude, maxY: -Float.greatestFiniteMagnitude)) { result, mesh in
      result.minY = min(result.minY, mesh.worldBoundsMin.y)
      result.maxY = max(result.maxY, mesh.worldBoundsMax.y)
    }
    let displayed = measurementStates["scan-measurement-\(wall.identifier.uuidString)-height"]?.value ?? assessment.value
    NSLog("[RoomScan][WallDiagnostics] id=%@ rawDimensions=(%.3f, %.3f, %.3f)m transformCenter=(%.3f, %.3f, %.3f) rawBoundsY=(%.3f, %.3f) floor=%@ ceiling=%@ meshBoundsY=(%.3f, %.3f) calculated=%.3f displayed=%.3f quality=%@ source=%@", wall.identifier.uuidString, wall.dimensions.x, wall.dimensions.y, wall.dimensions.z, wallCenter.x, wallCenter.y, wallCenter.z, assessment.rawBottom, assessment.rawTop, assessment.floorElevation.map { String(format: "%.3f", $0) } ?? "nil", assessment.ceilingElevation.map { String(format: "%.3f", $0) } ?? "nil", meshBounds.minY.isFinite ? meshBounds.minY : .nan, meshBounds.maxY.isFinite ? meshBounds.maxY : .nan, assessment.value, displayed, assessment.quality, assessment.valueSource)
  }

  private func assessWallHeight(_ wall: CapturedRoom.Surface, in room: CapturedRoom) -> WallHeightAssessment {
    let center = position(from: wall.transform)
    let rawHeight = wall.dimensions.y
    let rawBottom = center.y - rawHeight / 2
    let rawTop = center.y + rawHeight / 2
    let roomPlanFloor = nearestRoomPlanFloorElevation(to: center, in: room)
    let mesh = meshElevations(near: center)
    let floor = roomPlanFloor ?? mesh.floor
    let ceiling = mesh.ceiling

    if let floor, let ceiling {
      let calculatedHeight = ceiling - floor
      // Reject unrelated mesh classifications and impossible spans. This is a
      // guard against using a neighbouring floor/ceiling when the scan contains
      // more than one vertical level.
      if calculatedHeight > 0.5 && calculatedHeight < 12 && abs(center.y - (floor + ceiling) / 2) < max(calculatedHeight, 2.5) {
        let quality = confidence(wall.confidence) >= 0.9 ? "stable" : "estimating"
        return WallHeightAssessment(
          value: calculatedHeight,
          rawRoomPlanValue: rawHeight,
          quality: quality,
          valueSource: roomPlanFloor == nil ? "arkit-mesh" : "floor-ceiling",
          floorElevation: floor,
          ceilingElevation: ceiling,
          rawBottom: rawBottom,
          rawTop: rawTop,
        )
      }
    }

    // RoomPlan's wall box can represent only the observed section while the
    // scan is still in progress. Keep its native value for traceability, but
    // never present it as stable without independent vertical bounds.
    return WallHeightAssessment(
      value: rawHeight,
      rawRoomPlanValue: rawHeight,
      quality: confidence(wall.confidence) < 0.6 ? "limited" : "estimating",
      valueSource: "roomplan",
      floorElevation: floor,
      ceilingElevation: ceiling,
      rawBottom: rawBottom,
      rawTop: rawTop,
    )
  }

  @available(iOS 17.0, *)
  private func roomPlanFloorElevation(to point: SIMD3<Float>, in room: CapturedRoom) -> Float? {
    guard !room.floors.isEmpty else { return nil }
    return room.floors.min { left, right in
      horizontalDistance(from: position(from: left.transform), to: point) < horizontalDistance(from: position(from: right.transform), to: point)
    }.map { position(from: $0.transform).y }
  }

  private func nearestRoomPlanFloorElevation(to point: SIMD3<Float>, in room: CapturedRoom) -> Float? {
    if #available(iOS 17.0, *) {
      return roomPlanFloorElevation(to: point, in: room)
    }
    return nil
  }

  private func meshElevations(near point: SIMD3<Float>) -> (floor: Float?, ceiling: Float?) {
    let nearby = meshStates.values.filter { horizontalDistance(from: position(from: $0.transform), to: point) < 6 }
    let candidates = nearby.isEmpty ? Array(meshStates.values) : nearby
    return (
      median(candidates.compactMap(\.floorElevation)),
      median(candidates.compactMap(\.ceilingElevation))
    )
  }

  private func horizontalDistance(from lhs: SIMD3<Float>, to rhs: SIMD3<Float>) -> Float {
    simd_distance(SIMD2<Float>(lhs.x, lhs.z), SIMD2<Float>(rhs.x, rhs.z))
  }

  private func median(_ values: [Float]) -> Float? {
    let sorted = values.filter(\.isFinite).sorted()
    guard !sorted.isEmpty else { return nil }
    let middle = sorted.count / 2
    if sorted.count % 2 == 0 { return (sorted[middle - 1] + sorted[middle]) / 2 }
    return sorted[middle]
  }

  private func worldPoint(_ point: SIMD3<Float>, transform: simd_float4x4) -> SIMD3<Float> {
    let result = transform * SIMD4<Float>(point.x, point.y, point.z, 1)
    return SIMD3<Float>(result.x, result.y, result.z)
  }

  private func surfaceCategory(_ category: CapturedRoom.Surface.Category) -> String {
    switch category {
    case .wall: return "wall"
    case .opening: return "opening"
    case .window: return "window"
    case .door(let isOpen): return isOpen ? "door-open" : "door-closed"
    case .floor: return "floor"
    @unknown default: return "unknown"
    }
  }

  private func objectCategory(_ category: CapturedRoom.Object.Category) -> String {
    switch category {
    case .storage: return "storage"
    case .refrigerator: return "refrigerator"
    case .stove: return "stove"
    case .bed: return "bed"
    case .sink: return "sink"
    case .washerDryer: return "washer-dryer"
    case .toilet: return "toilet"
    case .bathtub: return "bathtub"
    case .oven: return "oven"
    case .dishwasher: return "dishwasher"
    case .table: return "table"
    case .sofa: return "sofa"
    case .chair: return "chair"
    case .fireplace: return "fireplace"
    case .television: return "television"
    case .stairs: return "stairs"
    @unknown default: return "unknown"
    }
  }

  private func confidence(_ confidence: CapturedRoom.Confidence) -> Float {
    switch confidence {
    case .high: return 0.95
    case .medium: return 0.7
    case .low: return 0.4
    @unknown default: return 0
    }
  }

  private func position(from matrix: simd_float4x4) -> SIMD3<Float> {
    SIMD3<Float>(matrix.columns.3.x, matrix.columns.3.y, matrix.columns.3.z)
  }

  private func transform(from matrix: simd_float4x4) -> [String: Any] {
    let position = position(from: matrix)
    // Keep the complete rigid transform. The previous implementation reduced
    // RoomPlan's matrix to a hand-derived yaw, which inverted SceneKit's yaw
    // convention and discarded pitch/roll. Reconstructing rooms from that
    // lossy representation made walls and features appear skewed in the saved
    // 3D viewer and made room alignment unreliable.
    let rotationNode = SCNNode()
    rotationNode.simdTransform = matrix
    let eulerAngles = rotationNode.eulerAngles
    return [
      "position": vector(position),
      "rotation": ["pitch": eulerAngles.x, "yaw": eulerAngles.y, "roll": eulerAngles.z],
      "scale": ["x": 1, "y": 1, "z": 1],
      "matrix": [
        matrix.columns.0.x, matrix.columns.1.x, matrix.columns.2.x, matrix.columns.3.x,
        matrix.columns.0.y, matrix.columns.1.y, matrix.columns.2.y, matrix.columns.3.y,
        matrix.columns.0.z, matrix.columns.1.z, matrix.columns.2.z, matrix.columns.3.z,
        matrix.columns.0.w, matrix.columns.1.w, matrix.columns.2.w, matrix.columns.3.w,
      ],
    ]
  }

  private func vector(_ value: SIMD3<Float>) -> [String: Float] {
    ["x": value.x, "y": value.y, "z": value.z]
  }

  private func dimensions(width: Float, height: Float, depth: Float) -> [String: Any] {
    ["width": width, "height": height, "depth": depth, "unit": "m"]
  }

  private func footprint(from room: CapturedRoom) -> SIMD2<Float>? {
    let points = room.walls.flatMap { wall -> [SIMD2<Float>] in
      let center = position(from: wall.transform)
      let halfWidth = wall.dimensions.x / 2
      return [SIMD2(center.x - halfWidth, center.z - wall.dimensions.z / 2), SIMD2(center.x + halfWidth, center.z + wall.dimensions.z / 2)]
    }
    guard let first = points.first else { return nil }
    let minX = points.dropFirst().reduce(first.x) { min($0, $1.x) }
    let maxX = points.dropFirst().reduce(first.x) { max($0, $1.x) }
    let minZ = points.dropFirst().reduce(first.y) { min($0, $1.y) }
    let maxZ = points.dropFirst().reduce(first.y) { max($0, $1.y) }
    return SIMD2(maxX - minX, maxZ - minZ)
  }

  private func emit(kind: String, message: String, progress: Float? = nil, scan: [String: Any]? = nil, measurements: [[String: Any]]? = nil) {
    var body: [String: Any] = ["kind": kind, "message": message]
    if let progress { body["progress"] = progress }
    if let scan { body["scan"] = scan }
    if let measurements { body["measurements"] = measurements }
    onRoomScanUpdate?(body)
  }
}
