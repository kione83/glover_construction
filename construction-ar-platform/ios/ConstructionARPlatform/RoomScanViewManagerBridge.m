#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(RoomScanViewManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(onRoomScanUpdate, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(startRequestId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(finishRequestId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(showMeasurements, BOOL)

@end

@interface RCT_EXTERN_MODULE(SavedRoom3DViewManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(modelJSON, NSString)
RCT_EXPORT_VIEW_PROPERTY(selectedRoomId, NSString)
RCT_EXPORT_VIEW_PROPERTY(selectedFeatureIdsJSON, NSString)
RCT_EXPORT_VIEW_PROPERTY(editingRoomId, NSString)
RCT_EXPORT_VIEW_PROPERTY(allowDirectManipulation, BOOL)
RCT_EXPORT_VIEW_PROPERTY(showMeasurements, BOOL)
RCT_EXPORT_VIEW_PROPERTY(resetRequestId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(onSceneSelection, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onRoomTransformChange, RCTBubblingEventBlock)

@end
