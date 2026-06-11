// @lens-designer/bridge — public surface.
//
// Re-exports the bridge's core primitives so consumers (the CLI, the
// daemon, the test suite) import from a single workspace package
// instead of reaching into src/ paths.

export {
  // Discovery + transport
  McpClient,
  resolveConfig,
  type McpConfig,
  // Sandbox safety gate
  SANDBOX_MARKER_NAME,
  NotSandboxError,
  assertSandbox,
  // Typed helpers
  getSceneObjectByName,
  setProperty,
  type LSSceneObject,
  type LSComponent,
  type ValueType,
  type SetPropertyArgs,
} from './mcp.ts';

export {
  captureWindowToFile,
  findLensStudioWindowForPort,
  pidListeningOnPort,
  CaptureError,
  type CaptureToFileResult,
  type CaptureErrorKind,
  type CaptureResult,
  type PlatformCapabilities,
  type Region,
  type SourceId,
  type WindowEntry,
  type WindowBounds,
  type WindowRegion,
} from './capture.ts';

// Manifests for atomic primitives. Web app imports these to populate the
// palette + inspector forms; the mutation applier consumes them to
// materialize design nodes into LS scene shape.
export {
  MANIFESTS,
  ALL_MANIFESTS,
  getManifest,
  RectangleManifest,
  TextManifest,
  PrimitiveManifestSchema,
  PropertyDescriptorSchema,
  SceneShapeNodeSchema,
  PropertyMappingSchema,
  type PrimitiveManifest,
  type PrimitiveCategory,
  type PropertyDescriptor,
  type PropertyKind,
  type SceneShapeNode,
  type ComponentKind,
  type PropertyMapping,
  type PropertyTransform,
  type ValueType as ManifestValueType,
} from './manifests/index.ts';

// Protocol shapes (WS messages). Web app imports these for typed
// client-side serialization + validation.
export {
  DesignNodeSchema,
  ServerToClientMsgSchema,
  ClientToServerMsgSchema,
  HelloMsgSchema,
  SandboxDownMsgSchema,
  DesignAppliedMsgSchema,
  DesignErrorMsgSchema,
  PreviewReadyMsgSchema,
  DesignApplyMsgSchema,
  PreviewConfigureRegionMsgSchema,
  WindowRegionSchema,
  Vec3Schema,
  Vec4Schema,
  type DesignNode,
  type ServerToClientMsg,
  type ClientToServerMsg,
  type HelloMsg,
  type SandboxDownMsg,
  type DesignAppliedMsg,
  type DesignErrorMsg,
  type PreviewReadyMsg,
  type DesignApplyMsg,
  type PreviewConfigureRegionMsg,
  type Vec3,
  type Vec4,
} from './protocol.ts';
