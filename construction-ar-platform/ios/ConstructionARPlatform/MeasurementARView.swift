import ARKit
import Foundation
import React
import SceneKit
import Vision
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
    let depthMeters: Float?
    let depthConfidence: Int?
    let frameTimestamp: TimeInterval
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

  private let endpointMinimumSamples = 12
  private let endpointPreferredSamples = 24
  private let endpointMaximumDuration: TimeInterval = 0.7
  private let endpointMaximumSpreadMeters: Float = 0.025
  private let depthNeighborhoodRadius = 2

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

  @objc var placementRequest: NSDictionary? {
    didSet {
      handlePlacementRequest(placementRequest)
    }
  }

  @objc var placedObjects: NSArray? {
    didSet {
      syncPlacedObjects(placedObjects)
    }
  }

  @objc var selectedPlacedObjectId: NSString? {
    didSet {
      updatePlacementSelection()
    }
  }

  @objc var placementEditRequest: NSDictionary? {
    didSet {
      handlePlacementEditRequest(placementEditRequest)
    }
  }

  private let sceneView = ARSCNView(frame: .zero)
  private let timestampFormatter = ISO8601DateFormatter()

  private var currentTracking = TrackingSnapshot(
    quality: "not-available",
    reason: "session-not-started",
    localizedState: "not-available"
  )
  private var latestReticleTarget: RaycastTarget?
  private var placementNodesById: [String: SCNNode] = [:]
  private var placementSnapshotsById: [String: [String: Any]] = [:]
  private var lastPlacementRequestId: Int = 0
  private var lastPlacementEditRequestId: Int = 0
  private var pendingCapture: PendingCapture?
  private var startEndpoint: CapturedEndpoint?
  private var endEndpoint: CapturedEndpoint?
  private var startNode: SCNNode?
  private var endNode: SCNNode?
  private var lineNode: SCNNode?
  private var lastReticleSignature = ""
  private var lastTrackingSignature = ""
  private var lastTelemetryAt = Date.distantPast
  private var lastFurnitureClassificationAt = Date.distantPast
  private var latestFurnitureIdentification: [String: Any]?

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
    let tapRecognizer = UITapGestureRecognizer(target: self, action: #selector(handleSceneTap(_:)))
    sceneView.addGestureRecognizer(tapRecognizer)
    addSubview(sceneView)
  }

  @objc private func handleSceneTap(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    let location = recognizer.location(in: sceneView)
    guard let hitNode = sceneView.hitTest(location, options: nil).first?.node else { return }

    var node: SCNNode? = hitNode
    while let candidate = node {
      if let objectId = candidate.name, placementNodesById[objectId] != nil {
        selectedPlacedObjectId = objectId as NSString
        let displayName = placementSnapshotsById[objectId]?["displayName"] as? String ?? "Object"
        emitPlacement(kind: "object-selected", message: "\(displayName) selected.", objectId: objectId)
        return
      }
      node = candidate.parent
    }
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

    if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
      configuration.frameSemantics.insert(.smoothedSceneDepth)
    } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
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
    latestReticleTarget = resolveDepthNeighborhoodTarget(frame: frame) ?? resolveCenterTarget(frame: frame)
    classifyFurnitureIfNeeded(frame: frame)
    processPendingCapture(with: frame)
    emitTrackingUpdateIfNeeded()
  }

  private func processPendingCapture(with frame: ARFrame) {
    guard var pendingCapture else { return }

    if currentTracking.quality != "normal" {
      pendingCapture.rejectedSampleCount += 1
    } else if let target = resolveDepthNeighborhoodTarget(frame: frame) ?? resolveCenterTarget(frame: frame),
       target.reticleState != "red" {
      pendingCapture.acceptedSamples.append(target)
    } else {
      pendingCapture.rejectedSampleCount += 1
    }

    let elapsed = Date().timeIntervalSince(pendingCapture.startedAt)
    if pendingCapture.acceptedSamples.count >= endpointPreferredSamples
      || (pendingCapture.acceptedSamples.count >= endpointMinimumSamples && elapsed >= 0.35)
      || elapsed >= endpointMaximumDuration {
      if pendingCapture.acceptedSamples.count >= endpointMinimumSamples {
        finalizeCapture(pendingCapture)
        self.pendingCapture = nil
      } else if elapsed >= endpointMaximumDuration {
        emitUpdate(
          action: [
            "kind": "capture-failed",
            "pointRole": pendingCapture.role,
            "message": "Capture failed because too few reliable spatial samples were collected. Hold steady and rescan."
          ]
        )
        self.pendingCapture = nil
      } else {
        self.pendingCapture = pendingCapture
      }
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
    let acceptedPairs = zip(sameSourceSamples, deviations).filter { $0.1 <= endpointMaximumSpreadMeters }
    let acceptedSamples = acceptedPairs.isEmpty ? sameSourceSamples : acceptedPairs.map(\.0)
    let finalPoint = averagePoint(of: acceptedSamples.map(\.point))
    let acceptedDeviations = acceptedSamples.map { simd_length($0.point - finalPoint) }
    let maximumDeviation = acceptedDeviations.max() ?? deviations.max() ?? 0
    let medianDeviation = median(acceptedDeviations)
    let representative = acceptedSamples[0]
    let capturedAt = timestampFormatter.string(from: Date())

    guard acceptedSamples.count >= endpointMinimumSamples,
      maximumDeviation <= endpointMaximumSpreadMeters else {
      emitUpdate(
        action: [
          "kind": "capture-failed",
          "pointRole": pendingCapture.role,
          "message": "Capture failed because endpoint samples were not stable enough. Hold steady and rescan."
        ]
      )
      return
    }

    let highConfidenceDepthCount = acceptedSamples.filter { ($0.depthConfidence ?? -1) >= 2 }.count
    let firstTimestamp = acceptedSamples.map(\.frameTimestamp).min() ?? 0
    let lastTimestamp = acceptedSamples.map(\.frameTimestamp).max() ?? firstTimestamp

    var diagnostics: [String: Any] = [
      "sampleCountCollected": pendingCapture.acceptedSamples.count,
      "acceptedSampleCount": acceptedSamples.count,
      "rejectedSampleCount": pendingCapture.rejectedSampleCount
        + max(0, sameSourceSamples.count - acceptedSamples.count),
      "maximumDeviationMeters": maximumDeviation,
      "medianDeviationMeters": medianDeviation,
      "highConfidenceDepthSampleCount": highConfidenceDepthCount,
      "sampleWindowSeconds": max(0, lastTimestamp - firstTimestamp),
      "sourceCounts": sourceCounts,
      "reticleState": representative.reticleState
    ]
    if let depthConfidence = representative.depthConfidence {
      diagnostics["depthConfidence"] = depthConfidence
    }
    if let depthMeters = representative.depthMeters {
      diagnostics["depthMeters"] = depthMeters
    }

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
    if let latestFurnitureIdentification {
      payload["furnitureIdentification"] = latestFurnitureIdentification
    }

    onMeasurementUpdate(payload)
  }

  private func classifyFurnitureIfNeeded(frame: ARFrame) {
    let now = Date()
    guard now.timeIntervalSince(lastFurnitureClassificationAt) >= 1.2 else { return }
    lastFurnitureClassificationAt = now

    let request = VNClassifyImageRequest { [weak self] request, _ in
      guard let self,
            let observations = request.results as? [VNClassificationObservation] else { return }
      let furnitureKeywords = ["chair", "couch", "sofa", "table", "bed", "desk", "cabinet", "shelf", "dresser", "bench"]
      guard let match = observations.first(where: { observation in
        furnitureKeywords.contains(where: { observation.identifier.lowercased().contains($0) })
      }) else { return }
      self.latestFurnitureIdentification = [
        "label": match.identifier,
        "confidence": match.confidence,
        "capturedAt": self.timestampFormatter.string(from: Date())
      ]
    }

    let handler = VNImageRequestHandler(cvPixelBuffer: frame.capturedImage, orientation: .right)
    try? handler.perform([request])
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
        : "Feature points are visible, but tracking is limited.",
      depthMeters: nil,
      depthConfidence: nil,
      frameTimestamp: frame.timestamp
    )
  }

    return nil
  }

  private func resolveDepthNeighborhoodTarget(frame: ARFrame) -> RaycastTarget? {
    guard let sceneDepth = frame.smoothedSceneDepth ?? frame.sceneDepth else {
      return nil
    }

    let center = CGPoint(x: sceneView.bounds.midX, y: sceneView.bounds.midY)
    guard let depthPixel = depthPixelPoint(for: center, frame: frame, depthMap: sceneDepth.depthMap) else {
      return nil
    }

    let depthMap = sceneDepth.depthMap
    let confidenceMap = sceneDepth.confidenceMap
    CVPixelBufferLockBaseAddress(depthMap, .readOnly)
    if let confidenceMap {
      CVPixelBufferLockBaseAddress(confidenceMap, .readOnly)
    }
    defer {
      CVPixelBufferUnlockBaseAddress(depthMap, .readOnly)
      if let confidenceMap {
        CVPixelBufferUnlockBaseAddress(confidenceMap, .readOnly)
      }
    }

    guard let depthBaseAddress = CVPixelBufferGetBaseAddress(depthMap) else {
      return nil
    }

    let width = CVPixelBufferGetWidth(depthMap)
    let height = CVPixelBufferGetHeight(depthMap)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(depthMap)
    let depthPointer = depthBaseAddress.assumingMemoryBound(to: Float32.self)
    let confidencePointer: UnsafeMutablePointer<UInt8>?
    let confidenceBytesPerRow: Int?
    if let confidenceMap {
      confidencePointer = CVPixelBufferGetBaseAddress(confidenceMap)?.assumingMemoryBound(to: UInt8.self)
      confidenceBytesPerRow = CVPixelBufferGetBytesPerRow(confidenceMap)
    } else {
      confidencePointer = nil
      confidenceBytesPerRow = nil
    }

    var worldPoints: [SIMD3<Float>] = []
    var depths: [Float] = []
    var confidenceValues: [Int] = []

    let centerX = Int(round(depthPixel.x))
    let centerY = Int(round(depthPixel.y))
    let minX = max(0, centerX - depthNeighborhoodRadius)
    let maxX = min(width - 1, centerX + depthNeighborhoodRadius)
    let minY = max(0, centerY - depthNeighborhoodRadius)
    let maxY = min(height - 1, centerY + depthNeighborhoodRadius)

    for y in minY...maxY {
      for x in minX...maxX {
        let depthIndex = y * (bytesPerRow / MemoryLayout<Float32>.size) + x
        let depth = depthPointer[depthIndex]
        guard depth.isFinite, depth > 0.05, depth < 8 else {
          continue
        }

        let confidence: Int
        if let confidencePointer, let confidenceBytesPerRow {
          let confidenceIndex = y * confidenceBytesPerRow + x
          confidence = Int(confidencePointer[confidenceIndex])
          guard confidence >= Int(ARConfidenceLevel.medium.rawValue) else {
            continue
          }
        } else {
          confidence = Int(ARConfidenceLevel.medium.rawValue)
        }

        let point = worldPointFromDepthPixel(
          x: Float(x),
          y: Float(y),
          depth: depth,
          depthMapSize: CGSize(width: width, height: height),
          frame: frame
        )
        worldPoints.append(point)
        depths.append(depth)
        confidenceValues.append(confidence)
      }
    }

    guard worldPoints.count >= 5 else {
      return nil
    }

    let baselinePoint = medianPoint(of: worldPoints)
    let deviations = worldPoints.map { simd_length($0 - baselinePoint) }
    let acceptedPairs = zip(worldPoints, deviations).filter { $0.1 <= endpointMaximumSpreadMeters }
    let acceptedPoints = acceptedPairs.isEmpty ? worldPoints : acceptedPairs.map(\.0)
    guard acceptedPoints.count >= 5 else {
      return nil
    }

    let finalPoint = medianPoint(of: acceptedPoints)
    let medianDepth = median(depths)
    let highConfidenceCount = confidenceValues.filter { $0 >= Int(ARConfidenceLevel.high.rawValue) }.count
    let representativeConfidence = highConfidenceCount >= max(1, confidenceValues.count / 2)
      ? Int(ARConfidenceLevel.high.rawValue)
      : Int(ARConfidenceLevel.medium.rawValue)
    let tracking = trackingSnapshot(from: frame.camera.trackingState)

    return RaycastTarget(
      point: finalPoint,
      source: "scene-depth",
      planeAlignment: "unknown",
      usedFallback: false,
      tracking: tracking,
      reticleState: tracking.quality == "normal" ? "green" : "red",
      message: "Reticle locked to stabilized LiDAR scene depth.",
      depthMeters: medianDepth,
      depthConfidence: representativeConfidence,
      frameTimestamp: frame.timestamp
    )
  }

  private func depthPixelPoint(for viewPoint: CGPoint, frame: ARFrame, depthMap: CVPixelBuffer) -> CGPoint? {
    guard sceneView.bounds.width > 0, sceneView.bounds.height > 0 else {
      return nil
    }

    let orientation = window?.windowScene?.interfaceOrientation ?? .portrait
    let normalizedViewPoint = CGPoint(
      x: viewPoint.x / sceneView.bounds.width,
      y: viewPoint.y / sceneView.bounds.height
    )
    let displayTransform = frame.displayTransform(for: orientation, viewportSize: sceneView.bounds.size)
    let imagePoint = normalizedViewPoint.applying(displayTransform.inverted())

    guard imagePoint.x.isFinite, imagePoint.y.isFinite else {
      return nil
    }

    let width = CGFloat(CVPixelBufferGetWidth(depthMap))
    let height = CGFloat(CVPixelBufferGetHeight(depthMap))
    return CGPoint(
      x: min(max(imagePoint.x * width, 0), width - 1),
      y: min(max(imagePoint.y * height, 0), height - 1)
    )
  }

  private func worldPointFromDepthPixel(
    x: Float,
    y: Float,
    depth: Float,
    depthMapSize: CGSize,
    frame: ARFrame
  ) -> SIMD3<Float> {
    let imageResolution = frame.camera.imageResolution
    var intrinsics = frame.camera.intrinsics
    intrinsics.columns.0.x *= Float(depthMapSize.width / imageResolution.width)
    intrinsics.columns.1.y *= Float(depthMapSize.height / imageResolution.height)
    intrinsics.columns.2.x *= Float(depthMapSize.width / imageResolution.width)
    intrinsics.columns.2.y *= Float(depthMapSize.height / imageResolution.height)

    let cameraX = (x - intrinsics.columns.2.x) * depth / intrinsics.columns.0.x
    let cameraY = -(y - intrinsics.columns.2.y) * depth / intrinsics.columns.1.y
    let cameraPoint = SIMD4<Float>(cameraX, cameraY, -depth, 1)
    let worldPoint = frame.camera.transform * cameraPoint
    return SIMD3<Float>(worldPoint.x, worldPoint.y, worldPoint.z)
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
      message: message,
      depthMeters: nil,
      depthConfidence: nil,
      frameTimestamp: sceneView.session.currentFrame?.timestamp ?? 0
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
    case "scene-depth":
      return 5
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

  private func handlePlacementRequest(_ request: NSDictionary?) {
    guard let request else { return }
    guard let requestId = numberValue(request["requestId"])?.intValue else { return }
    guard requestId != lastPlacementRequestId else { return }
    lastPlacementRequestId = requestId

    guard let target = latestReticleTarget else {
      emitPlacement(kind: "placement-failed", message: "Aim at a tracked surface before placing an object.")
      return
    }

    guard let catalogObjectId = request["catalogObjectId"] as? String,
          let displayName = request["displayName"] as? String,
          let placementMode = request["placementMode"] as? String,
          let dimensions = request["dimensions"] as? NSDictionary else {
      emitPlacement(kind: "placement-failed", message: "The selected catalog object is missing placement metadata.")
      return
    }

    let id = "placement-\(requestId)-\(Int(Date().timeIntervalSince1970 * 1000))"
    let snapshot = placementSnapshot(
      id: id,
      catalogObjectId: catalogObjectId,
      displayName: displayName,
      placementMode: placementMode,
      dimensions: dimensions,
      point: target.point,
      rotationY: 0,
      representation: request["representation"] as? String
    )

    upsertPlacementNode(snapshot)
    selectedPlacedObjectId = id as NSString
    updatePlacementSelection()
    emitPlacement(kind: "object-placed", message: "\(displayName) placed in the AR scene.", object: snapshot)
  }

  private func handlePlacementEditRequest(_ request: NSDictionary?) {
    guard let request else { return }
    guard let requestId = numberValue(request["requestId"])?.intValue else { return }
    guard requestId != lastPlacementEditRequestId else { return }
    lastPlacementEditRequestId = requestId

    guard let objectId = request["objectId"] as? String,
          let action = request["action"] as? String else { return }
    guard var snapshot = placementSnapshotsById[objectId] else { return }

    if action == "remove" {
      placementNodesById[objectId]?.removeFromParentNode()
      placementNodesById.removeValue(forKey: objectId)
      placementSnapshotsById.removeValue(forKey: objectId)
      emitPlacement(kind: "object-removed", message: "Object removed from the AR scene.", objectId: objectId)
      return
    }

    if action == "move-to-reticle" {
      guard let target = latestReticleTarget else {
        emitPlacement(kind: "placement-failed", message: "Aim at a tracked surface before moving the selected object.")
        return
      }
      snapshot["position"] = ["x": target.point.x, "y": target.point.y, "z": target.point.z]
      placementSnapshotsById[objectId] = snapshot
      upsertPlacementNode(snapshot)
      emitPlacement(kind: "object-updated", message: "Object moved to the reticle.", object: snapshot)
      return
    }

    let currentRotation = numberValue(snapshot["rotationY"])?.floatValue ?? 0
    let delta: Float = action == "rotate-left" ? -.pi / 12 : .pi / 12
    snapshot["rotationY"] = currentRotation + delta
    placementSnapshotsById[objectId] = snapshot
    upsertPlacementNode(snapshot)
    emitPlacement(kind: "object-updated", message: "Object rotation updated.", object: snapshot)
  }

  private func syncPlacedObjects(_ objects: NSArray?) {
    let snapshots = (objects as? [[String: Any]]) ?? []
    var nextIds = Set<String>()

    for snapshot in snapshots {
      guard let id = snapshot["id"] as? String else { continue }
      nextIds.insert(id)
      placementSnapshotsById[id] = snapshot
      upsertPlacementNode(snapshot)
    }

    for id in placementNodesById.keys where !nextIds.contains(id) {
      placementNodesById[id]?.removeFromParentNode()
      placementNodesById.removeValue(forKey: id)
      placementSnapshotsById.removeValue(forKey: id)
    }

    updatePlacementSelection()
  }

  private func upsertPlacementNode(_ snapshot: [String: Any]) {
    guard let id = snapshot["id"] as? String,
          let dimensions = snapshot["dimensions"] as? [String: Any],
          let position = snapshot["position"] as? [String: Any] else { return }

    let width = CGFloat(numberValue(dimensions["width"])?.doubleValue ?? 0.2)
    let height = CGFloat(numberValue(dimensions["height"])?.doubleValue ?? 0.2)
    let depth = CGFloat(numberValue(dimensions["depth"])?.doubleValue ?? 0.08)
    let node = placementNodesById[id] ?? SCNNode()
    node.childNodes.forEach { $0.removeFromParentNode() }
    node.geometry = nil
    let representation = snapshot["representation"] as? String ?? "generic-object"
    node.addChildNode(makePlacementGeometry(representation: representation, width: width, height: height, depth: depth))
    node.name = id
    node.position = SCNVector3(
      Float(numberValue(position["x"])?.doubleValue ?? 0),
      Float(numberValue(position["y"])?.doubleValue ?? 0),
      Float(numberValue(position["z"])?.doubleValue ?? 0)
    )
    node.eulerAngles.y = numberValue(snapshot["rotationY"])?.floatValue ?? 0

    if placementNodesById[id] == nil {
      sceneView.scene.rootNode.addChildNode(node)
      placementNodesById[id] = node
    }

    updatePlacementSelection()
  }

  private func updatePlacementSelection() {
    let selectedId = selectedPlacedObjectId as String?
    for (id, node) in placementNodesById {
      let isSelected = id == selectedId
      node.opacity = isSelected ? 0.95 : 0.72
      node.scale = isSelected ? SCNVector3(1.05, 1.05, 1.05) : SCNVector3(1, 1, 1)
    }
  }

  private func placementSnapshot(
    id: String,
    catalogObjectId: String,
    displayName: String,
    placementMode: String,
    dimensions: NSDictionary,
    point: SIMD3<Float>,
    rotationY: Float,
    representation: String?
  ) -> [String: Any] {
    var result: [String: Any] = [
      "id": id,
      "catalogObjectId": catalogObjectId,
      "displayName": displayName,
      "placementMode": placementMode,
      "dimensions": [
        "width": numberValue(dimensions["width"])?.doubleValue ?? 0.2,
        "height": numberValue(dimensions["height"])?.doubleValue ?? 0.2,
        "depth": numberValue(dimensions["depth"])?.doubleValue ?? 0.08
      ],
      "position": [
        "x": point.x,
        "y": point.y,
        "z": point.z
      ],
      "rotationY": rotationY
    ]
    if let representation { result["representation"] = representation }
    return result
  }

  private func makePlacementGeometry(representation: String, width: CGFloat, height: CGFloat, depth: CGFloat) -> SCNNode {
    let root = SCNNode()
    let blue = UIColor.systemBlue.withAlphaComponent(0.82)
    let darkBlue = UIColor.systemIndigo.withAlphaComponent(0.82)
    func part(_ width: CGFloat, _ height: CGFloat, _ length: CGFloat, _ position: SCNVector3, _ material: UIColor = blue) -> SCNNode {
      let box = SCNBox(width: max(width, 0.02), height: max(height, 0.02), length: max(length, 0.02), chamferRadius: 0.006)
      box.firstMaterial?.diffuse.contents = material
      box.firstMaterial?.emission.contents = material.withAlphaComponent(0.08)
      let node = SCNNode(geometry: box)
      node.position = position
      return node
    }
    switch representation {
    case "sofa":
      root.addChildNode(part(width, height * 0.32, depth * 0.7, SCNVector3(0, -height * 0.22, 0)))
      root.addChildNode(part(width, height * 0.55, depth * 0.18, SCNVector3(0, height * 0.05, -depth * 0.38), darkBlue))
      root.addChildNode(part(width * 0.1, height * 0.45, depth * 0.7, SCNVector3(-width * 0.45, -height * 0.02, 0), darkBlue))
      root.addChildNode(part(width * 0.1, height * 0.45, depth * 0.7, SCNVector3(width * 0.45, -height * 0.02, 0), darkBlue))
    case "chair":
      root.addChildNode(part(width, height * 0.24, depth, SCNVector3(0, -height * 0.25, 0)))
      root.addChildNode(part(width * 0.85, height * 0.7, depth * 0.18, SCNVector3(0, height * 0.1, -depth * 0.4), darkBlue))
    case "table":
      root.addChildNode(part(width, height * 0.16, depth, SCNVector3(0, height * 0.3, 0)))
      for x in [-width * 0.4, width * 0.4] { for z in [-depth * 0.4, depth * 0.4] { root.addChildNode(part(width * 0.08, height * 0.6, depth * 0.08, SCNVector3(x, -height * 0.05, z), darkBlue)) } }
    case "bed":
      root.addChildNode(part(width, height * 0.35, depth, SCNVector3(0, -height * 0.2, 0)))
      root.addChildNode(part(width * 0.88, height * 0.18, depth * 0.18, SCNVector3(0, height * 0.05, -depth * 0.36), UIColor.systemGray.withAlphaComponent(0.8)))
    case "cabinet":
      root.addChildNode(part(width, height, depth, SCNVector3(0, 0, 0)))
      root.addChildNode(part(width * 0.04, height * 0.85, depth * 0.04, SCNVector3(0, 0, depth * 0.51), darkBlue))
    default:
      root.addChildNode(part(width, height, depth, SCNVector3(0, 0, 0)))
    }
    return root
  }

  private func emitPlacement(
    kind: String,
    message: String,
    object: [String: Any]? = nil,
    objectId: String? = nil
  ) {
    var placement: [String: Any] = [
      "kind": kind,
      "message": message
    ]
    if let object {
      placement["object"] = object
    }
    if let objectId {
      placement["objectId"] = objectId
    }

    var action: [String: Any] = [
      "kind": kind,
      "message": message
    ]
    if let objectId {
      action["objectId"] = objectId
    }

    var payload: [String: Any] = [
      "lastAction": action,
      "tracking": currentTracking.toDictionary(),
      "reticle": reticlePayload(),
      "placement": placement
    ]
    if let measurement = measurementPayload() {
      payload["measurement"] = measurement
    }
    onMeasurementUpdate?(payload)
  }

  private func numberValue(_ value: Any?) -> NSNumber? {
    if let number = value as? NSNumber {
      return number
    }
    if let double = value as? Double {
      return NSNumber(value: double)
    }
    if let float = value as? Float {
      return NSNumber(value: float)
    }
    if let int = value as? Int {
      return NSNumber(value: int)
    }
    return nil
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
