import { LiveState } from "../../../src/room/live-state";
import type { OutpostLiveData, WSInMessage } from "../../../src/room/types";
import { WS_INCOMING_NAMES } from "../../../src/room/types";

describe("LiveState", () => {
  it("enforces remaining_time for non-creator", () => {
    const ls = new LiveState({
      selfAddress: "0xme",
      selfUuid: "me-uuid",
      creatorUuid: "creator-uuid",
    });
    const snapshot: OutpostLiveData = {
      members: [
        { address: "0xme", uuid: "me-uuid", name: "Me", remaining_time: 0, is_speaking: false },
      ],
    };
    ls.applySnapshot(snapshot);
    expect(ls.canSpeakNow().allowed).toBe(false);
  });

  it("treats creator as unlimited", () => {
    const ls = new LiveState({
      selfAddress: "0xcreator",
      selfUuid: "creator-uuid",
      creatorUuid: "creator-uuid",
    });
    expect(ls.canSpeakNow().allowed).toBe(true);
    expect(ls.getSelfRemainingTime()).toBe("unlimited");
  });

  it("applies remaining_time.updated WS events", () => {
    const ls = new LiveState({
      selfAddress: "0xme",
      selfUuid: "me-uuid",
      creatorUuid: "creator-uuid",
    });
    const msg: WSInMessage = {
      name: WS_INCOMING_NAMES.REMAINING_TIME_UPDATED,
      data: { address: "0xme", remaining_time: 5 },
    };
    ls.handleWSMessage(msg);
    expect(ls.canSpeakNow().allowed).toBe(true);
  });
});

