import { describe, expect, it } from 'vitest';

import {
  parseSignalingClientMessage,
  parseSignalingServerMessage,
  serializeSignalingMessage,
} from './webrtc.protocol';

describe('webrtc.protocol', () => {
  it('serializes signaling client messages', () => {
    expect(
      serializeSignalingMessage({
        type: 'join',
        roomId: 'room-a',
        peerId: 'peer-a',
        token: 'token-1',
      }),
    ).toBe('{"type":"join","roomId":"room-a","peerId":"peer-a","token":"token-1"}');
  });

  it('parses joined and peer lifecycle server messages', () => {
    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'joined',
          roomId: 'room-a',
          peerId: 'peer-a',
          peers: ['peer-a', 'peer-b', 123],
        }),
      ),
    ).toEqual({
      type: 'joined',
      roomId: 'room-a',
      peerId: 'peer-a',
      peers: ['peer-a', 'peer-b'],
    });

    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'peer-joined',
          roomId: 'room-a',
          peerId: 'peer-b',
        }),
      ),
    ).toEqual({
      type: 'peer-joined',
      roomId: 'room-a',
      peerId: 'peer-b',
    });

    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'peer-left',
          roomId: 'room-a',
          peerId: 'peer-b',
        }),
      ),
    ).toEqual({
      type: 'peer-left',
      roomId: 'room-a',
      peerId: 'peer-b',
    });
  });

  it('parses signal server messages with description and candidate variants', () => {
    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-b',
          toPeerId: 'peer-a',
          description: {
            type: 'offer',
            sdp: 'v=0',
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-b',
      toPeerId: 'peer-a',
      description: {
        type: 'offer',
        sdp: 'v=0',
      },
    });

    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-b',
          toPeerId: 'peer-a',
          candidate: {
            candidate: 'candidate:1',
            sdpMid: null,
            usernameFragment: null,
            sdpMLineIndex: 0,
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-b',
      toPeerId: 'peer-a',
      candidate: {
        candidate: 'candidate:1',
        sdpMid: null,
        usernameFragment: null,
        sdpMLineIndex: 0,
      },
    });

    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-b',
          toPeerId: 'peer-a',
          candidate: {
            candidate: 'candidate:2',
            usernameFragment: 'ufrag',
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-b',
      toPeerId: 'peer-a',
      candidate: {
        candidate: 'candidate:2',
        usernameFragment: 'ufrag',
      },
    });
  });

  it('parses error server messages', () => {
    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'error',
          code: 'AUTH_FAILED',
          message: 'forbidden',
        }),
      ),
    ).toEqual({
      type: 'error',
      code: 'AUTH_FAILED',
      message: 'forbidden',
    });
  });

  it('returns null for invalid server payloads', () => {
    expect(parseSignalingServerMessage('not-json')).toBeNull();
    expect(parseSignalingServerMessage(null)).toBeNull();
    expect(parseSignalingServerMessage(JSON.stringify({ type: 'unknown' }))).toBeNull();
    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-b',
          toPeerId: 'peer-a',
        }),
      ),
    ).toBeNull();
    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-b',
          toPeerId: 'peer-a',
          description: {
            type: 'invalid-type',
            sdp: 'bad',
          },
        }),
      ),
    ).toBeNull();
    expect(
      parseSignalingServerMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-b',
          toPeerId: 'peer-a',
          candidate: {
            sdpMid: '0',
          },
        }),
      ),
    ).toBeNull();
  });

  it('parses join and leave client messages', () => {
    expect(
      parseSignalingClientMessage(
        JSON.stringify({
          type: 'join',
          roomId: 'room-a',
          peerId: 'peer-a',
          token: 'token-1',
        }),
      ),
    ).toEqual({
      type: 'join',
      roomId: 'room-a',
      peerId: 'peer-a',
      token: 'token-1',
    });

    expect(
      parseSignalingClientMessage(
        JSON.stringify({
          type: 'join',
          roomId: 'room-a',
          peerId: 'peer-a',
        }),
      ),
    ).toEqual({
      type: 'join',
      roomId: 'room-a',
      peerId: 'peer-a',
    });

    expect(
      parseSignalingClientMessage(
        JSON.stringify({
          type: 'leave',
          roomId: 'room-a',
          peerId: 'peer-a',
        }),
      ),
    ).toEqual({
      type: 'leave',
      roomId: 'room-a',
      peerId: 'peer-a',
    });
  });

  it('parses signal client messages and rejects invalid forms', () => {
    expect(
      parseSignalingClientMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          candidate: {
            candidate: 'candidate:client',
            sdpMid: '0',
            sdpMLineIndex: 1,
            usernameFragment: 'ufrag',
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      candidate: {
        candidate: 'candidate:client',
        sdpMid: '0',
        sdpMLineIndex: 1,
        usernameFragment: 'ufrag',
      },
    });

    expect(
      parseSignalingClientMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          description: {
            type: 'answer',
            sdp: 'v=0',
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      description: {
        type: 'answer',
        sdp: 'v=0',
      },
    });

    expect(
      parseSignalingClientMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
          candidate: {
            candidate: 'candidate:3',
            sdpMid: null,
            usernameFragment: null,
          },
        }),
      ),
    ).toEqual({
      type: 'signal',
      roomId: 'room-a',
      fromPeerId: 'peer-a',
      toPeerId: 'peer-b',
      candidate: {
        candidate: 'candidate:3',
        sdpMid: null,
        usernameFragment: null,
      },
    });

    expect(
      parseSignalingClientMessage(
        JSON.stringify({
          type: 'signal',
          roomId: 'room-a',
          fromPeerId: 'peer-a',
          toPeerId: 'peer-b',
        }),
      ),
    ).toBeNull();

    expect(parseSignalingClientMessage(JSON.stringify({ type: 'unknown' }))).toBeNull();
    expect(parseSignalingClientMessage('not-json')).toBeNull();
  });
});
