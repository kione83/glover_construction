import Foundation
import React

@objc(MeasurementARViewManager)
final class MeasurementARViewManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool {
    true
  }

  override func view() -> UIView! {
    MeasurementARView()
  }
}
