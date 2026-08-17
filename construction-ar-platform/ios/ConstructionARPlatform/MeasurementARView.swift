import ARKit
import Foundation
import React
import SceneKit
import simd

@objcMembers
final class MeasurementARView: UIView, ARSCNViewDelegate, ARSessionDelegate {
  private struct TrackingSnapshot {
    let quality: String
    let reason: String?
    let localizedState: String?

    func toDictionary() -> [String: Any] {
      [
        "quality": quality,
        "reason": reason as Any,
        "localizedState": localizedState as Any,
      ]
    }
  }

  private struct RaycastTarget {
    let point: SIMD3<Float>
    let source: String
    let planeAlignment: String
    let usedFallback: Bool
    let tracking: TrackingSnapshot
    let reticleState: String
    let message: String
  }

  private struct CapturedEndpoint {
    let point: SIMD3<Float>
    let source: String
    let planeAlignment: String
    let usedFallback: Bool
    let tracking: TrackingSnapshot
    let capturedAt: String
    let diagnostics: [String: Any]

    func toResolutionDictionary() -> [String: Any] {
      [
        "source": source,
        "planeAlignment": planeAlignment,
        "usedFallback": usedFallback,
        "tracking": tracking.toDictionary(),
        "capturedAt": capturedAt,
        "resolutionDiagnostics": diagnostics,
      ]
    }
  }

  private struct PendingCapture {
    let role: String
    let startedAt: Date
    var acceptedSamples: [RaycastTarget]
    var rejectedSampleCount: Int
  }

  @objc var onMeasurementUpdate: RCTBubblingEventBlock?

  @objc var resetCounter: NSNumber = 0 {
    didSet {
      guard resetCounter != oldValue else { return }
      clearMeasurement(message: "Measurement cleared. Aim at Point A to begin a new measurement.")
    }
  }

  @objc var captureRequestId: NSNumber = 0 {
    didSet {
      guard captureRequestId != oldValue else { return }
      beginCapture()
    }
  }

  @objc var capturePointRole: NSString = "start"

  private let sceneView = ARSCNView(frame: .zero)
  private let timestampFormatter = ISO8601DateFormatter()

  private var currentTracking = TrackingSnapshot(
    quality: "not-available",
    reason: "session-not-started",
    localizedState: "not-available"
  )
  private var latestReticleTarget: RaycastTarget?
  private var pendingCapture: PendingCapture?
  private var startEndpoint: CapturedEndpoint?
  private var endEndpoint: CapturedEndpoint?
  private var startNode: SCNNode?
  private var endNode: SCNNode?
  private var lineNode: SCNNode?
  private var lastReticleSignature = ""
  private var lastTrackingSignature = ""
  private var lastTelemetryAt = Date.distantPast

  override init(frame: CGRect) {
    super.init(frame: frame)
    configureSceneView()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    configureSceneView()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    sceneView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()

    if window == nil {
      sceneView.session.pause()
      return
    }

    startSession()
  }

  private func configureSceneView() {
    sceneView.frame = bounds
    sceneView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    sceneView.delegate = self
    sceneView.session.delegate = self
    sceneView.autoenablesDefaultLighting = true
    sceneView.automaticallyUpdatesLighting = true
    sceneView.scene = SCNScene()
    addSubview(sceneView)
  }

  private func startSession() {
    guard ARWorldTrackingConfiguration.isSupported else {
      emitUpdate(
        action: [
          "kind": "session-unsupported",
          "message": "AR measurement is unavailable on this device."
        ]
      )
      return
    }

    let configuration = ARWorldTrackingConfiguration()
    configuration.planeDetection = [.horizontal, .vertical]
    configuration.environmentTexturing = .automatic

    if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      configuration.frameSemantics.insert(.sceneDepth)
    }

    if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      configuration.sceneReconstruction = .mesh
    }

    sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])

    emitUpdate(
      action: [
        "kind": "session-started",
        "message": "AR session started. Aim at a tracked surface to capture Point A."
      ]
    )
  }

  private func beginCapture() {
    guard pendingCapture == nil else { return }

    guard latestReticleTarget != nil else {
      emitUpdate(
        action: [
          "kind": "capture-failed",
          "pointRole": capturePointRole,
          "message": "No defensible spatial target is available at the reticle."
        ]
      )
      return
    }

    pendingCapture = PendingCapture(
      role: capturePointRole as String,
      startedAt: Date(),
      acceptedSamples: [],
      rejectedSampleCount: 0
    )
  }

  private func clearMeasurement(message: String) {
    pendingCapture = nil
    startEndpoint = nil
    endEndpoint = nil
    removeNode(&startNode)
    removeNode(&endNode)
    removeNode(&lineNode)

    emitUpdate(
      action: [
        "kind": "measurement-cleared",
        "message": message
      ]
    )
  }

  func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    currentTracking = trackingSnapshot(from: camera.trackingState)
  }

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    currentTracking = trackingSnapshot(from: frame.camera.trackingState)
    latestReticleTarget = resolveCenterTarget(frame: frame)
    processPendingCapture(with: frame)
    emitTrackingUpdateIfNeeded()
  }

  private func processPendingCapture(with frame: ARFrame) {
    guard var pendingCapture else { return }

    if let target = resolveCenterTarget(frame: frame), target.reticleState != "red" {
      pendingCapture.acceptedSamples.append(target)
    } else {
      pendingCapture.rejectedSampleCount += 1
    }

    let elapsed = Date().timeIntervalSince(pendingCapture.startedAt)
    if pendingCapture.acceptedSamples.count >= 5 || elapsed >= 0.25 {
      finalizeCapture(pendingCapture)
      self.pendingCapture = nil
    } else {
      self.pendingCapture = pendingCapture
    }
  }

  private func finalizeCapture(_ pendingCapture: PendingCapture) {
    guard !pendingCapture.acceptedSamples.isEmpty else {
      emitUpdate(
        action: [
          "kind": "capture-failed",
          "pointRole": pendingCapture.role,
          "message": "Capture failed because the reticle target was not stable enough."
        ]
      )
      return
    }

    let sourceCounts = Dictionary(grouping: pendingCapture.acceptedSamples, by: \.source)
      .mapValues(\.count)

    let prioritizedSource = sourceCounts.keys.sorted {
      sourcePriority($0) == sourcePriority($1)
        ? (sourceCounts[$0] ?? 0) > (sourceCounts[$1] ?? 0)
        : sourcePriority($0) > sourcePriority($1)
    }.first ?? pendingCapture.acceptedSamples[0].source

    let sameSourceSamples = pendingCapture.acceptedSamples.filter { $0.source == prioritizedSource }
    let baselinePoint = medianPoint(of: sameSourceSamples.map(\.point))

    let deviations = sameSourceSamples.map { simd_length($0.point - baselinePoint) }
    let acceptedPairs = zip(sameSourceSamples, deviations).filter { $0.1 <= 0.03 }
    let acceptedSamples = acceptedPairs.isEmpty ? sameSourceSamples : acceptedPairs.map(\.0)
    let finalPoint = averagePoint(of: acceptedSamples.map(\.point))
    let maximumDeviation = deviations.max() ?? 0
    let representative = acceptedSamples[0]
    let capturedAt = timestampFormatter.string(from: Date())

    let diagnostics: [String: Any] = [
      "sampleCountCollected": pendingCapture.acceptedSamples.count,
      "acceptedSampleCount": acceptedSamples.count,
      "rejectedSampleCount": pendingCapture.rejectedSampleCount
        + max(0, sameSourceSamples.count - acceptedSamples.count),
      "maximumDeviationMeters": maximumDeviation,
      "sourceCounts": sourceCounts,
      "reticleState": representative.reticleState
    ]

    let endpoint = CapturedEndpoint(
      point: finalPoint,
      source: representative.source,
      planeAlignment: representative.planeAlignment,
      usedFallback: representative.usedFallback,
      tracking: representative.tracking,
      capturedAt: capturedAt,
      diagnostics: diagnostics
    )

    if pendingCapture.role == "start" {
      startEndpoint = endpoint
      endEndpoint = nil
      removeNode(&endNode)
      removeNode(&lineNode)
      startNode = makeMarkerNode(color: UIColor.systemGreen, point: endpoint.point)
      if let startNode {
        sceneView.scene.rootNode.addChildNode(startNode)
      }
    } else {
      endEndpoint = endpoint
      endNode = makeMarkerNode(color: UIColor.systemOrange, point: endpoint.point)
      if let endNode {
        sceneView.scene.rootNode.addChildNode(endNode)
      }
      rebuildMeasurementLine()
    }

    emitUpdate(
      action: [
        "kind": "point-set",
        "pointRole": pendingCapture.role,
        "message": pendingCapture.role == "start"
          ? "Point A captured. Aim at Point B and capture again."
          : "Measurement captured."
      ]
    )
  }

  private func emitTrackingUpdateIfNeeded() {
    let reticle = reticlePayload()
    let reticleSignature = [
      reticle["state"] as? String ?? "red",
      reticle["source"] as? String ?? "unresolved",
      currentTracking.quality,
      currentTracking.reason ?? ""
    ].joined(separator: "|")

    let now = Date()
    if reticleSignature == lastReticleSignature,
       currentTracking.quality == lastTrackingSignature,
       now.timeIntervalSince(lastTelemetryAt) < 0.2 {
      return
    }

    lastReticleSignature = reticleSignature
    lastTrackingSignature = currentTracking.quality
    lastTelemetryAt = now

    emitUpdate(
      action: [
        "kind": "tracking-updated",
        "message": reticle["message"] as? String ?? "Tracking updated."
      ]
    )
  }

  private func emitUpdate(action: [String: Any]) {
    guard let onMeasurementUpdate else { return }

    var payload: [String: Any] = [
      "tracking": currentTracking.toDictionary(),
      "reticle": reticlePayload(),
      "lastAction": action
    ]

    if let measurement = measurementPayload() {
      payload["measurement"] = measurement
    }

    onMeasurementUpdate(payload)
  }

  private func measurementPayload() -> [String: Any]? {
    guard let startEndpoint else { return nil }

    var payload: [String: Any] = [
      "startPoint": pointDictionary(startEndpoint.point),
      "startResolution": startEndpoint.toResolutionDictionary()
    ]

    if let endEndpoint {
      payload["endPoint"] = pointDictionary(endEndpoint.point)
      payload["endResolution"] = endEndpoint.toResolutionDictionary()
      payload["rawDistanceMeters"] = NSNumber(
        value: simd_length(endEndpoint.point - startEndpoint.point)
      )
    }

    return payload
  }

  private func reticlePayload() -> [String: Any] {
    guard let target = latestReticleTarget else {
      return [
        "state": "red",
        "message": "Aim at a tracked real-world surface to capture a point.",
        "tracking": currentTracking.toDictionary()
      ]
    }

    return [
      "state": target.reticleState,
      "message": target.message,
      "tracking": target.tracking.toDictionary(),
      "point": pointDictionary(target.point),
      "source": target.source,
      "planeAlignment": target.planeAlignment,
      "usedFallback": target.usedFallback
    ]
  }

  private func resolveCenterTarget(frame: ARFrame) -> RaycastTarget? {
    let center = CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)

    if let geometryQuery = sceneView.raycastQuery(
      from: center,
      allowing: .existingPlaneGeometry,
      alignment: .any
    ),
      let result = sceneView.session.raycast(geometryQuery).first {
      return makeRaycastTarget(
        from: result,
        source: "existing-plane-geometry",
        usedFallback: false,
        tracking: trackingSnapshot(from: frame.camera.trackingState)
      )
    }

    if let infiniteQuery = sceneView.raycastQuery(
      from: center,
      allowing: .existingPlaneInfinite,
      alignment: .any
    ),
      let result = sceneView.session.raycast(infiniteQuery).first {
      return makeRaycastTarget(
        from: result,
        source: "existing-plane-infinite",
        usedFallback: true,
        tracking: trackingSnapshot(from: frame.camera.trackingState)
      )
    }

    if let estimatedQuery = sceneView.raycastQuery(
      from: center,
      allowing: .estimatedPlane,
      alignment: .any
    ),
      let result = sceneView.session.raycast(estimatedQuery).first {
      return makeRaycastTarget(
        from: result,
        source: "estimated-plane",
        usedFallback: true,
        tracking: trackingSnapshot(from: frame.camera.trackingState)
      )
    }

    if let featurePointResult = sceneView.hitTest(center, types: [.featurePoint]).first {
      let point = SIMD3<Float>(
        featurePointResult.worldTransform.columns.3.x,
        featurePointResult.worldTransform.columns.3.y,
        featurePointResult.worldTransform.columns.3.z
      )

      let tracking = trackingSnapshot(from: frame.camera.trackingState)
      return RaycastTarget(
        point: point,
        source: "feature-point",
        planeAlignment: "unknown",
        usedFallback: true,
        tracking: tracking,
        reticleState: tracking.quality == "normal" ? "yellow" : "red",
        message: tracking.quality == "normal"
          ? "Reticle is using a lower-confidence feature point target."
          : "Feature points are visible, but tracking is limited."
      )
    }

    return nil
  }

  private func makeRaycastTarget(
    from result: ARRaycastResult,
    source: String,
    usedFallback: Bool,
    tracking: TrackingSnapshot
  ) -> RaycastTarget {
    let point = SIMD3<Float>(
      result.worldTransform.columns.3.x,
      result.worldTransform.columns.3.y,
      result.worldTransform.columns.3.z
    )
    let planeAlignment = planeAlignmentString(from: result)
    let reticleState =
      source == "existing-plane-geometry" && tracking.quality == "normal" ? "green" : "yellow"

    let message: String
    switch reticleState {
    case "green":
      message = "Reticle locked to existing plane geometry."
    case "yellow":
      message = usedFallback
        ? "Reticle is using a lower-confidence fallback target."
        : "Reticle is usable, but target quality is lower than ideal."
    default:
      message = "No defensible spatial target is available at the reticle."
    }

    return RaycastTarget(
      point: point,
      source: source,
      planeAlignment: planeAlignment,
      usedFallback: usedFallback,
      tracking: tracking,
      reticleState: reticleState,
      message: message
    )
  }

  private func trackingSnapshot(from state: ARCamera.TrackingState) -> TrackingSnapshot {
    switch state {
    case .normal:
      return TrackingSnapshot(quality: "normal", reason: nil, localizedState: "normal")
    case .notAvailable:
      return TrackingSnapshot(
        quality: "not-available",
        reason: "not-available",
        localizedState: "not-available"
      )
    case let .limited(reason):
      return TrackingSnapshot(
        quality: "limited",
        reason: trackingReasonString(reason),
        localizedState: trackingReasonString(reason)
      )
    @unknown default:
      return TrackingSnapshot(
        quality: "limited",
        reason: "unknown",
        localizedState: "unknown"
      )
    }
  }

  private func trackingReasonString(_ reason: ARCamera.TrackingState.Reason) -> String {
    switch reason {
    case .initializing:
      return "initializing"
    case .excessiveMotion:
      return "excessive-motion"
    case .insufficientFeatures:
      return "insufficient-features"
    case .relocalizing:
      return "relocalizing"
    @unknown default:
      return "unknown"
    }
  }

  private func planeAlignmentString(from result: ARRaycastResult) -> String {
    if let planeAnchor = result.anchor as? ARPlaneAnchor {
      switch planeAnchor.alignment {
      case .horizontal:
        return "horizontal"
      case .vertical:
        return "vertical"
      @unknown default:
        return "unknown"
      }
    }

    switch result.targetAlignment {
    case .horizontal:
      return "horizontal"
    case .vertical:
      return "vertical"
    case .any:
      return "slanted"
    @unknown default:
      return "unknown"
    }
  }

  private func sourcePriority(_ source: String) -> Int {
    switch source {
    case "existing-plane-geometry":
      return 4
    case "existing-plane-infinite":
      return 3
    case "estimated-plane":
      return 2
    case "feature-point":
      return 1
    default:
      return 0
    }
  }

  private func pointDictionary(_ point: SIMD3<Float>) -> [String: Any] {
    [
      "x": NSNumber(value: point.x),
      "y": NSNumber(value: point.y),
      "z": NSNumber(value: point.z)
    ]
  }

  private func medianPoint(of points: [SIMD3<Float>]) -> SIMD3<Float> {
    SIMD3<Float>(
      median(points.map(\.x)),
      median(points.map(\.y)),
      median(points.map(\.z))
    )
  }

  private func averagePoint(of points: [SIMD3<Float>]) -> SIMD3<Float> {
    guard !points.isEmpty else { return SIMD3<Float>(0, 0, 0) }
    let sum = points.reduce(SIMD3<Float>(0, 0, 0), +)
    return sum / Float(points.count)
  }

  private func median(_ values: [Float]) -> Float {
    let sorted = values.sorted()
    let middle = sorted.count / 2

    if sorted.count % 2 == 0 {
      return (sorted[middle - 1] + sorted[middle]) / 2
    }

    return sorted[middle]
  }

  private func makeMarkerNode(color: UIColor, point: SIMD3<Float>) -> SCNNode {
    let geometry = SCNSphere(radius: 0.01)
    geometry.firstMaterial?.diffuse.contents = color
    let node = SCNNode(geometry: geometry)
    node.simdPosition = point
    return node
  }

  private func rebuildMeasurementLine() {
    removeNode(&lineNode)

    guard let startEndpoint, let endEndpoint else { return }

    let line = lineNodeBetween(start: startEndpoint.point, end: endEndpoint.point)
    sceneView.scene.rootNode.addChildNode(line)
    lineNode = line
  }

  private func lineNodeBetween(start: SIMD3<Float>, end: SIMD3<Float>) -> SCNNode {
    let startVector = SCNVector3(start.x, start.y, start.z)
    let endVector = SCNVector3(end.x, end.y, end.z)
    let vertices = [startVector, endVector]
    let source = SCNGeometrySource(vertices: vertices)
    let element = SCNGeometryElement(indices: [UInt32(0), UInt32(1)], primitiveType: .line)
    let geometry = SCNGeometry(sources: [source], elements: [element])
    geometry.firstMaterial?.diffuse.contents = UIColor.white
    return SCNNode(geometry: geometry)
  }

  private func removeNode(_ node: inout SCNNode?) {
    node?.removeFromParentNode()
    node = nil
  }
}
