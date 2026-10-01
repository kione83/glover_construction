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

// Native offline reference viewer: PDF pages and image zoom/pan stay within the app.
import QuickLook

private final class ProjectPreviewItem: NSObject, QLPreviewItem {
  let previewItemURL: URL?
  let previewItemTitle: String?
  init(url: URL, title: String) { previewItemURL = url; previewItemTitle = title }
}

@objc(ProjectDocumentPreview)
final class ProjectDocumentPreview: NSObject, QLPreviewControllerDataSource, QLPreviewControllerDelegate {
  private var item: ProjectPreviewItem?
  private weak var previewController: QLPreviewController?
  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc(openDocument:title:resolver:rejecter:)
  func openDocument(_ uri: String, title: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      guard self.previewController == nil else {
        reject("preview_busy", "A document is already open.", nil); return
      }
      guard let url = URL(string: uri), url.isFileURL,
            FileManager.default.fileExists(atPath: url.path) else {
        reject("preview_missing", "The imported file is unavailable on this device. Import it again to restore the reference.", nil); return
      }
      let item = ProjectPreviewItem(url: url, title: title)
      guard QLPreviewController.canPreview(item) else {
        reject("preview_unsupported", "This file format cannot be previewed. Import a PDF or image.", nil); return
      }
      guard let presenter = RCTPresentedViewController(), presenter.view.window != nil else {
        reject("preview_unavailable", "The document viewer is unavailable. Please try again.", nil); return
      }
      let controller = QLPreviewController()
      self.item = item; self.previewController = controller
      controller.dataSource = self; controller.delegate = self
      presenter.present(controller, animated: true) { resolve(nil) }
    }
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { item == nil ? 0 : 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { item! }
  func previewControllerDidDismiss(_ controller: QLPreviewController) { item = nil; previewController = nil }
}
