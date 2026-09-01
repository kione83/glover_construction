import React

@objc(RoomScanViewManager)
final class RoomScanViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    RoomScanView()
  }
}

@objc(SavedRoom3DViewManager)
final class SavedRoom3DViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }
  override func view() -> UIView! { SavedRoom3DView() }
}
