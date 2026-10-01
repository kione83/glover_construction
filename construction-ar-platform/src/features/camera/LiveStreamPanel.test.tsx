import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
const mocks = vi.hoisted(() => ({ media: vi.fn(), peers: [] as any[] }));
vi.mock("react-native", () => ({ Text: "Text", TextInput: "TextInput", View: "View", Pressable: "Pressable", StyleSheet: { create: (value: any) => value } }));
vi.mock("react-native-webrtc", () => ({
  mediaDevices: { getUserMedia: mocks.media }, MediaStream: class {},
  RTCIceCandidate: class { constructor(value: any) { Object.assign(this, value); } },
  RTCSessionDescription: class { constructor(value: any) { Object.assign(this, value); } },
  RTCPeerConnection: class {
    remoteDescription: any;
    channel = { readyState: "open", send: vi.fn(), onopen: undefined as any };
    close = vi.fn(); addTrack = vi.fn(); addIceCandidate = vi.fn();
    createDataChannel = vi.fn(() => this.channel);
    createOffer = vi.fn(async () => ({ type: "offer", sdp: "test-offer" }));
    setLocalDescription = vi.fn(async () => {});
    setRemoteDescription = vi.fn(async value => { this.remoteDescription = value; });
    constructor() { mocks.peers.push(this); }
  },
}));
import { LiveStreamPanel } from "./LiveStreamPanel";
class Socket {
  static OPEN = 1; static instances: Socket[] = [];
  readyState = 1;
  onopen: any; onmessage: any; onclose: any; onerror: any;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  constructor(_url: string) { Socket.instances.push(this); }
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReactTestRenderer;
let track: { stop: ReturnType<typeof vi.fn> };
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
const button = (label: string) => renderer.root.findAllByType("Pressable" as any).find(node => text(node) === label)!;
beforeEach(() => {
  vi.clearAllMocks(); mocks.peers.length = 0; Socket.instances = []; vi.stubGlobal("WebSocket", Socket);
  track = { stop: vi.fn() }; mocks.media.mockResolvedValue({ getTracks: () => [track] });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
async function start() {
  await act(async () => { renderer = create(<LiveStreamPanel />); });
  await act(async () => button("Stream").props.onPress());
  const socket = Socket.instances[0];
  await act(async () => socket.onopen());
  return socket;
}
const message = async (socket: Socket, payload: any) => act(async () => socket.onmessage({ data: JSON.stringify(payload) }));
describe("embedded stream negotiation", () => {
  it("waits for the late viewer before sending an offer, then accepts its answer", async () => {
    const socket = await start();
    expect(socket.send.mock.calls.map(call => JSON.parse(call[0]).type)).toEqual(["join"]);
    expect(mocks.peers).toHaveLength(0);
    await message(socket, { type: "viewer-ready" });
    expect(socket.send.mock.calls.map(call => JSON.parse(call[0]).type)).toEqual(["join", "offer"]);
    await message(socket, { type: "candidate", candidate: { candidate: "test" } });
    expect(mocks.peers[0].addIceCandidate).not.toHaveBeenCalled();
    await message(socket, { type: "answer", sdp: { type: "answer", sdp: "test-answer" } });
    expect(mocks.peers[0].addIceCandidate).toHaveBeenCalledOnce();
    expect(text(renderer.root)).toContain("Streaming live view");
  });
  it("creates a fresh peer for a rejoining viewer and sends the latest layout when its channel opens", async () => {
    const socket = await start();
    await message(socket, { type: "viewer-ready" });
    const first = mocks.peers[0];
    await act(async () => renderer.update(<LiveStreamPanel liveMeasurements={[{ id: "measure", label: "Latest", value: 2, unit: "m", status: "stable" }]} />));
    await message(socket, { type: "viewer-ready" });
    expect(first.close).toHaveBeenCalledOnce();
    expect(mocks.peers).toHaveLength(2);
    await act(async () => mocks.peers[1].channel.onopen());
    expect(JSON.parse(mocks.peers[1].channel.send.mock.calls.at(-1)[0]).liveMeasurements[0].label).toBe("Latest");
    expect(mocks.media).toHaveBeenCalledOnce();
  });
  it("stops a camera stream that finishes opening after Stop", async () => {
    let finish!: (value: any) => void;
    mocks.media.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(<LiveStreamPanel />); });
    await act(async () => button("Stream").props.onPress());
    const socket = Socket.instances[0];
    let opening: Promise<void>;
    await act(async () => { opening = socket.onopen(); });
    await act(async () => button("Stop").props.onPress());
    await act(async () => { finish({ getTracks: () => [track] }); await opening; });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
  });
  it("recovers from malformed signaling without an unhandled promise or leaked camera", async () => {
    const socket = await start();
    await act(async () => socket.onmessage({ data: "invalid-json" }));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(button("Stream")).toBeDefined();
  });
});
