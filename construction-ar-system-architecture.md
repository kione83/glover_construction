# Construction AR Platform System Architecture

## 1. Document Purpose

This document defines the proposed system architecture for the Construction AR Platform. It translates the approved scope and requirements into a technical structure that supports the client's long-term product vision while keeping the MVP implementation intentionally focused.

The architecture is designed around two principles:

- Preserve the client's vision for a unified construction AR platform
- Deliver the MVP as a practical, technically credible first release

This document does not redefine product scope. Instead, it provides a technical blueprint for implementing the current requirements in a way that supports future expansion.

## 2. Architectural Goals

The system architecture shall:

- Support real-world space scanning and spatial scene understanding
- Enable anchored AR placement of virtual construction-related objects
- Provide a clean scan-to-layout workflow for MVP users
- Support persistence of projects, scenes, and placed objects
- Remain modular enough to add validation, reporting, collaboration, and documentation capabilities later
- Support multiple device classes over time without requiring full MVP parity
- Manage the difference between visualization-grade functionality and higher-precision future workflows

## 3. Architectural Scope

### 3.1 MVP Architectural Scope

The MVP architecture covers:

- Client-side spatial capture
- Local or managed spatial scene representation
- Object library access
- AR object placement and editing
- Project persistence
- Basic visual output generation

### 3.2 Future Architectural Scope

The architecture also reserves extension points for:

- Rule-based conflict detection
- Rich reporting and documentation
- Collaboration and shared review workflows
- Broader asset and object management
- External system integration
- Expanded analytics and administrative capabilities

## 4. High-Level Architecture

The proposed architecture uses a layered, service-oriented model with a device-aware client application and a backend platform that can grow over time.

### 4.1 Logical Layers

#### Presentation Layer

The user-facing application running on supported mobile and headset devices. This layer is responsible for user interaction, AR rendering, scene navigation, placement controls, and user workflow orchestration.

#### Spatial Runtime Layer

The device-integrated runtime responsible for scanning, scene understanding, spatial anchoring, and device-specific AR session management. This layer depends on platform SDK capabilities and is expected to vary by device family.

#### Application Domain Layer

The core product logic responsible for projects, scenes, object placement state, object metadata, layout workflows, project outputs, and future validation orchestration.

#### Platform Services Layer

Backend services responsible for persistence, object catalog delivery, authentication if needed, media storage, reporting support, and future collaboration features.

#### Integration Layer

A future-facing layer responsible for connecting to external systems such as CAD, BIM, reporting systems, enterprise platforms, or content pipelines.

## 5. Reference Architecture Overview

The recommended architecture for the MVP is a hybrid client-heavy system with a lightweight but extensible backend.

### 5.1 MVP Technical Shape

- AR-capable client application on supported devices
- Backend API for project persistence and object metadata retrieval
- Asset storage for object definitions, thumbnails, and future media outputs
- Structured project model representing scans, placed objects, and scene state

This approach keeps latency-sensitive AR interactions on the device while centralizing project persistence and future extensibility in the backend.

### 5.2 Why This Shape Fits the Product

- Scanning and anchored placement are inherently device-local workflows
- Rendering and manipulation must remain responsive and low-latency
- Project data, object libraries, and shareable outputs benefit from centralized storage
- Future reporting and collaboration features are easier to add when project data is already modeled centrally

## 6. Core Architectural Components

### 6.1 Client Application

The client application is the primary user-facing component. It should be structured into the following modules:

#### AR Session Module

Responsible for starting and managing device AR sessions, plane or mesh detection, anchor handling, and sensor-driven environmental understanding.

#### Scan Workflow Module

Guides the user through environmental capture and determines when the scene is sufficient for downstream placement.

#### Scene Model Module

Maintains the local in-session representation of the scanned environment, active anchors, and current object placements.

#### Placement Module

Provides workflows for inserting, moving, rotating, and removing virtual objects in the scene.

#### Object Catalog Module

Displays the available library of objects and retrieves object metadata required for placement.

#### Project Module

Manages creation, saving, loading, and updating of project state.

#### Output Module

Generates simple shareable outputs such as screenshots or lightweight project summaries for the MVP.

### 6.2 Backend API Layer

The backend API should expose services for:

- Project creation and retrieval
- Scene and placement persistence
- Object catalog retrieval
- Asset metadata access
- Output metadata storage

The API surface should remain small in the MVP but be versioned and structured so later services can expand without breaking the client.

### 6.3 Persistence Layer

The persistence layer should store:

- Project records
- Scene metadata
- Object placement records
- Object catalog metadata
- User ownership or workspace context if later required
- Output and export references

### 6.4 Asset Management Layer

This layer should manage:

- Virtual object files
- Preview images
- Object category metadata
- Versioning of supported assets over time

### 6.5 Future Rule Engine Layer

Although not required in the MVP, the architecture should reserve a separate rule-processing layer for future validation logic. This layer would evaluate object relationships, clearances, and trade-specific rules without tightly coupling validation logic to the rendering client.

## 7. Data Model Overview

The core product model should revolve around a small number of durable entities.

### 7.1 Project

Represents the top-level user work item.

Suggested fields:

- Project identifier
- Name
- Device/platform context
- Created date
- Updated date
- Status
- Scene references
- Output references

### 7.2 Scene

Represents a captured environment and its associated spatial state.

Suggested fields:

- Scene identifier
- Project identifier
- Spatial capture metadata
- Device capture context
- Environmental anchors or reference points
- Scene status

### 7.3 Placement

Represents a virtual object instance positioned within a scene.

Suggested fields:

- Placement identifier
- Scene identifier
- Object identifier
- Position
- Rotation
- Scale if supported
- Placement metadata
- User notes or future validation status

### 7.4 Object Definition

Represents a reusable virtual asset available for placement.

Suggested fields:

- Object identifier
- Name
- Category
- Dimensions
- Asset reference
- Preview asset
- Metadata tags
- Version

### 7.5 Output

Represents exported or shareable artifacts generated from a project.

Suggested fields:

- Output identifier
- Project identifier
- Output type
- File reference
- Created date

## 8. Proposed MVP Workflow

The MVP workflow should be implemented as a straightforward progression:

1. User creates or opens a project.
2. User scans the target environment.
3. System builds a usable spatial scene representation.
4. User browses the object library.
5. User places and adjusts virtual objects in context.
6. User saves the project state.
7. User generates a simple output for review or sharing.

This workflow should be reflected directly in both the product UI and the client application architecture.

## 9. Device Strategy

### 9.1 Cross-Platform Principle

The platform should be architected around shared product concepts rather than assuming identical platform APIs. Concepts such as project, scene, placement, asset, and output should remain stable across device types even if implementation details differ.

### 9.2 Platform Abstraction

The client architecture should isolate device-specific AR capabilities behind a platform abstraction layer so that:

- Mobile device scanning logic can evolve independently
- Headset-specific interaction models can be added later
- Core domain logic does not depend directly on one vendor SDK

### 9.3 MVP Recommendation

The first architecture iteration should prioritize one primary device family for the initial production workflow, with secondary device support treated as follow-on work unless requirements change.

## 10. Storage and Persistence Strategy

### 10.1 MVP Persistence Approach

The MVP should persist project and placement data in a central backend store while allowing temporary local device state during active sessions.

This gives the platform:

- Durability across sessions
- A foundation for future collaboration
- A basis for output generation and reporting

### 10.2 Spatial Data Considerations

Raw sensor output and fully detailed spatial meshes may be expensive or unnecessary to store in the MVP. The first release should store only the minimum spatial metadata needed to reopen projects meaningfully and preserve placed object relationships.

If later use cases require richer reconstruction fidelity, the storage model can expand in future phases.

## 11. API Design Principles

The backend API should follow these principles:

- Resource-oriented design for projects, scenes, placements, objects, and outputs
- Explicit versioning
- Clear separation between metadata and large binary asset delivery
- Stable identifiers across clients and sessions
- Minimal coupling between current MVP endpoints and future advanced features

Example resource families:

- `/projects`
- `/scenes`
- `/placements`
- `/objects`
- `/outputs`

## 12. Security and Access Model

The MVP may begin with a lightweight user and access model, depending on deployment expectations. However, the architecture should reserve support for:

- Authenticated users or customer accounts
- Ownership of projects and outputs
- Controlled access to stored project data
- Future role-based access for shared review workflows

Security requirements should be expanded once hosting, customer model, and deployment context are confirmed.

## 13. Reporting and Documentation Architecture

The MVP only requires simple shareable outputs, but the architecture should keep documentation generation separate from core AR interaction.

Recommended approach:

- Generate outputs from persisted project state rather than from ad hoc client screenshots alone
- Treat reports and later blueprint artifacts as downstream products of project data
- Avoid embedding reporting-specific logic into the placement runtime

This separation allows the reporting and documentation layer to mature independently later.

## 14. Validation and Clash Detection Architecture

The MVP does not require full clash detection, but the architecture should preserve a path toward it.

Recommended future model:

- Rule definitions stored independently from object assets
- Validation services reading scene and placement data from the domain model
- Validation results stored as separate records rather than mutating the raw placement state

This allows validation logic to evolve by trade, use case, and precision level without destabilizing the core placement workflow.

## 15. Scalability Considerations

The MVP does not need enterprise-scale optimization on day one, but the architecture should avoid obvious bottlenecks.

Areas to keep scalable:

- Object catalog growth
- Project storage volume
- Media and output storage
- Future background processing for reports and validation

Client-side rendering scale will likely be constrained by device performance before backend scale becomes the primary bottleneck in early releases.

## 16. Observability and Diagnostics

The architecture should include operational visibility from the first implementation.

Recommended telemetry areas:

- Scan completion success rates
- Placement success and failure events
- Project save and load performance
- Device/platform usage
- Error categories related to AR session stability

This is especially important because real-world AR workflows can fail for environmental and device-specific reasons that are difficult to infer without instrumentation.

## 17. Key Technical Risks

- Device-specific AR behavior may vary significantly across platforms
- Spatial anchoring and persistence may not behave consistently in all environments
- Performance constraints may limit scene complexity on consumer devices
- Precision expectations in construction workflows may exceed MVP technical capability
- Supporting too many device classes too early may create architectural and delivery instability

## 18. Architectural Decisions Still Pending

The following technical decisions should be explicitly resolved before implementation begins:

- Primary MVP device family
- Client technology stack and AR framework choice
- Backend hosting model
- Project persistence storage model
- Object asset format and pipeline
- Identity and access requirements for pilot users

## 19. Recommended Next Technical Artifacts

- Interface and API specification
- Data model schema definition
- MVP feature decomposition
- User workflow and screen flow diagrams
- Deployment architecture
- Technical risk mitigation plan

## 20. Summary

The recommended architecture for the Construction AR Platform is a modular, client-led spatial application backed by a lightweight but extensible service platform. This approach is well aligned to the client's vision because it supports immersive device-native workflows today while preserving a clear path toward later capabilities such as validation, reporting, collaboration, and broader construction documentation.

For the MVP, the architecture should remain disciplined: scan the space, place the objects, save the project, and share the result. Everything else should be designed for, but not forced into, the first release.
