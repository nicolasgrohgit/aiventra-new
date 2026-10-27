import { AccessToken, DataPacket_Kind, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { config } from './config';

const httpUrl = config.livekitUrl.replace(/^ws/, 'http');
export const roomService = new RoomServiceClient(httpUrl, config.livekitApiKey, config.livekitApiSecret);
export const webhookReceiver = new WebhookReceiver(config.livekitApiKey, config.livekitApiSecret);

export const roomNameFor = (streamId: string) => `stream_${streamId}`;

export async function createRoomToken(opts: {
  streamId: string;
  identity: string;
  name: string;
  isHost: boolean;
}): Promise<string> {
  const at = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: '4h',
  });
  at.addGrant({
    room: roomNameFor(opts.streamId),
    roomJoin: true,
    canPublish: opts.isHost, // viewers watch only; no camera/mic
    canSubscribe: true,
    canPublishData: true, // chat for everyone
  });
  return at.toJwt();
}

/** Server-authoritative broadcast (gifts), so clients can't fake them over the data channel. */
export async function broadcast(streamId: string, topic: string, payload: unknown): Promise<void> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  await roomService.sendData(roomNameFor(streamId), data, DataPacket_Kind.RELIABLE, { topic });
}
