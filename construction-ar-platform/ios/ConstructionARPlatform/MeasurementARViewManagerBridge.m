#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(MeasurementARViewManager, RCTViewManager)

RCT_EXPORT_VIEW_PROPERTY(onMeasurementUpdate, RCTBubblingEventBlock)
RCT_EXPORT_VIEW_PROPERTY(resetCounter, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(captureRequestId, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(capturePointRole, NSString)

@end
