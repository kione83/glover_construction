#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(MeasurementARViewManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(onMeasurementUpdate, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(resetCounter, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(captureRequestId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(capturePointRole, NSString)
RCT_EXPORT_VIEW_PROPERTY(placementRequest, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(placedObjects, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectedPlacedObjectId, NSString)
RCT_EXPORT_VIEW_PROPERTY(placementEditRequest, NSDictionary)

@end
