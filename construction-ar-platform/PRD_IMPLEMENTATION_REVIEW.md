# ConstructionAR implementation review

Review date: September 25, 2026.

## October 1, 2026 implementation update

The September review below is retained as the pre-session assessment. The
following gaps have since been addressed on `development/2026-10-01-autonomous`:

| Requirement / finding | Session result | Remaining acceptance |
| --- | --- | --- |
| FR-6–7, NFR-3: save/reopen reliability | Completed scans retain retryable payloads and stable room IDs; AR edits use an ordered retry queue; close waits for saves; load failures offer recovery. | Retry state is in memory until storage succeeds. Physical-device interruption/background testing remains. |
| FR-12, NFR-5: project context | Dashboard → AR tools → dashboard retains the selected project. Switching projects clears stale room/measurement selection. | Two-project physical-device acceptance. |
| FR-14, FR-17, FR-19: placement editing | Saved 3D viewers now move/rotate proposed catalog objects and adjust elevation; canonical poses persist while source AR evidence and scan geometry remain intact. | Touch feel and real-room placement acceptance. |
| FR-20–23, NFR-8: fit checks | Collision and clearance envelopes use canonical room poses, rotation and scale. Unaligned objects are explicitly unchecked. Missing surface evidence is unverified, not a fabricated attachment failure. | Actual mounting-surface association/orientation, scanned obstacles, and field accuracy are still incomplete. |
| FR-26, FR-29: visual review outputs | Share current saved-model camera view as a captioned PNG with visible labels and planning caveat; export saves the layout first. | Live composited AR snapshots and richer reports remain future work. |
| FR-32–33: blueprint reference | Imported PDFs/images open offline in native Quick Look with page navigation and zoom/pan; closing retains project context. | Physical-device gesture/accessibility acceptance. |

The project still lacks rescan-in-place, design duplication/versioning, realistic
manufacturer assets, and a complete scan → align → place → reopen acceptance run
on supported hardware. The embedded stream late-viewer negotiation issue remains.
Advanced collaboration, headsets and multi-trade validation remain post-MVP.
See `SESSION_2026-10-01.md` for verification evidence and commit references.

## Assessment

ConstructionAR is a substantial iPhone prototype with real native scanning, saved spatial models, measurement tools, catalog placement, room assembly, and local project documentation. It is not yet a demonstrated, complete MVP against the PRD. The main remaining work is connecting these capabilities reliably, completing blueprint reference and visual sharing, and improving the limited product representations for the residential use case.

The implementation is particularly developed in room/object transforms, measurement provenance, saved-model inspection, and multi-room assembly. Those capabilities do not remove the need to prove the simpler scan → place → reopen → review → share workflow on a physical device.

## Scope and evidence

- Requirements source: all 11 pages of `ConstructionAR PRD.pdf`, especially sections 4.2, 8, 9, 10, and 15. Post-MVP requirements are distinguished from MVP gaps below.
- Reviewed current working-tree code, including existing uncommitted changes, rather than only the last commit.
- Inspected React Native navigation/screens, domain services, local persistence, Swift RoomPlan/ARKit/SceneKit implementations, tests, streaming tools, and prior validation notes.
- Fresh verification: `npm test -- --run` passed 118 tests across 18 files; `npx tsc --noEmit` passed; `python3 tools/test-room-transforms.py` passed its production Swift/SceneKit regression checks.
- A read-only in-memory validation probe reproduced a missed collision for coincident room-local placements recorded in different AR sessions. It also reproduced unsupported-surface errors when placements contain anchor IDs without corresponding saved anchors.
- No physical-device scan, camera/gesture acceptance, streaming session, performance benchmark, or full app build was performed during this review. Previous validation notes report successful builds/installations but explicitly leave physical acceptance outstanding. Automated checks establish domain/helper behavior, not field accuracy or end-to-end usability.
- No application code or existing files were changed by this review.

Status terminology: **Implemented** means a substantive reachable implementation exists, with automated coverage where applicable; **Partial** means a material part of the requirement remains; **Missing** means no implementation was found; **Deferred** means the PRD explicitly places the capability after MVP. None of these labels certifies physical-device acceptance.

## Requirements traceability

| PRD requirement | Status | Current implementation and remaining limitation |
| --- | --- | --- |
| FR-1: scan a real environment | Implemented; device acceptance pending | Native RoomPlan capture, coaching, completion/error events, semantic geometry, and optional ARKit mesh. Requires supported LiDAR hardware. |
| FR-2: usable spatial scene | Implemented | Saved native archives and semantic elements; SceneKit room/project viewers; separately selectable geometry. |
| FR-3, FR-13: environment-relative anchoring | Partial | Room-local placement transforms and explicit two-reference AR alignment exist. A fresh session requires manual alignment; surface association is not fully wired into saved catalog placements. Stable real-room behavior remains unverified. |
| FR-4: rescan/refresh incomplete capture | Partial | Users can capture another room or delete and scan again. No in-place replacement/refresh that preserves room identity, placements, and connections was found. |
| FR-5: create project | Implemented | Named projects with optional client and site information. |
| FR-6–7: save and reopen | Implemented, with reliability gaps | Local schema-versioned documents, durable media copies, scan archives, lightweight indexes, and saved transforms. Some failure/navigation paths need work; see findings below. |
| FR-8: duplicate/version design alternatives | Missing | No project/layout duplication, version history, or alternative comparison workflow. This is a PRD “should,” below the core MVP blockers. |
| FR-9–10: limited organized catalog | Implemented at a basic level | Fourteen entries with trade/category labels. Browsable lists, but no category filtering or search. An exhaustive library is not required. |
| FR-11: metadata and appropriately realistic assets | Partial | IDs, SKU labels, dimensions, placement modes, allowed surfaces, and some clearances exist. Rendered assets are procedural approximations; no manufacturer-specific asset pipeline. |
| FR-12: place virtual objects | Implemented, with integration gaps | Catalog selection opens native AR placement at the reticle. Saved-room registration is required for scanned-room placement. Project selection does not carry through navigation correctly. |
| FR-14–16: move, rotate, remove, multiple objects | Implemented | AR objects can move to the reticle, rotate, and be removed; multiple placements persist. Saved-model joystick editing currently targets scanned objects, not proposed catalog objects. |
| FR-17–19: contextual rendering, mobile visualization, scale | Implemented at prototype level | Native AR rendering and saved SceneKit models use metric dimensions. Room transforms preserve child geometry. Placement/surface orientation and field stability still need acceptance. |
| FR-19A: realistic residential product visualization | Partial | Correctly sized generic objects support rough fit, but actual smart-home product appearance and product alternatives are not implemented. Device behavior simulation is explicitly post-MVP. |
| FR-20–22: measurement-aware placement and fit cues | Implemented at prototype level | A/B AR measurements, multiple capture passes, confidence/uncertainty, scan W/D/H, qualified derived areas/volumes, metric/imperial display, measurement history, and CSV. No survey-grade or field-accuracy result is established. |
| FR-23: extensible rules foundation | Implemented | Separate rule definitions and validation service with supported-surface, overlap, and clearance checks. Existing checks have correctness limitations. |
| FR-24–25: advanced clash detection/field validation | Deferred | No comprehensive scan-versus-design, multi-trade, routing, or installed-work discrepancy workflow. Basic validation is already present but is not equivalent to these requirements. |
| FR-26: shareable visual outputs | Missing | Text layout summary, CSV exports, and a live-view proof of concept exist. No in-app AR/3D snapshot export or visual layout report was found. Ordinary site photos do not include the proposed layout. |
| FR-27–28: structured collaboration/shared editing | Deferred | No comments, approvals, shared editing, or durable shared sessions. Local WebRTC is a one-viewer proof of concept. |
| FR-29: output communicating design state | Partial | Text summary lists rooms, object names, blueprint names, validation issues, and documentation counts. It does not visually communicate object positions or a proposed layout. |
| FR-30: site photos and notes | Implemented at project level | Camera capture, durable photo storage, dated notes, and local reopening. No object/location note authoring flow; UI currently shows only the first five notes and six photos, without a full-history browser. |
| FR-31: automated blueprint generation | Deferred | Not implemented; not an MVP blocker. |
| FR-32: blueprint import/association | Implemented | Image/PDF picker, local durable copy, and project metadata. |
| FR-33: blueprint available as a reference | Partial | Images display as previews. PDFs display a badge and metadata, with no open/view action. No full-screen zoom/pan plan viewer. Calibrated AR plan overlays are not required by the MVP wording. |

## What is already substantial

1. **Scanning and model retention:** RoomPlan captures walls, floors, openings, doors, windows, and recognized contents. Original captured-room JSON is retained; supplemental mesh data is bounded and available on supported iOS 17+ paths. Missing stair tread/riser details are not fabricated.
2. **Room and object assembly:** Multiple scans can be inspected together, manually aligned, translated/rotated, and saved. Reference-room locking, room-local hierarchy, scanned-object movement, and explicit parent-linked component assemblies are implemented. Saved-model edits preserve captured dimensions.
3. **Measurement infrastructure:** Confidence handling, multi-pass measurements, observation/history metadata, units, object quantities, derived dimensions, and export have meaningful automated coverage.
4. **Local persistence:** Schema version 8, scan archives separated from ordinary project metadata, durable photo/blueprint copying, compatibility normalization, and cleanup of deleted-room dependencies. The README's schema-5 description is outdated.
5. **Project documentation:** Named projects, site photos, field notes, blueprint attachments, text summaries, and CSV are connected to the local project record.

Primary sources: `src/features/roomScan/RoomScanScreen.tsx`, `ios/ConstructionARPlatform/RoomScanView.swift`, `src/features/roomViewer/SavedRoomViewerScreen.tsx`, `ios/ConstructionARPlatform/SavedRoom3DView.swift`, `src/domain/roomAssembly.ts`, `src/domain/scannedObjectAssemblies.ts`, `src/domain/measurements.ts`, `src/domain/scannedObjects.ts`, and `src/storage/projectRepository.ts`.

## Concrete defects and incomplete integration

### 1. AR tools lose the selected project

`AppShell` passes only the catalog-object ID to `MeasurementScreen`. That screen initializes its project selection from `documents[0]`. Selecting project B on the dashboard can therefore open AR tools against project A if A is first in storage. Project selectors exist inside AR tools, but the user must correct the context manually. Returning to the dashboard also initializes selection from the first stored project.

Evidence: `src/app/AppShell.tsx`, `src/features/measurement/MeasurementScreen.tsx:357`, and `src/features/home/HomeScreen.tsx:66`.

### 2. Validation does not use the canonical placement frame

AR placement saves both its source AR-world pose and a canonical `roomLocalTransform`. `validationService.objectBounds()` uses `placedObject.transform.position`, so objects placed in different AR sessions can be compared in unrelated coordinate frames. The read-only probe used two objects with the same room-local position and source AR-world X values of 0 and 10; validation missed their overlap.

Collision checks also ignore object rotation/scale and scanned obstacles. Clearance volumes are axis-aligned, centered boxes rather than oriented working spaces. These are useful initial rules, not dependable fit approval.

Evidence: `src/domain/validationService.ts:44`, `src/domain/validationService.ts:82`, and `src/domain/roomObjectHierarchy.ts:40`.

### 3. Surface attachment metadata is disconnected from AR placement

`mapNativeSnapshotToPlacedObject` assigns an `anchorId`, but `persistPlacementSnapshot` does not create/update the corresponding `project.anchors` entry. The validator requires that entry and its surface reference. Native placement records `placementMode` but places at the reticle without enforcing the catalog's allowed surface kind or orienting a wall/ceiling fixture to that surface.

This means world-space rendering can work while attachment validation reports an unsupported surface. Physical anchoring, saved room registration, and domain surface-reference validation should be treated as separate mechanisms and connected deliberately.

Evidence: `src/features/measurement/MeasurementScreen.tsx:167`, `src/features/measurement/MeasurementScreen.tsx:556`, `src/domain/validationService.ts:28`, and `ios/ConstructionARPlatform/MeasurementARView.swift:934`.

### 4. Failed scan saves do not provide a recovery path

The scan completion handler marks completion handled and calls `void persistScan(completedScan)` without a catch. A storage failure therefore has no explicit retry/save-recovery UI in this path. The native scan has already finished. Initial project loading in the scan and measurement screens also lacks the error handling used by the home and saved-viewer screens.

Evidence: `src/features/roomScan/RoomScanScreen.tsx:178` and `src/features/measurement/MeasurementScreen.tsx:388`.

### 5. Visual export and PDF reference are unfinished

`BlueprintPanel` has no PDF open action. `shareProjectSummary` writes a `.txt` file. The native AR and saved-model viewers expose no screenshot export action. Text and CSV are useful supporting outputs but do not fulfill FR-26's visual-review requirement.

Evidence: `src/features/home/HomeScreen.tsx:228`, `src/features/home/HomeScreen.tsx:557`, and `src/domain/projectReport.ts`.

### 6. Streaming remains a limited proof of concept

The server is a local unauthenticated WebSocket relay with one publisher/viewer per room. Clients configure STUN but no TURN infrastructure. The embedded `LiveStreamPanel` sends its offer immediately and does not handle `viewer-ready`; the server drops messages when the peer is absent. A viewer joining after the embedded publisher can therefore miss negotiation. The separate `LiveWebRtcPublisherScreen` does handle `viewer-ready`.

This is a source-inspection finding, not a live WebRTC reproduction. Streaming also opens a camera media stream; it should not be assumed to broadcast the composited native AR view. The browser receives separate layout data.

Evidence: `src/features/camera/LiveStreamPanel.tsx:130`, `src/features/camera/LiveWebRtcPublisherScreen.tsx:125`, and `tools/live-view-server.mjs`.

## Non-functional readiness

| PRD area | Assessment |
| --- | --- |
| NFR-1–2: interaction/rendering performance | Lightweight project indexes, bounded meshes, and separate transform updates are good foundations. No current device FPS, memory, large-project, or long-session benchmark establishes acceptance. |
| NFR-3: preserve saved projects | Persistence and migration tests pass. Failure/retry paths, close/reopen timing, and interrupted-save acceptance need further verification. No user-facing backup/restore workflow was found. |
| NFR-4: weak environment understanding | Tracking status, confidence, fallback point resolution, and unsupported-device messaging exist. Physical degradation/recovery acceptance remains open. |
| NFR-5–6: pilot/customer usability | Context loss and manual AR registration create friction. UI exposes technical feature IDs and, in one connection form, radians. No documented completed pilot-user acceptance was found. |
| NFR-7–8: accuracy/trust | Confidence and planning disclaimers exist, but consistent real-room alignment is unproven. Generic catalog dimensions and RoomPlan bounding measurements must remain distinguishable. |
| NFR-9–10: extensibility | Domain/storage/feature/native separation, rule/catalog modules, and versioned documents provide a credible base. Large screen/native files and duplicated streaming implementations increase integration risk. |
| NFR-11–12: data handling/security | Storage is local. No production identity, access-control, synchronization, or documented end-user backup/access policy. Enterprise security is deferred by the PRD; production remote sharing needs an explicit design before rollout. |
| Section 6: supported devices | Actual native app configuration targets iPhone only (`TARGETED_DEVICE_FAMILY = 1`) with iOS deployment target 16.4. RoomPlan further requires supported LiDAR hardware; mesh augmentation uses iOS 17+. Android scripts do not constitute Android AR support. iPad/headset support is not implemented or established by this review. |

## Recommended next work, in priority order

### 1. Make the scan → place → save → reopen workflow dependable

Carry project and room identity through navigation; fix validation to use canonical room coordinates and proper saved surface associations; enforce placement surfaces/orientation; add explicit scan-save failure and retry handling. Make fresh-session alignment understandable. Include device acceptance rather than treating unit-test success as field validation.

**Done when:** On the declared supported iPhone, a user selects a non-first project, scans a room, aligns and places several objects, moves/rotates/removes them, closes/reopens and relaunches the app, and reviews the same intended layout without switching projects or losing data. Repeat across a fresh AR session; verify failed writes can be retried and validation respects the saved layout. Include a two-room case and weak-tracking/background-resume checks. Document the actual supported devices and observed alignment behavior.

**Why first:** This addresses FR-3, FR-6–7, FR-12–19 and NFR-3/5/8; every subsequent feature depends on trustworthy project and spatial context.

### 2. Finish blueprint reference inside the project

Add an accessible PDF/image viewer with PDF page navigation, zoom/pan, and a straightforward route back to the selected project's layout. Preserve imported files offline. Start with a useful reference viewer; calibrated plan-to-AR overlays can follow if the pilot requires them.

**Done when:** A contractor imports a multi-page PDF or image, opens and reads it at useful detail, moves between the reference and the layout, and can reopen it after an offline relaunch.

**Why second:** FR-32–33 and the contractor use case explicitly require usable plan reference. Attachment-only PDF support leaves that flow incomplete.

### 3. Add shareable visual layout outputs

Export the actual composited AR or saved 3D view with the proposed objects visible. Include project/room identification and the planning-accuracy qualification; allow useful measurement labels. A PNG/JPEG shared through the system sheet is sufficient for the first increment. A concise illustrated PDF report can follow.

**Done when:** A stakeholder can share a saved layout image with a customer who does not have the app, and the image communicates object position/scale rather than only object names. Failed/cancelled export does not lose layout state.

**Why third:** This directly closes FR-26 and materially improves FR-29 and the customer-presentation use case.

### 4. Deliver a focused, realistic starter product experience

Choose the initial pilot persona/categories from the PRD's open decisions, then add a small set of recognizable, dimensionally correct product assets with useful labels and surface behavior. Improve catalog grouping and selection. Keep the initial product range narrow enough to verify asset scale and appearance on device.

**Done when:** Pilot users can select, place, and compare a small set of realistic products in context, with correct dimensions and mounting behavior, and understand the proposed installation. Manufacturer account integrations and smart-home behavior simulation are not prerequisites.

**Why fourth:** Generic volumes establish feasibility, but FR-11/19A and the residential use case call for credible product appearance. This improves demonstrated customer value more directly than extending the platform into new devices or advanced trade coordination.

## Deliberately later

The PRD explicitly defers headset synchronization, real-time collaborative editing, advanced multi-trade clashes and installed-work validation, smart-home behavior simulation, manufacturer integrations, blueprint generation, deep reporting, CAD/BIM interoperability, and enterprise governance. Their absence should not block the narrow MVP above.

Project duplication/versioning, preserving layout through rescan, a full photo/note history browser, and consistent saved-viewer editing of proposed catalog objects are worthwhile follow-on gaps. Schedule them after the four priorities according to pilot feedback. Production backend/authentication should follow the chosen deployment and sharing model rather than be assumed necessary for a local-device pilot.
